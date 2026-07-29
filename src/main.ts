import { bootstrap } from './core/bootstrap';
import { EventBus } from './events';
import { initInput } from './input/index';
import { initRenderer } from './render/index';
import { mountUI } from './ui';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element #app not found');
}

// Composition root. Kept intentionally tiny: bootstrap() builds
// {engine, scene}; render/index.ts + input/index.ts (Subagent E) do the
// rest. `bus` is hoisted above bootstrap() (was previously created inside
// the .then() below) so Subagent F's UI/audio can mount synchronously on the
// SAME bus instance sim/render will use, without waiting on Babylon engine
// setup — the onboarding callout must be visible well within 5s regardless
// of asset/engine load time.
const bus = new EventBus();

// F: onboarding/HUD/build menu/panels + the Web Audio synth system. Mounted
// immediately, before the async bootstrap() below, on purpose.
const ui = mountUI(document.body, bus);

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
    });
  });
});
