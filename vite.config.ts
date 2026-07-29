import { defineConfig } from 'vite';

// Tiny Terrarium Works - Vite config.
// Babylon.js picks WebGPU when available and falls back to WebGL automatically
// (see src/core/engine.ts). No special bundler config is required for that;
// we just target a modern-ish baseline since WebGPU needs it anyway.
export default defineConfig({
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
