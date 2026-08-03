// Build menu: icon buttons for placing unlocked automations (Garden Slide,
// Colour Gate). This is the MENU only — selecting an item enters "placement
// mode" and shows a selected state; the actual 3D ghost/valid-invalid
// preview in the scene is Subagent E's (src/render + src/input).
//
// Cross-module contract for "player wants to place X": no GameEvent exists
// for a UI-initiated build-mode request (docs/CONTRACTS.md's event union is
// all sim-originated). Two things are offered so integration doesn't block
// on a CONTRACTS.md edit:
//   1. `onEnterBuildMode` / `onExitBuildMode` callbacks passed into mountUI.
//   2. A `window` CustomEvent('terrarium:buildMode', { detail: { automationId
//      | null } }) dispatched on every change, as a zero-import fallback E's
//      input layer can listen for without depending on src/ui.
// Both are reported back for the integrator to wire into a real command
// path once one exists.

import type { AutomationId, HabitatId, SproutTypeId } from '../../core/ids';
import { habitatBuildCost, HABITATS } from '../../data/habitats';
import { SPROUT_TYPES } from '../../data/sproutTypes';
import {
  conveyorUnlockMessage,
  nextGardenSlidePrice,
  SPROUT_CONVEYOR_COST,
  transitCapMessage,
  TRANSIT_CAPS,
  type PricedTransitKind,
} from '../../data/transit';
import type { EventBus } from '../../events';
import { el } from '../dom';
import { icons } from '../icons';
import { iconHtml, onManifestIconsReady, preloadManifestIcons } from '../manifestIcons';
import type { UiStateStore } from '../uiState';

export const BUILD_MODE_EVENT = 'terrarium:buildMode';
export const PLACEMENT_PREVIEW_EVENT = 'terrarium:placementPreview';

export interface BuildModeEventDetail {
  automationId: AutomationId | null;
  /** Phase 2: habitat kinds share the same build-mode plumbing — when set,
   * the menu is in habitat build mode for this kind instead. */
  habitatId?: HabitatId | null;
  transitKind?: PricedTransitKind | null;
  transitConfig?: TransitBuildConfig;
}

export interface TransitBuildConfig {
  acceptedKind: SproutTypeId | 'any';
  destination: HabitatId;
}

export interface PlacementPreviewEventDetail {
  state: 'valid' | 'invalid' | 'blocked';
  message: string;
  kind: 'automation' | 'habitat' | PricedTransitKind;
  tile: { x: number; z: number } | null;
}

export interface BuildMenuHooks {
  onEnterBuildMode?: (automationId: AutomationId) => void;
  onEnterHabitatBuildMode?: (habitatId: HabitatId) => void;
  onEnterTransitBuildMode?: (kind: PricedTransitKind) => void;
  onTransitConfigChanged?: (config: TransitBuildConfig) => void;
  onExitBuildMode?: () => void;
}

export interface BuildMenuHandle {
  element: HTMLElement;
  dispose: () => void;
}

const AUTOMATION_LABEL: Record<AutomationId, string> = {
  gardenSlide: 'Garden Slide',
  colourGate: 'Colour Gate',
  moodBell: 'Mood Bell',
};

const AUTOMATION_ICON: Record<AutomationId, keyof typeof icons> = {
  gardenSlide: 'gardenSlide',
  colourGate: 'colourGate',
  moodBell: 'moodBell',
};

const AUTOMATION_MANIFEST_KEY: Record<AutomationId, string> = {
  gardenSlide: 'ui.icon.gardenSlide',
  colourGate: 'ui.icon.colourGate',
  moodBell: 'ui.icon.moodBell',
};

// Habitat "build another home" buttons reuse the kind's Sprout icon (a drum
// has no distinct glyph in src/ui/icons.ts) — the same shape-the-primary-
// signal approach the Sprout-type icons already follow.
const HABITAT_ICON: Record<HabitatId, keyof typeof icons> = {
  emberNook: 'sproutEmber',
  dewPond: 'sproutDew',
  sunflowerMeadow: 'sproutSun',
};

const TRANSIT_LABEL: Record<PricedTransitKind, string> = {
  gardenSlide: 'Garden Slide',
  sproutConveyor: 'Sprout Conveyor',
};

const TRANSIT_ICON: Record<PricedTransitKind, keyof typeof icons> = {
  gardenSlide: 'gardenSlide',
  sproutConveyor: 'gardenSlide',
};

type Selection =
  | { kind: 'automation'; id: AutomationId }
  | { kind: 'habitat'; id: HabitatId }
  | { kind: 'transit'; id: PricedTransitKind }
  | null;

