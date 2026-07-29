// Generic modal panel: overlay + dialog with a focus trap, Escape-to-close,
// and focus restored to whatever triggered it on close. Every panel
// (Journal, Upgrades, Achievements, Settings, Credits, Return dialog) is
// built from this so keyboard behaviour is consistent everywhere.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface PanelHandle {
  overlay: HTMLDivElement;
  dialog: HTMLDivElement;
  close: () => void;
  isOpen: () => boolean;
}

export interface CreatePanelOptions {
  titleId: string;
  labelledBy?: string;
  /** Called after the panel closes (Escape, overlay click, or close button). */
  onClose?: () => void;
}

/**
 * Builds a closed-by-default panel. Call `.open(triggerEl)` (returned
 * separately by mountPanel) to show it; `close()` hides it and returns focus.
 */
export function createPanel(options: CreatePanelOptions): {
  overlay: HTMLDivElement;
  dialog: HTMLDivElement;
  open: (trigger?: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
} {
  const overlay = document.createElement('div');
  overlay.className = 'tt-panel-overlay';
  overlay.hidden = true;

  const dialog = document.createElement('div');
  dialog.className = 'tt-panel';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  if (options.labelledBy) dialog.setAttribute('aria-labelledby', options.labelledBy);
  dialog.tabIndex = -1;

  overlay.appendChild(dialog);

  let open = false;
  let lastTrigger: HTMLElement | undefined;

  function handleKeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFn();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function handleOverlayClick(event: MouseEvent): void {
    if (event.target === overlay) closeFn();
  }

  function openFn(trigger?: HTMLElement): void {
    if (open) return;
    open = true;
    lastTrigger = trigger;
    overlay.hidden = false;
    overlay.addEventListener('keydown', handleKeydown);
    overlay.addEventListener('mousedown', handleOverlayClick);
    const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? dialog).focus();
  }

  function closeFn(): void {
    if (!open) return;
    open = false;
    overlay.hidden = true;
    overlay.removeEventListener('keydown', handleKeydown);
    overlay.removeEventListener('mousedown', handleOverlayClick);
    options.onClose?.();
    lastTrigger?.focus();
  }

  return { overlay, dialog, open: openFn, close: closeFn, isOpen: () => open };
}
