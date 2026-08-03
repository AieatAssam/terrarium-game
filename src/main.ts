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
// Resolved once the renderer has attached its bus subscriptions. The sim still
// starts immediately (below) and ticks on its own clock; this gates ONLY the
// restored-save announcement, which otherwise raced ahead of the renderer —
// see startSimRuntime's `announceWhen` for what that race broke.
let markRendererSubscribed: () => void;
const rendererSubscribed = new Promise<void>((resolve) => {
  markRendererSubscribed = resolve;
});

const simRuntimePromise = startSimRuntime(bus, Date.now(), rendererSubscribed);

// Synchronous handle to the same runtime, for the one UI hook that must answer
// *during* a render pass rather than in a promise callback
// (getUpgradeLockReason). Null only for the brief window before the sim
// resolves, during which no upgrade is purchasable anyway.
let simRuntime: Awaited<typeof simRuntimePromise> | null = null;
void simRuntimePromise.then((sim) => {
  simRuntime = sim;
});

// Same null-tolerant pattern as simRuntime above: input doesn't exist until
// bootstrap()'s async chain resolves, but the build menu (mounted
// synchronously below) can only reach it through these hooks.
// onEnterBuildMode/onExitBuildMode become silent no-ops in the brief window
// before it's ready — the same window nothing is buildable in yet anyway.
let inputHandle: ReturnType<typeof initInput> | null = null;

// F: onboarding/HUD/build menu/panels + the Web Audio synth system. Mounted
// immediately, before the async bootstrap() below, on purpose.
const ui = mountUI(document.body, bus, {
  onPurchaseUpgrade: (upgradeId) => {
    void simRuntimePromise.then((sim) => sim.purchaseUpgrade(upgradeId));
  },
  getUpgradeLockReason: (upgradeId) => simRuntime?.getUpgradeLockReason(upgradeId) ?? null,
  // The Colour Gate's lane cards. Same shape as onPurchaseUpgrade: a plain
  // function on the runtime, because docs/CONTRACTS.md's GameEvent union is all
  // sim-originated announcements and the UI must never touch SimState. The
  // resulting `automation:colourGateRuleChanged` is what the UI and the world
  // both read the new rule back from.
  onSetColourGateLane: (lane, sproutType) => {
    void simRuntimePromise.then((sim) => sim.setColourGateLane(lane, sproutType));
  },
  // The Mood Bell's single rule. Same shape as onSetColourGateLane above.
  onSetMoodBellRule: (mood) => {
    void simRuntimePromise.then((sim) => sim.setMoodBellRule(mood));
  },
  // Build menu -> canvas ghost preview (2026-08-01, manual placement —
  // GameRules §9.8). The menu owns selection state; input owns the actual
  // pointer tracking and placement commit, so these just forward.
  onEnterBuildMode: (automationId) => inputHandle?.enterBuildMode(automationId),
  onEnterHabitatBuildMode: (habitatId) => inputHandle?.enterHabitatBuildMode(habitatId),
  onEnterTransitBuildMode: (kind) => inputHandle?.enterTransitBuildMode(kind),
  onTransitConfigChanged: (config) => inputHandle?.setTransitConfig(config),
  onConfigureSlide: (slideId, configuration) => {
    void simRuntimePromise.then((sim) => sim.configureSlide(slideId, configuration));
  },
  onPreviewSlide: (slideId, configuration) => inputHandle?.previewTransitConfiguration(slideId, configuration),
  onExitBuildMode: () => inputHandle?.exitBuildMode(),
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
  if (!result) {
    markRendererSubscribed(); // fatal-error UI is showing; don't strand the save:loaded announcement
    return;
  }
  const { engine, scene, dispose } = result;
  const canvas = scene.getEngine().getRenderingCanvas() as HTMLCanvasElement;

  void initRenderer({ engine, scene, canvas, bus }).then((renderer) => {
    const input = initInput(renderer, bus, {
      onPlaceAutomation: (automationId, tile) => {
        void simRuntimePromise.then((sim) => sim.placeAutomation(automationId, tile));
      },
      onPlaceHabitat: (habitatId, tile) => {
        void simRuntimePromise.then((sim) => sim.placeHabitat(habitatId, tile));
      },
      onPlaceTransit: (kind, tile, config) => {
        void simRuntimePromise.then((sim) => {
          if (kind === 'gardenSlide') {
            sim.placeSlide({ tile, destination: config?.destination ?? 'sunflowerMeadow', acceptedKind: config?.acceptedKind });
          } else sim.placeConveyor(tile);
        });
      },
      onMoveTransit: (kind, id, tile) => {
        void simRuntimePromise.then((sim) => {
          if (kind === 'gardenSlide') sim.moveSlide(id, tile);
          else sim.moveConveyor(id, tile);
        });
      },
      onRemoveTransit: (kind, id) => {
        void simRuntimePromise.then((sim) => {
          if (kind === 'gardenSlide') sim.removeSlide(id);
          else sim.removeConveyor(id);
        });
      },
      onToggleTransit: (kind, id) => {
        if (kind === 'gardenSlide') void simRuntimePromise.then((sim) => sim.toggleSlide(id));
      },
    });
    inputHandle = input;
    markRendererSubscribed();
    window.addEventListener('beforeunload', () => {
      input.dispose();
      renderer.dispose();
      dispose();
      ui.dispose();
      void simRuntimePromise.then((sim) => sim.dispose());
    });
  });
});
