// The Colour Gate's control surface — GameRules §9.4:
//
//   "This garden sign guides one kind of Sprout down the right path. It uses
//    large pictorial colour/type controls, visibly shows its active rule,
//    routes matching Sprouts toward a connected output, and sends nonmatches to
//    fallback/waiting paths. Missing outputs produce friendly, specific
//    feedback."
//
// Everything here is pictures. The panel shows the two lanes leaving the fork
// as two big cards — one headed WEST toward the Ember Nook, one EAST toward the
// Dew Pond — and under each, a row of large Sprout portraits to choose from,
// plus a "nobody for now" card. Choosing is one tap on a picture. There is no
// boolean logic, no conditional syntax, no numeric rule entry, and never the
// words "filter" or "splitter" (§2.1).
//
// Colour is never the only signal: each choice card carries the sprout's
// distinct silhouette (flame / droplet / sun-rays — see src/ui/icons.ts), its
// name in words, and a pressed state, so it reads correctly in grayscale, for
// colour-blind players and for a screen reader.
//
// The panel never writes game state itself. It calls `setColourGateLane`, and
// re-renders only from what the store mirrors back off
// `automation:colourGateRuleChanged` — so it can never show a rule the
// simulation has not actually adopted.

import type { HabitatId, SproutTypeId } from '../../core/ids';
import { HABITATS } from '../../data/habitats';
import { SPROUT_TYPES } from '../../data/sproutTypes';
import { el } from '../dom';
import { icons } from '../icons';
import { iconHtml, onManifestIconsReady, preloadManifestIcons } from '../manifestIcons';
import { createPanel } from '../panel';
import { safeColor, safeDisplayName, sproutIconKey, sproutManifestIconKey } from '../sproutVisuals';
import type { UiStateStore } from '../uiState';

/** Mirrors src/sim/layout.ts's ColourGateLane. Kept as a local literal type so
 * the UI layer does not import from src/sim (docs/CONTRACTS.md). */
export type ColourGateLane = 'west' | 'east';

export interface ColourGatePanelHooks {
  /** Sets one lane card. `null` clears it ("nobody for now"). */
  onSetColourGateLane?: (lane: ColourGateLane, sproutType: SproutTypeId | null) => void;
}

