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
.tt-transit-panel,
.tt-onboarding,
.tt-panel-overlay,
.tt-toast-region,
.tt-nursery-note,
.tt-debug-panel {
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
  transition: transform 0.08s ease;
}

/* Every button gets a press-down on click/tap — previously nothing in this
   file gave a click any feedback at all, so a tap that missed (declined by
   the sim, or just slow) looked identical to one that landed. */
.tt-root button:not(:disabled):active {
  transform: translateY(1px);
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

/* The "display: flex" above beats the hidden attribute's UA "display: none", so
   a nav entry gated on ownership (the Colour Gate) stayed visible even with
   hidden set — caught in browser QA, where the Gate's button sat in the bar of a
   garden that did not own one. */
.tt-nav-btn[hidden] {
  display: none;
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

.tt-nav-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
}

.tt-nav-btn .tt-nav-label {
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

.tt-buildmenu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tt-buildmenu-item svg {
  width: 24px;
  height: 24px;
}

.tt-transit-config {
  display: grid;
  gap: 6px;
  min-width: 220px;
  padding: 8px 10px;
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-md);
  background: var(--tt-panel);
  box-shadow: 0 4px 14px var(--tt-shadow);
  color: var(--tt-text);
  font-size: 0.78rem;
}

.tt-transit-config label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tt-transit-config select {
  min-height: 32px;
  max-width: 150px;
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
  background: var(--tt-panel-raised);
  color: var(--tt-text);
  font: inherit;
}

.tt-buildmenu-status {
  max-width: 280px;
  padding: 8px 12px;
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-md);
  background: var(--tt-panel);
  color: var(--tt-text);
  font-size: 0.78rem;
  line-height: 1.25;
  text-align: left;
  box-shadow: 0 4px 14px var(--tt-shadow);
}

.tt-buildmenu-status[data-placement-state='valid'] {
  border-style: solid;
}

.tt-buildmenu-status[data-placement-state='invalid'] {
  border-style: dashed;
}

.tt-buildmenu-status[data-placement-state='blocked'] {
  border-style: double;
}

/* ---------- Garden transit rules ---------- */

.tt-transit-panel {
  position: fixed;
  right: 400px;
  bottom: 98px;
  z-index: 21;
  width: min(360px, calc(100vw - 28px));
  color: var(--tt-text);
}

.tt-transit-panel[hidden] {
  display: none;
}

.tt-transit-panel-toggle,
.tt-transit-panel-body {
  width: 100%;
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-md);
  background: var(--tt-panel);
  box-shadow: 0 4px 14px var(--tt-shadow);
}

.tt-transit-panel-toggle {
  min-height: var(--tt-touch);
  padding: 8px 14px;
  text-align: left;
  font-weight: 700;
}

.tt-transit-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-md);
  background: var(--tt-panel);
  box-shadow: 0 4px 14px var(--tt-shadow);
}

.tt-transit-action {
  min-height: var(--tt-touch);
  padding: 8px 10px;
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
  background: var(--tt-panel-raised);
  color: var(--tt-text);
  font-weight: 800;
}

.tt-transit-action-danger {
  border-color: var(--tt-accent-warm);
  color: var(--tt-accent-warm);
}

.tt-transit-panel-body {
  display: grid;
  gap: 10px;
  max-height: min(70vh, 560px);
  margin-bottom: 8px;
  padding: 12px;
  overflow: auto;
}

.tt-transit-panel-body h2 {
  margin: 0;
  font-size: 1rem;
}

.tt-transit-panel-copy,
.tt-transit-card-status,
.tt-transit-preview-copy,
.tt-transit-recovery {
  margin: 0;
  color: var(--tt-text-muted);
  font-size: 0.78rem;
  line-height: 1.35;
}

.tt-transit-recovery {
  color: var(--tt-text);
  font-weight: 700;
}

.tt-transit-card {
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
  background: var(--tt-panel-raised);
}

.tt-transit-card summary {
  display: flex;
  min-height: var(--tt-touch);
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
}

.tt-transit-card summary:focus-visible {
  outline: 3px solid var(--tt-focus);
  outline-offset: -3px;
}

.tt-transit-card-title {
  min-width: 0;
}

.tt-transit-status-pill {
  flex: 0 0 auto;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--tt-good);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tt-transit-status-pill[data-status='paused'] {
  color: var(--tt-accent);
}

.tt-transit-card-body {
  display: grid;
  gap: 8px;
  padding: 0 10px 10px;
}

.tt-transit-card-body label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.78rem;
}

.tt-transit-card-body select {
  min-height: 36px;
  max-width: 190px;
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
  background: var(--tt-bg);
  color: var(--tt-text);
  font: inherit;
}

.tt-transit-check {
  justify-content: flex-start !important;
}

.tt-transit-check input {
  width: 20px;
  height: 20px;
  accent-color: var(--tt-accent);
}

.tt-transit-preview-copy {
  border-left: 3px solid var(--tt-info);
  padding-left: 8px;
  color: var(--tt-info);
}

.tt-transit-apply {
  min-height: 40px;
  border: 2px solid var(--tt-accent);
  border-radius: var(--tt-radius-sm);
  background: var(--tt-accent);
  color: #2b1a05;
  font-weight: 800;
}

