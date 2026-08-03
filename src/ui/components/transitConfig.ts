import type { HabitatId, SproutTypeId } from '../../core/ids';
import { HABITATS } from '../../data/habitats';
import { SPROUT_TYPES } from '../../data/sproutTypes';
import { el } from '../dom';
import type { TransitBuildConfig } from './buildMenu';
import type { TransitSlideUiState, UiStateStore } from '../uiState';

export interface TransitSlideConfiguration extends TransitBuildConfig {
  enabled: boolean;
}

export interface TransitConfigHooks {
  onConfigureSlide?: (slideId: string, configuration: TransitSlideConfiguration) => void;
  onPreviewSlide?: (slideId: string, configuration: TransitSlideConfiguration | null) => void;
}

export interface TransitConfigHandle {
  element: HTMLElement;
  dispose: () => void;
}

const slideName = (id: string): string => `Garden Slide ${id.replace(/^slide-/, '')}`;

function copyConfig(slide: TransitSlideUiState): TransitSlideConfiguration {
  return {
    acceptedKind: slide.acceptedKind,
    destination: slide.destination,
    enabled: slide.enabled,
  };
}

function sameConfig(a: TransitSlideConfiguration, b: TransitSlideConfiguration): boolean {
  return a.acceptedKind === b.acceptedKind && a.destination === b.destination && a.enabled === b.enabled;
}

function recoveryCopy(reason: NonNullable<ReturnType<UiStateStore['getState']>['lastTransitRecovery']>['reason']): string {
  switch (reason) {
    case 'removed': return 'A Sprout was safely returned to its starting spot because its Garden Slide was removed.';
    case 'disabled': return 'A Sprout was safely returned to its starting spot because its Garden Slide was paused.';
    case 'destinationFull': return 'A Sprout was safely returned to its starting spot because its destination was full.';
    case 'invalidTarget': return 'A Sprout was safely returned to its starting spot because the route no longer had a valid home.';
    case 'saveRepair': return 'A Sprout was safely returned to its starting spot while the garden save was repaired.';
  }
}

