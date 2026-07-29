// Background-tab throttle. bootstrap.ts owns the render loop
// (`engine.runRenderLoop`, called with a closure E has no reference to) and
// this module deliberately doesn't replace it — it just pauses/resumes it on
// visibilitychange. `engine.stopRenderLoop()` called with no argument clears
// every registered render loop (Babylon's documented behavior), which is
// exactly what "pause while backgrounded" needs; resuming re-registers an
// equivalent `() => scene.render()` loop (functionally identical to
// bootstrap's, just a different closure) rather than a real "resume" —
// there's nothing to resume, `scene.render()` reads current state each call.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Scene } from '@babylonjs/core/scene';

export function installVisibilityThrottle(engine: AbstractEngine, scene: Scene): () => void {
  const renderLoop = (): void => scene.render();

  const handleVisibility = (): void => {
    if (document.hidden) {
      engine.stopRenderLoop();
    } else {
      engine.stopRenderLoop();
      engine.runRenderLoop(renderLoop);
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}