export interface ColourGatePanelHandle {
  overlay: HTMLElement;
  open: (trigger?: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
  /** True once the player owns a Colour Gate — the nav entry hides until then. */
  isAvailable: () => boolean;
  dispose: () => void;
}

/**
 * Which home each lane physically leads to. This mirrors
 * COLOUR_GATE_LANE_HABITATS in src/sim/layout.ts, which is the authority: a
 * lane's destination is a fact about the garden's shape and is never something
 * the player edits. Duplicated as a literal rather than imported so src/ui keeps
 * its "no src/sim imports" boundary.
 */
const LANE_HABITAT: Record<ColourGateLane, HabitatId> = {
  west: 'emberNook',
  east: 'dewPond',
};

const LANE_HEADING: Record<ColourGateLane, string> = {
  west: 'The lane going left',
  east: 'The lane going right',
};

/** Star is never offered: a Star Sprout is happy in any home and is meant to be
 * met by hand for its reveal moment (GameRules §6.5, §7.2). */
const CHOOSABLE: SproutTypeId[] = ['ember', 'dew', 'sun'];

function laneIntro(lane: ColourGateLane): string {
  return `leads to the ${HABITATS[LANE_HABITAT[lane]].displayName}`;
}

/**
 * Friendly, specific note for a lane, or null when all is well. Mirrors
 * `colourGateLaneNote` in src/sim/systems.ts — the simulation's copy is what
 * governs behaviour; this is the same sentence rendered where the player is
 * actually choosing, so the feedback appears on the card itself rather than
 * only somewhere else.
 */
function laneNote(lane: ColourGateLane, sproutType: SproutTypeId | null): string | null {
  if (!sproutType) return 'This lane is quiet for now. Pick a little one to send along it.';
  const habitatId = LANE_HABITAT[lane];
  const home = SPROUT_TYPES[sproutType]?.habitatId ?? null;
  if (home === null || home === habitatId) return null;
  return `${HABITATS[habitatId].displayName} is not home to ${safeDisplayName(sproutType)}s — they are looking for the ${HABITATS[home].displayName}, so the Gate lets them wait by the pods instead.`;
}

interface LaneView {
  card: HTMLElement;
  summary: HTMLElement;
  note: HTMLElement;
  choices: Map<SproutTypeId | 'none', HTMLButtonElement>;
}

export function createColourGatePanel(store: UiStateStore, hooks: ColourGatePanelHooks = {}): ColourGatePanelHandle {
  const titleId = 'tt-colourgate-title';
  const panel = createPanel({ titleId, labelledBy: titleId });
  const lanes = new Map<ColourGateLane, LaneView>();

  function buildChoice(lane: ColourGateLane, choice: SproutTypeId | 'none'): HTMLButtonElement {
    const isNone = choice === 'none';
    const label = isNone ? 'Nobody for now' : safeDisplayName(choice);
    const art = isNone
      ? el('span', { className: 'tt-gate-choice-art tt-gate-choice-art--none', html: icons.lockedSlot, 'aria-hidden': 'true' })
      : el('span', {
          className: 'tt-gate-choice-art',
          html: iconHtml(sproutManifestIconKey(choice), icons[sproutIconKey(choice)]),
          'aria-hidden': 'true',
        });
    if (!isNone) art.style.color = safeColor(choice);

    const button = el(
      'button',
      { type: 'button', className: 'tt-gate-choice', 'aria-pressed': false },
      [art, el('span', { className: 'tt-gate-choice-name' }, [label])],
    );
    button.addEventListener('click', () => {
      hooks.onSetColourGateLane?.(lane, isNone ? null : choice);
    });
    return button;
  }

  function buildLane(lane: ColourGateLane): LaneView {
    const summary = el('p', { className: 'tt-gate-summary' }, ['']);
    const note = el('p', { className: 'tt-gate-note' }, ['']);
    note.hidden = true;
    const choices = new Map<SproutTypeId | 'none', HTMLButtonElement>();
    const row = el('div', { className: 'tt-gate-choices', role: 'group', 'aria-label': `Who takes ${LANE_HEADING[lane].toLowerCase()}` });
    for (const choice of [...CHOOSABLE, 'none'] as Array<SproutTypeId | 'none'>) {
      const button = buildChoice(lane, choice);
      choices.set(choice, button);
      row.append(button);
    }
    const card = el('section', { className: `tt-gate-lane tt-gate-lane--${lane}` }, [
      el('h3', {}, [`${LANE_HEADING[lane]} ${laneIntro(lane)}`]),
      summary,
      row,
      note,
    ]);
    return { card, summary, note, choices };
  }

  for (const lane of ['west', 'east'] as ColourGateLane[]) lanes.set(lane, buildLane(lane));

  function render(): void {
    const state = store.getState();
    for (const lane of ['west', 'east'] as ColourGateLane[]) {
      const view = lanes.get(lane);
      if (!view) continue;
      const chosen = state.colourGateLanes[lane];
      const note = laneNote(lane, chosen);
      const homeName = HABITATS[LANE_HABITAT[lane]].displayName;

      view.summary.textContent = chosen
        ? `Sending ${safeDisplayName(chosen)}s this way.`
        : `Sending nobody this way just now.`;
      view.note.textContent = note ?? '';
      view.note.hidden = note === null;
      view.card.classList.toggle('is-mismatched', note !== null && chosen !== null);

      for (const [choice, button] of view.choices) {
        const active = choice === 'none' ? chosen === null : chosen === choice;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('is-active', active);
        button.setAttribute(
          'aria-label',
          choice === 'none'
            ? `Send nobody down the lane to the ${homeName}${active ? ' (currently chosen)' : ''}`
            : `Send ${safeDisplayName(choice)}s down the lane to the ${homeName}${active ? ' (currently chosen)' : ''}`,
        );
      }
    }
  }

  function updateIcons(): void {
    for (const view of lanes.values()) {
      for (const [choice, button] of view.choices) {
        if (choice === 'none') continue;
        const art = button.querySelector('.tt-gate-choice-art');
        if (art) art.innerHTML = iconHtml(sproutManifestIconKey(choice), icons[sproutIconKey(choice)]);
      }
    }
  }

  const closeBtn = el(
    'button',
    { type: 'button', className: 'tt-panel-close', 'aria-label': 'Close Colour Gate' },
    [el('span', { html: icons.close, 'aria-hidden': 'true' })],
  );
  closeBtn.addEventListener('click', () => panel.close());

  panel.dialog.append(
    el('div', { className: 'tt-panel-header' }, [el('h2', { id: titleId }, ['Colour Gate']), closeBtn]),
    el('p', { className: 'tt-gate-intro' }, [
      'Your Colour Gate stands where the garden path splits. Choose who it waves down each lane — ' +
        'everyone else waits comfortably by the nursery pods for you to carry them yourself.',
    ]),
    el('div', { className: 'tt-gate-lanes' }, [
      lanes.get('west')!.card,
      lanes.get('east')!.card,
    ]),
  );

  preloadManifestIcons(CHOOSABLE.map(sproutManifestIconKey));

  render();
  const unsubscribeState = store.subscribe(render);
  const unsubscribeIcons = onManifestIconsReady(updateIcons);

  return {
    overlay: panel.overlay,
    open: panel.open,
    close: panel.close,
    isOpen: panel.isOpen,
    isAvailable: () => store.getState().unlockedAutomations.has('colourGate'),
    dispose: () => {
      unsubscribeState();
      unsubscribeIcons();
    },
  };
}
