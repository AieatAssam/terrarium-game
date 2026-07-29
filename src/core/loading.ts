const LOADING_ID = 'terrarium-loading';

export function showLoading(root: HTMLElement): void {
  const el = document.createElement('div');
  el.id = LOADING_ID;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = 'Growing the garden…';
  Object.assign(el.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    fontFamily: 'system-ui, sans-serif',
    color: '#dff5e6',
  } satisfies Partial<CSSStyleDeclaration>);
  root.replaceChildren(el);
}

export function hideLoading(root: HTMLElement): void {
  root.querySelector(`#${LOADING_ID}`)?.remove();
}
