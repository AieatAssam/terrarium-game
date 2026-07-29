// App bootstrap: wires the error boundary + loading state around Babylon
// engine/scene creation. This is intentionally a placeholder scene — Subagent
// E owns src/render (camera, meshes, sprites, particles, picking) and will
// replace createPlaceholderScene's contents with the real one. Bootstrap's
// job is just: don't show a blank white screen, ever.

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

import { installErrorBoundary, reportFatalError } from './errorBoundary';
import { createEngine } from './engine';
import { isDev } from './env';
import { hideLoading, showLoading } from './loading';

export interface BootstrapResult {
  engine: AbstractEngine;
  scene: Scene;
  /**
   * Tears down the render loop, resize listener, scene and engine. E should
   * call this before installing its own engine/scene/camera so the
   * placeholder doesn't leak a resize handler or fight the real camera for
   * pointer input.
   */
  dispose: () => void;
}

export async function bootstrap(root: HTMLElement): Promise<BootstrapResult | undefined> {
  installErrorBoundary(root);
  showLoading(root);

  try {
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';

    const engine = await createEngine(canvas);
    const scene = createPlaceholderScene(engine);

    const renderLoop = () => scene.render();
    engine.runRenderLoop(renderLoop);

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    root.replaceChildren(canvas);
    hideLoading(root);

    if (isDev) {
      console.info('[terrarium] dev mode: sim/events/persistence scaffolding ready.');
    }

    const dispose = () => {
      window.removeEventListener('resize', handleResize);
      engine.stopRenderLoop(renderLoop);
      scene.dispose();
      engine.dispose();
    };

    return { engine, scene, dispose };
  } catch (error) {
    reportFatalError(root, error);
    return undefined;
  }
}

function createPlaceholderScene(engine: AbstractEngine): Scene {
  const scene = new Scene(engine);
  // Cosy dark placeholder background; E replaces this with the real garden.
  scene.clearColor = new Color4(0.043, 0.078, 0.063, 1);

  // A scene needs an active camera to render at all — this placeholder exists
  // purely so scene.render() doesn't throw. Deliberately does NOT call
  // attachControl: wiring pointer/wheel input here would fight Subagent E's
  // real camera (src/input/) for the canvas. E replaces this whole scene via
  // dispose() above before it ever needs to care about this camera.
  new ArcRotateCamera('placeholderCamera', -Math.PI / 2, Math.PI / 3, 10, Vector3.Zero(), scene);

  return scene;
}
