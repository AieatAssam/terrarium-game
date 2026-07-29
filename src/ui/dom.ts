// Tiny DOM-building helper — no framework, per the brief ("plain DOM/CSS or
// a lightweight approach of your choice", no Babylon GUI, no generic
// component-library look).

export type ElAttrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === 'className') {
      node.className = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key.startsWith('aria-') || key.startsWith('data-')) {
      // ARIA/data attributes are string-valued, not HTML boolean attributes
      // — `aria-pressed` must literally be "true"/"false" for AT and for
      // `[aria-pressed="true"]` CSS selectors; collapsing to
      // presence/absence (like `disabled`) would break both.
      node.setAttribute(key, String(value));
    } else if (value === false) {
      // Real HTML boolean attributes (disabled, hidden, required, ...):
      // false means "attribute absent".
      continue;
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
