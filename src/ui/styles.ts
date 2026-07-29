// Original CSS for Tiny Terrarium Works' UI layer. Injected once as a
// <style> tag (see index.ts) rather than imported as a .css module — keeps
// this file plain TypeScript, no bundler-specific asset handling to reason
// about. Cosy/toy-like: rounded shapes, warm palette, generous touch targets.
//
// Theming: CSS custom properties on :root, with a real alternate palette (not
// a border tweak) under [data-contrast="high"]. [data-reduced-motion="true"]
// disables the (already sparse) transitions/animations this layer uses.

export const UI_STYLE_ELEMENT_ID = 'terrarium-ui-styles';

export const UI_CSS = /* css */ `
:root {
  --tt-bg: #142520;
  --tt-panel: #1c3229;
  --tt-panel-raised: #24402f;
  --tt-border: #3a5c46;
  --tt-text: #eef7ee;
  --tt-text-muted: #b9d3c1;
  --tt-accent: #ffb75e;
  --tt-accent-strong: #ff9d3d;
  --tt-good: #7fd88f;
  --tt-info: #7fc4e8;
  --tt-focus: #ffe08a;
  --tt-shadow: rgba(0, 0, 0, 0.35);
  --tt-radius-lg: 22px;
  --tt-radius-md: 16px;
  --tt-radius-sm: 10px;
  --tt-touch: 44px;
  --tt-font: 'Segoe UI', system-ui, -apple-system, sans-serif;
}

:root[data-contrast='high'] {
  --tt-bg: #000000;
  --tt-panel: #050505;
  --tt-panel-raised: #101010;
  --tt-border: #ffffff;
  --tt-text: #ffffff;
  --tt-text-muted: #ffe9a8;
  --tt-accent: #ffd400;
  --tt-accent-strong: #ffe680;
  --tt-good: #5cff8f;
  --tt-info: #7fe0ff;
  --tt-focus: #00e5ff;
  --tt-shadow: rgba(0, 0, 0, 0.9);
}

.tt-root {
  position: fixed;
  inset: 0;
  /* The root layer itself never intercepts pointer events (the canvas sits
     beneath it and needs drag/pan input); each fixed-position child opts
     back in with pointer-events: auto below. */
  pointer-events: none;
  font-family: var(--tt-font);
  color: var(--tt-text);
  -webkit-font-smoothing: antialiased;
}

.tt-hud,
.tt-nav,
.tt-buildmenu,
.tt-onboarding,
.tt-panel-overlay,
.tt-toast-region {
  pointer-events: auto;
}

.tt-root * {
  box-sizing: border-box;
}

.tt-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Focus visibility: always a clear ring, never removed. */
.tt-root button:focus-visible,
.tt-root [tabindex]:focus-visible,
.tt-root input:focus-visible,
.tt-root a:focus-visible {
  outline: 3px solid var(--tt-focus);
  outline-offset: 2px;
}

.tt-root button {
  font-family: inherit;
  color: inherit;
  cursor: pointer;
}

[data-reduced-motion='true'] .tt-root * {
  transition: none !important;
  animation: none !important;
}

/* ---------- HUD ---------- */

.tt-hud {
  position: fixed;
  top: 14px;
  left: 14px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--tt-panel);
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-lg);
  padding: 8px 16px 8px 10px;
  box-shadow: 0 4px 14px var(--tt-shadow);
  min-height: var(--tt-touch);
}

.tt-hud-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.tt-hud-count {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.tt-hud-label {
  font-size: 0.7rem;
  color: var(--tt-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ---------- Nav bar ---------- */

.tt-nav {
  position: fixed;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  gap: 8px;
  background: var(--tt-panel);
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-lg);
  padding: 8px;
  box-shadow: 0 4px 14px var(--tt-shadow);
  max-width: calc(100vw - 24px);
  overflow-x: auto;
}

.tt-nav-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: var(--tt-touch);
  min-height: var(--tt-touch);
  padding: 6px 10px;
  border-radius: var(--tt-radius-md);
  border: 2px solid transparent;
  background: var(--tt-panel-raised);
  color: var(--tt-text);
}

.tt-nav-btn[aria-pressed='true'],
.tt-nav-btn:hover {
  border-color: var(--tt-accent);
  background: color-mix(in srgb, var(--tt-panel-raised) 70%, var(--tt-accent) 30%);
}

.tt-nav-btn svg {
  width: 22px;
  height: 22px;
}

.tt-nav-btn span {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* ---------- Build menu ---------- */

.tt-buildmenu {
  position: fixed;
  bottom: 14px;
  right: 14px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}

.tt-buildmenu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--tt-touch);
  padding: 6px 14px 6px 8px;
  border-radius: var(--tt-radius-lg);
  border: 2px solid var(--tt-border);
  background: var(--tt-panel);
  box-shadow: 0 4px 14px var(--tt-shadow);
}

.tt-buildmenu-item[aria-pressed='true'] {
  border-color: var(--tt-accent);
  background: color-mix(in srgb, var(--tt-panel) 60%, var(--tt-accent) 40%);
}

.tt-buildmenu-item svg {
  width: 24px;
  height: 24px;
}

/* ---------- Dev-only debug panel ---------- */

.tt-debug-panel {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: var(--tt-radius-lg);
  border: 2px dashed #ff5c8a;
  background: rgba(20, 10, 20, 0.82);
  max-width: 260px;
}

.tt-debug-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ff8fb3;
}

.tt-debug-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tt-debug-btn {
  font-size: 12px;
  padding: 6px 8px;
  min-height: 32px;
  border-radius: 8px;
  border: 1px solid #ff8fb3;
  background: #2a1420;
  color: #fff;
  cursor: pointer;
}

.tt-debug-btn-danger {
  border-color: #ff4d4d;
  color: #ffb3b3;
}

.tt-debug-status {
  font-size: 11px;
  color: #cbb;
  min-height: 14px;
}

/* ---------- Onboarding callout ---------- */

.tt-onboarding {
  position: fixed;
  top: 78px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(92vw, 420px);
  background: var(--tt-accent);
  color: #2b1a05;
  border-radius: var(--tt-radius-lg);
  padding: 12px 16px;
  box-shadow: 0 6px 18px var(--tt-shadow);
  pointer-events: auto;
}

.tt-onboarding p {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.tt-onboarding-close {
  flex-shrink: 0;
  width: var(--tt-touch);
  height: var(--tt-touch);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.12);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tt-onboarding-close svg {
  width: 18px;
  height: 18px;
}

/* ---------- Panels (Journal / Upgrades / Achievements / Settings / Credits) ---------- */

.tt-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(6, 12, 9, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

/* .tt-panel-overlay's display:flex and the UA stylesheet's [hidden] rule
   have equal specificity — without this rule, author styles win the tie and
   every panel stays visible regardless of its hidden property. */
.tt-panel-overlay[hidden] {
  display: none;
}

.tt-panel {
  width: min(92vw, 560px);
  max-height: min(86vh, 720px);
  overflow-y: auto;
  background: var(--tt-panel);
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-lg);
  box-shadow: 0 12px 32px var(--tt-shadow);
  padding: 20px;
}

.tt-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.tt-panel-header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.tt-panel-close {
  width: var(--tt-touch);
  height: var(--tt-touch);
  border-radius: 999px;
  border: 2px solid var(--tt-border);
  background: var(--tt-panel-raised);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tt-panel-close svg {
  width: 18px;
  height: 18px;
}

.tt-panel p.tt-panel-desc {
  color: var(--tt-text-muted);
  font-size: 0.88rem;
  margin-top: 0;
}

/* ---------- Journal ---------- */

.tt-journal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}

.tt-journal-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  border-radius: var(--tt-radius-md);
  border: 2px solid var(--tt-border);
  background: var(--tt-panel-raised);
  min-height: 100px;
  text-align: center;
}

.tt-journal-slot[data-discovered='true'] {
  border-color: var(--tt-good);
}

.tt-journal-slot[data-discovered='false'] {
  opacity: 0.55;
}

.tt-journal-slot svg {
  width: 34px;
  height: 34px;
}

.tt-journal-slot span {
  font-size: 0.72rem;
  font-weight: 600;
}

/* ---------- Upgrades ---------- */

.tt-upgrade-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: var(--tt-radius-md);
  border: 2px solid var(--tt-border);
  background: var(--tt-panel-raised);
  margin-bottom: 10px;
}

.tt-upgrade-row svg {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
}

.tt-upgrade-info {
  flex: 1;
  min-width: 0;
}

.tt-upgrade-info h3 {
  margin: 0 0 2px;
  font-size: 0.95rem;
}

.tt-upgrade-info p {
  margin: 0;
  font-size: 0.78rem;
  color: var(--tt-text-muted);
}

.tt-upgrade-meta {
  font-size: 0.72rem;
  color: var(--tt-text-muted);
  margin-top: 2px;
}

.tt-buy-btn {
  min-height: var(--tt-touch);
  min-width: 84px;
  padding: 8px 14px;
  border-radius: var(--tt-radius-md);
  border: 2px solid var(--tt-accent);
  background: var(--tt-accent);
  color: #2b1a05;
  font-weight: 700;
  flex-shrink: 0;
}

.tt-buy-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  border-color: var(--tt-border);
  background: var(--tt-panel);
  color: var(--tt-text-muted);
}

/* ---------- Achievements ---------- */

.tt-achievement-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: var(--tt-radius-md);
  border: 2px solid var(--tt-border);
  background: var(--tt-panel-raised);
  margin-bottom: 10px;
}

.tt-achievement-row[data-unlocked='false'] {
  opacity: 0.5;
}

.tt-achievement-row svg {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

.tt-achievement-row h3 {
  margin: 0 0 2px;
  font-size: 0.9rem;
}

.tt-achievement-row p {
  margin: 0;
  font-size: 0.78rem;
  color: var(--tt-text-muted);
}

.tt-toast-region {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(90vw, 320px);
}

.tt-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--tt-good);
  color: #10240f;
  border-radius: var(--tt-radius-md);
  padding: 10px 14px;
  box-shadow: 0 6px 18px var(--tt-shadow);
  font-size: 0.85rem;
  font-weight: 600;
}

.tt-toast svg {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

/* ---------- Settings ---------- */

.tt-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--tt-border);
}

.tt-settings-row:last-child {
  border-bottom: none;
}

.tt-settings-row label {
  font-size: 0.9rem;
  font-weight: 600;
}

.tt-settings-mute-icon {
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.tt-settings-mute-icon svg {
  width: 100%;
  height: 100%;
}

.tt-slider {
  width: 140px;
  height: var(--tt-touch);
  accent-color: var(--tt-accent);
}

.tt-toggle {
  position: relative;
  width: 56px;
  height: var(--tt-touch);
  min-height: unset;
  border-radius: 999px;
  border: 2px solid var(--tt-border);
  background: var(--tt-panel);
  padding: 0;
}

.tt-toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--tt-text-muted);
}

.tt-toggle[aria-checked='true'] {
  border-color: var(--tt-good);
}

.tt-toggle[aria-checked='true'] .tt-toggle-knob {
  left: 23px;
  background: var(--tt-good);
}

/* ---------- Credits ---------- */

.tt-credits-section {
  margin-bottom: 14px;
}

.tt-credits-section h3 {
  margin: 0 0 6px;
  font-size: 0.9rem;
  color: var(--tt-accent);
}

.tt-credits-section ul {
  margin: 0;
  padding-left: 18px;
  font-size: 0.82rem;
  color: var(--tt-text-muted);
}

.tt-credits-section li {
  margin-bottom: 3px;
}

/* ---------- Return / offline dialog ---------- */

.tt-return-dialog {
  text-align: center;
}

.tt-return-dialog .tt-return-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 10px;
}

.tt-return-dialog h2 {
  margin: 0 0 8px;
}

.tt-return-dialog p {
  margin: 0 0 16px;
  color: var(--tt-text-muted);
}

.tt-return-dismiss {
  min-height: var(--tt-touch);
  padding: 10px 22px;
  border-radius: var(--tt-radius-md);
  border: 2px solid var(--tt-accent);
  background: var(--tt-accent);
  color: #2b1a05;
  font-weight: 700;
}

@media (max-width: 480px) {
  .tt-nav-btn span {
    display: none;
  }
  .tt-nav-btn {
    min-width: var(--tt-touch);
  }
}
`;

export function injectUiStyles(doc: Document = document): void {
  if (doc.getElementById(UI_STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = UI_STYLE_ELEMENT_ID;
  style.textContent = UI_CSS;
  doc.head.appendChild(style);
}
