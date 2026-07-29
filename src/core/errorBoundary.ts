// Catch-and-show-a-friendly-message error boundary. There's no framework
// component tree here (Babylon renders to a canvas), so "boundary" means:
// global error/rejection handlers plus a reportFatalError() call sites can
// use directly from a try/catch, both funnelling into the same friendly UI
// instead of a blank white screen.

const ERROR_CLASS = 'terrarium-error';

export function installErrorBoundary(root: HTMLElement): void {
  window.addEventListener('error', (event) => {
    reportFatalError(root, event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportFatalError(root, event.reason);
  });
}

export function reportFatalError(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[terrarium] fatal error', error);

  const wrapper = document.createElement('div');
  wrapper.className = ERROR_CLASS;
  wrapper.setAttribute('role', 'alert');
  Object.assign(wrapper.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    height: '100%',
    padding: '2rem',
    boxSizing: 'border-box',
    textAlign: 'center',
    fontFamily: 'system-ui, sans-serif',
    color: '#dff5e6',
    background: '#0b1410',
  } satisfies Partial<CSSStyleDeclaration>);

  const title = document.createElement('h1');
  title.textContent = 'Something wilted.';
  title.style.margin = '0';

  const body = document.createElement('p');
  body.textContent =
    "Tiny Terrarium Works hit a snag and couldn't continue. Refreshing usually fixes it.";
  body.style.margin = '0';

  const detail = document.createElement('p');
  detail.textContent = message;
  detail.style.opacity = '0.6';
  detail.style.fontSize = '0.85rem';

  wrapper.append(title, body, detail);
  root.replaceChildren(wrapper);
}
