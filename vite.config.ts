import { defineConfig } from 'vite';

// Tiny Terrarium Works - Vite config.
// Babylon.js picks WebGPU when available and falls back to WebGL automatically
// (see src/core/engine.ts). No special bundler config is required for that;
// we just target a modern-ish baseline since WebGPU needs it anyway.
export default defineConfig({
  // GitHub Pages serves the project at https://<user>.github.io/<repo>/, not at
  // the domain root, so every emitted asset URL needs that prefix. Supplied by
  // the deploy workflow rather than hardcoded, so a fork under a different repo
  // name — and local dev/preview, which stay at "/" — all work unchanged.
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