export function createTransitConfigPanel(store: UiStateStore, hooks: TransitConfigHooks = {}): TransitConfigHandle {
  const element = el('section', { className: 'tt-transit-panel', 'aria-label': 'Transit rules' });
  const drafts = new Map<string, TransitSlideConfiguration>();
  let open = false;
  let lastFocusedControl: string | null = null;
  let lastSlidesSignature = '';

  const rememberFocus = (): void => {
    const active = document.activeElement;
    lastFocusedControl = active instanceof HTMLElement ? active.dataset.transitFocus ?? null : null;
  };

  const restoreFocus = (): void => {
    if (!lastFocusedControl) return;
    const control = element.querySelector<HTMLElement>(`[data-transit-focus="${lastFocusedControl}"]`);
    control?.focus();
  };

  const updateDraft = (slide: TransitSlideUiState, next: Partial<TransitSlideConfiguration>): void => {
    const draft = { ...(drafts.get(slide.id) ?? copyConfig(slide)), ...next };
    drafts.set(slide.id, draft);
    hooks.onPreviewSlide?.(slide.id, draft);
    render(true);
  };

  const applyDraft = (slide: TransitSlideUiState): void => {
    const draft = drafts.get(slide.id) ?? copyConfig(slide);
    if (sameConfig(draft, copyConfig(slide))) return;
    hooks.onConfigureSlide?.(slide.id, draft);
    hooks.onPreviewSlide?.(slide.id, null);
    drafts.delete(slide.id);
    render(true);
  };

  function render(force = false): void {
    const ui = store.getState();
    const slides = ui.transitSlides;
    const recovery = ui.lastTransitRecovery;
    const slidesSignature = slides.map((slide) => `${slide.id}/${slide.tile.x},${slide.tile.z}/${slide.acceptedKind}/${slide.destination}/${slide.enabled}`).join('|');
    const signature = `${slidesSignature}|recovery:${recovery?.reason ?? ''}/${recovery?.sproutId ?? ''}`;
    if (!force && signature === lastSlidesSignature) return;
    lastSlidesSignature = signature;
    rememberFocus();
    if (slides.length === 0 && !recovery) {
      element.hidden = true;
      element.replaceChildren();
      return;
    }
    element.hidden = false;
    element.replaceChildren();

    const toggle = el('button', {
      type: 'button',
      className: 'tt-transit-panel-toggle',
      'aria-expanded': String(open),
      'aria-controls': 'tt-transit-rules',
      'data-transit-focus': 'toggle',
    }, [`Transit rules · ${slides.length}`]);
    toggle.addEventListener('click', () => {
      open = !open;
      render(true);
    });
    element.append(toggle);
    if (!open) {
      restoreFocus();
      return;
    }

    const panel = el('div', { className: 'tt-transit-panel-body', id: 'tt-transit-rules' });
    panel.append(
      el('h2', {}, ['Garden transit']),
      el('p', { className: 'tt-transit-panel-copy' }, [
        'Manual carry is always available. Garden Slides carry matching Sprouts to a home; Sprout Conveyors join Slides into a route; the Colour Gate makes the sorting decision.',
      ]),
    );
    if (recovery) {
      panel.append(el('p', { className: 'tt-transit-recovery', role: 'status', 'aria-live': 'polite' }, [recoveryCopy(recovery.reason)]));
    }

    for (const slide of slides) {
      const draft = drafts.get(slide.id) ?? copyConfig(slide);
      const unchanged = sameConfig(draft, copyConfig(slide));
      const acceptedName = draft.acceptedKind === 'any' ? 'Any Sprout' : SPROUT_TYPES[draft.acceptedKind].displayName;
      const details = el('details', { className: 'tt-transit-card', open: true });
      const summary = el('summary', {}, [
        el('span', { className: 'tt-transit-card-title' }, [
          '✦ ', slideName(slide.id), ' · ', acceptedName,
        ]),
        el('span', { className: 'tt-transit-status-pill', 'data-status': draft.enabled ? 'ready' : 'paused' }, [
          draft.enabled ? 'Ready' : 'Paused',
        ]),
      ]);
      const body = el('div', { className: 'tt-transit-card-body' });
      const kindSelect = el('select', {
        'aria-label': `${slideName(slide.id)} accepted Sprout kind`,
        'data-transit-focus': `${slide.id}-kind`,
      }) as HTMLSelectElement;
      kindSelect.append(el('option', { value: 'any' }, ['Any Sprout']));
      for (const definition of Object.values(SPROUT_TYPES)) {
        kindSelect.append(el('option', { value: definition.id }, [definition.displayName]));
      }
      kindSelect.value = draft.acceptedKind;
      kindSelect.addEventListener('change', () => updateDraft(slide, { acceptedKind: kindSelect.value as SproutTypeId | 'any' }));

      const destinationSelect = el('select', {
        'aria-label': `${slideName(slide.id)} destination`,
        'data-transit-focus': `${slide.id}-destination`,
      }) as HTMLSelectElement;
      for (const habitatId of Object.keys(HABITATS) as HabitatId[]) {
        destinationSelect.append(el('option', { value: habitatId }, [HABITATS[habitatId].displayName]));
      }
      destinationSelect.value = draft.destination;
      destinationSelect.addEventListener('change', () => updateDraft(slide, { destination: destinationSelect.value as HabitatId }));

      const enabled = el('input', {
        type: 'checkbox',
        'aria-label': `${slideName(slide.id)} enabled`,
        'data-transit-focus': `${slide.id}-enabled`,
      }) as HTMLInputElement;
      enabled.checked = draft.enabled;
      enabled.addEventListener('change', () => updateDraft(slide, { enabled: enabled.checked }));

      const preview = el('p', { className: 'tt-transit-preview-copy', role: 'status', 'aria-live': 'polite' }, [
        unchanged
          ? `→ ${HABITATS[draft.destination].displayName}. Choose a new destination to preview the route in the garden.`
          : `Preview → ${HABITATS[draft.destination].displayName}. Apply changes to save this rule.`,
      ]);
      const status = el('p', { className: 'tt-transit-card-status' }, [
        draft.enabled
          ? `Ready for ${acceptedName} · route points toward ${HABITATS[draft.destination].displayName}.`
          : 'Paused · enable this Slide to let Sprouts ride again.',
      ]);
      const apply = el('button', {
        type: 'button',
        className: 'tt-transit-apply',
        disabled: unchanged,
        'data-transit-focus': `${slide.id}-apply`,
      }, ['Apply changes']);
      apply.addEventListener('click', () => applyDraft(slide));

      body.append(
        el('label', {}, ['Carries ', kindSelect]),
        el('label', {}, ['Destination ', destinationSelect]),
        el('label', { className: 'tt-transit-check' }, [enabled, ' Slide enabled']),
        preview,
        status,
        apply,
      );
      details.append(summary, body);
      panel.append(details);
    }
    element.append(panel);
    queueMicrotask(restoreFocus);
  }

  render(true);
  const unsubscribe = store.subscribe(() => render());

  return {
    element,
    dispose: () => {
      unsubscribe();
      for (const slide of store.getState().transitSlides) hooks.onPreviewSlide?.(slide.id, null);
      element.remove();
    },
  };
}
