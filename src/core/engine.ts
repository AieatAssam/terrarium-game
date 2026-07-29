// WebGPU-when-available, WebGL-fallback engine creation. This is the one
// place that decides which Babylon engine backend to instantiate; everything
// downstream (Subagent E's renderer) works against AbstractEngine/Scene and
// doesn't need to know which backend won.
//
// IMPORTANT: this module only *creates* an engine when createEngine() is
// called — nothing here runs at import time. Tests must not call
// createEngine() (jsdom has no WebGL/WebGPU canvas backing), but importing
// this module is always safe.

import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';

export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  if (await isWebGPUSupported()) {
    const engine = new WebGPUEngine(canvas, {
      antialias: true,
    });
    await engine.initAsync();
    return engine;
  }

  return new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
  });
}

async function isWebGPUSupported(): Promise<boolean> {
  try {
    return await WebGPUEngine.IsSupportedAsync;
  } catch {
    return false;
  }
}
