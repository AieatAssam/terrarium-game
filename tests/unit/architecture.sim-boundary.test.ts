// Enforces docs/CONTRACTS.md: "src/sim/ has zero imports from src/render,
// src/ui, src/audio." (src/input included too, same rationale: sim must stay
// pure and platform-agnostic.) Deliberately dependency-free — plain fs +
// regex, no dependency-cruiser — so it can't itself become a maintenance
// burden for downstream agents.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const simDir = resolve(repoRoot, 'src', 'sim');

const FORBIDDEN_DIRS = ['src/render', 'src/ui', 'src/audio', 'src/input'].map((p) =>
  resolve(repoRoot, p),
);

// Matches `from '...'`, `import('...')`, and `require('...')` specifiers.
const IMPORT_SPECIFIER_RE = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return listTsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('architecture: src/sim import boundary', () => {
  it('never imports from src/render, src/ui, src/audio, or src/input', () => {
    const files = listTsFiles(simDir);
    expect(files.length).toBeGreaterThan(0); // guard against a typo'd path silently passing

    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const match of content.matchAll(IMPORT_SPECIFIER_RE)) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) continue; // external packages are fine

        const resolved = resolve(dirname(file), specifier);
        for (const forbidden of FORBIDDEN_DIRS) {
          if (resolved === forbidden || resolved.startsWith(`${forbidden}/`)) {
            violations.push(`${file}: imports forbidden path "${specifier}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