.tt-transit-apply:disabled {
  border-color: var(--tt-border);
  background: var(--tt-panel);
  color: var(--tt-text-muted);
  cursor: not-allowed;
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

/* Explains a behavioral (non-price) lock, e.g. the Colour Gate's. Warm and
   advisory rather than an error colour — GameRules.md §11 asks recovery copy
   to read as friendly guidance, not a failure. */
.tt-upgrade-lock {
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--tt-accent-warm, #e0a24a);
  margin-top: 4px;
}

.tt-upgrade-lock[hidden] {
  display: none;
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
  width: 64px;
  height: var(--tt-touch);
  min-height: var(--tt-touch);
  border: 0;
  background: transparent;
  padding: 0;
}

.tt-toggle::before {
  content: '';
  position: absolute;
  inset: 6px 0;
  border: 2px solid var(--tt-border);
  border-radius: 999px;
  background: var(--tt-panel);
}

.tt-toggle-knob {
  position: absolute;
  z-index: 1;
  top: 9px;
  left: 3px;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--tt-text-muted);
}

.tt-toggle[aria-checked='true']::before {
  border-color: var(--tt-good);
}

.tt-toggle[aria-checked='true'] .tt-toggle-knob {
  left: 35px;
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

@media (max-width: 900px) {
  .tt-nav-btn .tt-nav-label {
    display: none;
  }
  .tt-nav-btn {
    min-width: var(--tt-touch);
  }
  /* At this width the nav bar's icon row (padding 8 + 44px touch target +
     2px border each side = 64px tall) and the build menu both anchor to
     bottom:14px — the nav centred, the build menu right-aligned — and their
     boxes collide (confirmed via getBoundingClientRect at 375px: nav right
     edge 323.5px, build menu left edge 223.7px). Stack the build menu above
     the nav instead of beside it rather than shrinking either further. */
  .tt-buildmenu {
    bottom: 86px;
  }
  .tt-transit-panel {
    right: 14px;
    bottom: 170px;
  }
}

/* ---------- Nursery note (GameRules §9.7 bottleneck, §11 recovery copy) ----- */
/* Sits directly under the Dewdrop counter, so the reason the garden has gone
   quiet is right where the player is already looking. Warm amber, deliberately
   never red — this is an invitation to tidy up, not an alarm. */

.tt-nursery-note {
  position: fixed;
  top: 74px;
  left: 14px;
  z-index: 19;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  background: var(--tt-panel);
  border: 2px solid var(--tt-accent);
  border-left-width: 6px;
  border-radius: var(--tt-radius-md);
  padding: 10px 14px;
  box-shadow: 0 4px 14px var(--tt-shadow);
}

.tt-nursery-note[hidden] {
  display: none;
}

.tt-nursery-note-title {
  font-size: 0.95rem;
  color: var(--tt-accent);
}

.tt-nursery-note-body {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--tt-text-muted);
}

.tt-nursery-note-action {
  min-height: 36px;
  padding: 6px 14px;
  border-radius: var(--tt-radius-sm);
  border: 2px solid var(--tt-accent);
  background: transparent;
  color: var(--tt-accent);
  font-weight: 700;
  font-size: 0.8rem;
}

.tt-nursery-note-action:hover {
  background: var(--tt-accent);
  color: #2b1a05;
}

/* ---------- Colour Gate panel (GameRules §9.4 pictorial controls) ---------- */
/* Everything the player touches here is a big picture with a name under it.
   No text field, no dropdown, no logic — a lane card and a row of portraits. */

.tt-gate-intro {
  margin: 0 0 14px;
  font-size: 0.88rem;
  line-height: 1.5;
  color: var(--tt-text-muted);
}

.tt-gate-lanes {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.tt-gate-lane {
  flex: 1 1 260px;
  background: var(--tt-panel-raised);
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-md);
  padding: 14px;
}

/* A lane whose card names a kind that lane's home does not welcome. Amber, and
   paired with the note text below it — never colour alone. */
.tt-gate-lane.is-mismatched {
  border-color: var(--tt-accent);
}

.tt-gate-lane h3 {
  margin: 0 0 4px;
  font-size: 0.95rem;
}

.tt-gate-summary {
  margin: 0 0 12px;
  font-size: 0.85rem;
  color: var(--tt-text-muted);
}

.tt-gate-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tt-gate-choice {
  flex: 1 1 84px;
  min-width: 84px;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 6px;
  background: var(--tt-panel);
  border: 2px solid var(--tt-border);
  border-radius: var(--tt-radius-md);
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.tt-gate-choice:hover {
  transform: translateY(-2px);
}

/* Chosen state carries THREE signals at once — border, background lift and a
   raised weight — so it never depends on colour perception alone. */
.tt-gate-choice.is-active {
  border-color: var(--tt-accent);
  background: var(--tt-panel-raised);
  box-shadow: inset 0 0 0 2px var(--tt-accent);
}

.tt-gate-choice-art {
  width: 44px;
  height: 44px;
  display: block;
}

.tt-gate-choice-art svg {
  width: 100%;
  height: 100%;
}

.tt-gate-choice-art--none {
  color: var(--tt-text-muted);
}

.tt-gate-choice-name {
  font-size: 0.74rem;
  font-weight: 700;
  text-align: center;
  line-height: 1.25;
}

.tt-gate-note {
  margin: 12px 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--tt-accent);
}

.tt-gate-note[hidden] {
  display: none;
}
`;

export function injectUiStyles(doc: Document = document): void {
  if (doc.getElementById(UI_STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = UI_STYLE_ELEMENT_ID;
  style.textContent = UI_CSS;
  doc.head.appendChild(style);
}
