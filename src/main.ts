import { bootstrap } from './core/bootstrap';
import { EventBus } from './events';
import { initInput } from './input/index';
import { initRenderer } from './render/index';
import { startSimRuntime } from './sim/runtime';
import { mountUI } from './ui';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element #app not found');
}

// Composition root. Kept intentionally tiny: bootstrap() builds
// {engine, scene}; render/index.ts + input/index.ts (Subagent E) render and
// pick against it; src/sim/runtime.ts owns all gameplay (spawning,
// placement, Dewdrops, automation, upgrades, achievements), driven purely
// over the shared bus — nothing here simulates anything itself. `bus` is
// hoisted above bootstrap() so Subagent F's UI/audio can mount synchronously
// on the SAME bus instance sim/render will use, without waiting on Babylon
// engine setup — the onboarding callout must be visible well within 5s
// regardless of asset/engine/sim-load time.
const bus = new EventBus();

// Sim doesn't need the Babylon engine/scene at all — start it immediately,
// in parallel with bootstrap()/UI mount, so Dewdrops/spawns/automation begin
// on their own clock rather than waiting on asset or engine load.
const simRuntimePromise = startSimRuntime(bus);

// F: onboarding/HUD/build menu/panels + the Web Audio synth system. Mounted
// immediately, before the async bootstrap() below, on purpose.
const ui = mountUI(document.body, bus, {
  onPurchaseUpgrade: (upgradeId) => {
    void simRuntimePromise.then((sim) => sim.purchaseUpgrade(upgradeId));
  },
  debug: {
    spawnSprout: (sproutType) => {
      void simRuntimePromise.then((sim) => sim.debug.spawnSprout(sproutType));
    },
    grantDewdrops: (amount) => {
      void simRuntimePromise.then((sim) => sim.debug.grantDewdrops(amount));
    },
    setSpeedMultiplier: (multiplier) => {
      void simRuntimePromise.then((sim) => sim.debug.setSpeedMultiplier(multiplier));
    },
    resetSave: () => simRuntimePromise.then((sim) => sim.resetSave()),
  },
});

void bootstrap(root).then((result) => {
  if (!result) return; // bootstrap already showed the fatal-error UI
  const { engine, scene, dispose } = result;
  const canvas = scene.getEngine().getRenderingCanvas() as HTMLCanvasElement;

  void initRenderer({ engine, scene, canvas, bus }).then((renderer) => {
    const input = initInput(renderer, bus);
    window.addEventListener('beforeunload', () => {
      input.dispose();
      renderer.dispose();
      dispose();
      ui.dispose();
      void simRuntimePromise.then((sim) => sim.dispose());
    });
  });
});