export function createBuildMenu(bus: EventBus, store: UiStateStore, hooks: BuildMenuHooks = {}): BuildMenuHandle {
  const element = el('div', { className: 'tt-buildmenu', role: 'toolbar', 'aria-label': 'Build menu' });

  let selected: Selection = null;
  let transitConfig: TransitBuildConfig = { acceptedKind: 'any', destination: 'sunflowerMeadow' };
  // Cached buttons, keyed by automation/habitat id. render() updates these in
  // place (attributes/labels) and only creates/removes them when membership
  // actually changes — the store re-notifies on every dewdrop tick, and
  // rebuild-from-scratch would churn the DOM (and detach a button under an
  // in-flight pointer press) a dozen times a second.
  const automationButtons = new Map<AutomationId, HTMLButtonElement>();
  const habitatButtons = new Map<HabitatId, HTMLButtonElement>();
  const transitButtons = new Map<PricedTransitKind, HTMLButtonElement>();
  const placementStatus = el('div', {
    className: 'tt-buildmenu-status',
    role: 'status',
    'aria-live': 'polite',
    'data-placement-state': 'idle',
  });
  const transitConfigPanel = el('fieldset', { className: 'tt-transit-config' });
  let acceptedKindSelect: HTMLSelectElement | null = null;
  let destinationSelect: HTMLSelectElement | null = null;

  const setPlacementStatus = (state: PlacementPreviewEventDetail['state'] | 'idle', message: string): void => {
    placementStatus.dataset.placementState = state;
    placementStatus.textContent = message;
  };
  setPlacementStatus('idle', 'Choose a garden tool to place, move, or remove.');

  function setSelected(next: Selection): void {
    selected = next;
    dispatchEvent(
      new CustomEvent<BuildModeEventDetail>(BUILD_MODE_EVENT, {
        detail:
          next?.kind === 'automation'
            ? { automationId: next.id }
            : next?.kind === 'habitat'
              ? { automationId: null, habitatId: next.id }
              : next?.kind === 'transit'
                ? { automationId: null, transitKind: next.id, transitConfig: next.id === 'gardenSlide' ? transitConfig : undefined }
                : { automationId: null },
      }),
    );
    if (next) {
      setPlacementStatus('idle', 'Choose a tile. Arrow keys move the preview; Enter places it; Escape cancels.');
    } else {
      setPlacementStatus('idle', 'Choose a garden tool to place, move, or remove.');
    }
    if (next?.kind === 'automation') hooks.onEnterBuildMode?.(next.id);
    else if (next?.kind === 'habitat') hooks.onEnterHabitatBuildMode?.(next.id);
    else if (next?.kind === 'transit') {
      hooks.onEnterTransitBuildMode?.(next.id);
      if (next.id === 'gardenSlide') hooks.onTransitConfigChanged?.(transitConfig);
    }
    else hooks.onExitBuildMode?.();
    render();
  }

  function setTransitConfig(next: Partial<TransitBuildConfig>): void {
    transitConfig = { ...transitConfig, ...next };
    if (selected?.kind === 'transit' && selected.id === 'gardenSlide') {
      hooks.onTransitConfigChanged?.(transitConfig);
      dispatchEvent(
        new CustomEvent<BuildModeEventDetail>(BUILD_MODE_EVENT, {
          detail: { automationId: null, transitKind: 'gardenSlide', transitConfig },
        }),
      );
      render();
    }
  }

  function toggleAutomation(automationId: AutomationId): void {
    setSelected(selected?.kind === 'automation' && selected.id === automationId ? null : { kind: 'automation', id: automationId });
  }

  function toggleHabitat(habitatId: HabitatId): void {
    setSelected(selected?.kind === 'habitat' && selected.id === habitatId ? null : { kind: 'habitat', id: habitatId });
  }

  function toggleTransit(id: PricedTransitKind): void {
    const state = store.getState();
    const slideCount = state.transitCounts.gardenSlide;
    const affordable = id === 'gardenSlide'
      ? state.dewdropTotal >= nextGardenSlidePrice(slideCount)
      : state.dewdropTotal >= SPROUT_CONVEYOR_COST;
    const unlocked = id === 'gardenSlide' ? state.unlockedAutomations.has('gardenSlide') : slideCount > 0;
    if (!unlocked || !affordable || state.transitCounts[id] >= TRANSIT_CAPS[id]) return;
    setSelected(selected?.kind === 'transit' && selected.id === id ? null : { kind: 'transit', id });
  }

  function render(): void {
    const state = store.getState();
    // Only automations unlocked but NOT YET PLACED belong here (2026-08-01,
    // manual placement — GameRules §9.8): once built, there is nothing left
    // to place, and offering the button again would enter a build mode that
    // can only ever decline (one instance per automation kind).
    const placeable = Array.from(state.unlockedAutomations)
      .filter((id) => id !== 'gardenSlide' && !state.placedAutomations.has(id))
      .sort();
    // Phase 2 — a kind earns a "build another home" button once one of its
    // instances is currently full (the full-now gate, GameRules §10.0); the
    // sim's placeHabitat re-checks the gate + cost on commit, so an
    // affordable-looking button that drifted out of date still can't overdraw.
    const buildableHabitats = (Object.keys(HABITATS) as HabitatId[])
      .filter((id) => state.habitatFullKinds.has(id))
      .sort();

    const keep = (buttons: Map<string, HTMLButtonElement>, desired: string[]): HTMLButtonElement[] => {
      for (const key of Array.from(buttons.keys())) {
        if (!desired.includes(key)) {
          const removed = buttons.get(key);
          removed?.remove();
          buttons.delete(key);
        }
      }
      return desired.map((key) => {
        let button = buttons.get(key);
        if (!button) {
          button = el('button', { type: 'button', className: 'tt-buildmenu-item' });
          buttons.set(key, button);
        }
        return button;
      });
    };

    const desiredAutomations = keep(automationButtons, placeable);
    for (let i = 0; i < desiredAutomations.length; i += 1) {
      const automationId = placeable[i];
      const button = desiredAutomations[i];
      const isSelected = selected?.kind === 'automation' && selected.id === automationId;
      button.setAttribute('aria-pressed', String(isSelected));
      button.setAttribute(
        'aria-label',
        `${AUTOMATION_LABEL[automationId]}${isSelected ? ' (selected — click to cancel placement)' : ''}`,
      );
      // Rebuild inner icon+label only when the button was freshly created.
      if (button.childElementCount === 0) {
        button.append(
          el('span', {
            'aria-hidden': 'true',
            html: iconHtml(AUTOMATION_MANIFEST_KEY[automationId], icons[AUTOMATION_ICON[automationId]]),
          }),
          el('span', {}, [AUTOMATION_LABEL[automationId]]),
        );
        button.addEventListener('click', () => toggleAutomation(automationId));
      }
    }

    const desiredHabitats = keep(habitatButtons, buildableHabitats);
    for (let i = 0; i < desiredHabitats.length; i += 1) {
      const habitatId = buildableHabitats[i];
      const button = desiredHabitats[i];
      const isSelected = selected?.kind === 'habitat' && selected.id === habitatId;
      const cost = habitatBuildCost(state.habitatInstanceCounts[habitatId] ?? 1);
      const affordable = state.dewdropTotal >= cost;
      button.disabled = !affordable;
      button.setAttribute('aria-pressed', String(isSelected));
      button.setAttribute(
        'aria-label',
        `${HABITATS[habitatId].displayName} — build another home for ${cost} Dewdrops${affordable ? '' : ' (not enough Dewdrops)'}${isSelected ? ' (selected — click to cancel placement)' : ''}`,
      );
      if (button.childElementCount === 0) {
        button.append(
          el('span', {
            'aria-hidden': 'true',
            html: iconHtml(`ui.icon.${habitatId}`, icons[HABITAT_ICON[habitatId]]),
          }),
          el('span', {}, [`${HABITATS[habitatId].displayName} · ${cost}`]),
        );
        button.addEventListener('click', () => {
          // Re-check affordability at click time, not creation time: the button
          // node is REUSED across renders (the store re-notifies every dewdrop
          // tick), so a `disabled`/`affordable` value captured when the node was
          // first created could be stale by the time the player clicks. The
          // `disabled` attribute already blocks clicks on unaffordable buttons;
          // this guard makes the same guarantee for keyboard/AT activation.
          const fresh = store.getState();
          if (fresh.dewdropTotal >= habitatBuildCost(fresh.habitatInstanceCounts[habitatId] ?? 1)) toggleHabitat(habitatId);
        });
      } else {
        // Cost can change between renders (a habitat was built) — keep the
        // visible label's number fresh without recreating the node.
        const label = button.querySelector('span:last-child');
        if (label) label.textContent = `${HABITATS[habitatId].displayName} · ${cost}`;
      }
    }

    const transitKinds = (['gardenSlide', 'sproutConveyor'] as PricedTransitKind[]).filter((id) =>
      id === 'gardenSlide' ? state.unlockedAutomations.has('gardenSlide') : state.unlockedAutomations.has('gardenSlide'),
    );
    const desiredTransit = keep(transitButtons, transitKinds);
    for (let i = 0; i < desiredTransit.length; i += 1) {
      const id = transitKinds[i];
      const button = desiredTransit[i];
      const count = state.transitCounts[id];
      const cap = TRANSIT_CAPS[id];
      const price = id === 'gardenSlide' ? nextGardenSlidePrice(state.transitCounts.gardenSlide) : SPROUT_CONVEYOR_COST;
      const locked = id === 'sproutConveyor' && state.transitCounts.gardenSlide === 0;
      const capped = count >= cap;
      const affordable = state.dewdropTotal >= price;
      const reason = locked ? conveyorUnlockMessage() : capped ? transitCapMessage(id) : !affordable ? `You need ${price} Dewdrops.` : '';
      const isSelected = selected?.kind === 'transit' && selected.id === id;
      button.disabled = Boolean(locked || capped || !affordable);
      button.setAttribute('aria-pressed', String(isSelected));
      button.setAttribute(
        'aria-label',
        `${TRANSIT_LABEL[id]} — ${price} Dewdrops, ${count} of ${cap}${reason ? ` (${reason})` : ''}${isSelected ? ' (selected — click to cancel placement)' : ''}`,
      );
      if (button.childElementCount === 0) {
        button.append(
          el('span', {
            'aria-hidden': 'true',
            html: iconHtml(`ui.icon.${id}`, icons[TRANSIT_ICON[id]]),
          }),
          el('span', {}, [`${TRANSIT_LABEL[id]} · ${price} · ${count}/${cap}`]),
        );
        button.addEventListener('click', () => toggleTransit(id));
      } else {
        const label = button.querySelector('span:last-child');
        if (label) label.textContent = `${TRANSIT_LABEL[id]} · ${price} · ${count}/${cap}`;
      }
    }

    const slideSelected = selected?.kind === 'transit' && selected.id === 'gardenSlide';
    if (slideSelected && !acceptedKindSelect) {
      transitConfigPanel.append(el('legend', {}, ['Garden Slide rule']));
      acceptedKindSelect = el('select', { 'aria-label': 'Accepted Sprout kind' }) as HTMLSelectElement;
      acceptedKindSelect.append(el('option', { value: 'any' }, ['Any Sprout']));
      for (const definition of Object.values(SPROUT_TYPES)) {
        acceptedKindSelect.append(el('option', { value: definition.id }, [definition.displayName]));
      }
      acceptedKindSelect.addEventListener('change', () => setTransitConfig({ acceptedKind: acceptedKindSelect?.value as TransitBuildConfig['acceptedKind'] }));
      destinationSelect = el('select', { 'aria-label': 'Slide destination' }) as HTMLSelectElement;
      for (const habitatId of Object.keys(HABITATS) as HabitatId[]) {
        destinationSelect.append(el('option', { value: habitatId }, [HABITATS[habitatId].displayName]));
      }
      destinationSelect.addEventListener('change', () => setTransitConfig({ destination: destinationSelect?.value as HabitatId }));
      transitConfigPanel.append(
        el('label', {}, ['Carries ', acceptedKindSelect]),
        el('label', {}, ['To ', destinationSelect]),
      );
    } else if (!slideSelected && acceptedKindSelect) {
      transitConfigPanel.replaceChildren();
      acceptedKindSelect = null;
      destinationSelect = null;
    }
    if (slideSelected) {
      acceptedKindSelect!.value = transitConfig.acceptedKind;
      destinationSelect!.value = transitConfig.destination;
    }
    element.replaceChildren(...desiredAutomations, ...desiredTransit, ...desiredHabitats, transitConfigPanel, placementStatus);
  }

  preloadManifestIcons(Object.values(AUTOMATION_MANIFEST_KEY));

  render();
  const unsubscribeState = store.subscribe(render);
  const unsubscribeIcons = onManifestIconsReady(render);
  // A successful build exits placement mode automatically.
  const unsubscribeBuilt = bus.subscribe('automation:built', () => {
    if (selected?.kind === 'automation') setSelected(null);
  });
  const unsubscribeHabitatBuilt = bus.subscribe('habitat:built', () => {
    if (selected?.kind === 'habitat') setSelected(null);
  });
  const unsubscribeTransitBuilt = bus.subscribe('transit:slideBuilt', () => {
    if (selected?.kind === 'transit') setSelected(null);
  });
  const unsubscribeConveyorBuilt = bus.subscribe('transit:conveyorBuilt', () => {
    if (selected?.kind === 'transit') setSelected(null);
  });
  const handlePlacementPreview = (event: Event): void => {
    const detail = (event as CustomEvent<PlacementPreviewEventDetail>).detail;
    if (!detail) return;
    setPlacementStatus(detail.state, `${detail.state === 'valid' ? '✓ Ready' : detail.state === 'blocked' ? '⛔ Blocked' : '! Invalid'} — ${detail.message}`);
  };
  window.addEventListener(PLACEMENT_PREVIEW_EVENT, handlePlacementPreview);

  return {
    element,
    dispose: () => {
      unsubscribeState();
      unsubscribeIcons();
      unsubscribeBuilt();
      unsubscribeHabitatBuilt();
      unsubscribeTransitBuilt();
      unsubscribeConveyorBuilt();
      window.removeEventListener(PLACEMENT_PREVIEW_EVENT, handlePlacementPreview);
    },
  };
}
