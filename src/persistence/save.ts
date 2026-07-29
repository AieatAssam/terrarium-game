// Versioned save envelope per docs/CONTRACTS.md ("Save format"):
// `{ version, sim, meta: { lastSavedAt } }`. `version` covers the envelope +
// SimState shape together; any SimState shape change bumps it, and a new
// case is added to migrateEnvelope. v1 migration is a no-op stub.

import type { SimState } from '../sim/state';
import { idbDelete, idbGet, idbSet } from './db';

export const CURRENT_SAVE_VERSION = 1;

const SAVE_KEY = 'default';

export interface SaveEnvelope {
  version: number;
  sim: SimState;
  meta: {
    lastSavedAt: number;
  };
}

export async function saveGame(sim: SimState, now: number = Date.now()): Promise<void> {
  const envelope: SaveEnvelope = {
    version: CURRENT_SAVE_VERSION,
    sim,
    meta: { lastSavedAt: now },
  };
  await idbSet(SAVE_KEY, envelope);
}

export async function loadGame(): Promise<SaveEnvelope | undefined> {
  const raw = await idbGet<SaveEnvelope>(SAVE_KEY);
  if (!raw) return undefined;
  return migrateEnvelope(raw);
}

export async function clearSave(): Promise<void> {
  await idbDelete(SAVE_KEY);
}

/**
 * v1 -> v1 is a no-op. When SimState shape changes, bump
 * CURRENT_SAVE_VERSION, add a `case N` here that upgrades an (N)-envelope to
 * an (N+1)-envelope, and let it fall through to the next case.
 */
function migrateEnvelope(envelope: SaveEnvelope): SaveEnvelope {
  switch (envelope.version) {
    case 1:
      return envelope;
    default:
      // Unknown version (older pre-migration save, or a newer one this build
      // doesn't understand yet). Hand it back as-is rather than throwing —
      // callers decide whether to trust it — but this is loud on purpose:
      // silently accepting an unrecognised shape is how saves get corrupted.
      console.warn(
        `[persistence] save envelope has unrecognised version ${envelope.version}; ` +
          `expected ${CURRENT_SAVE_VERSION}. Loading as-is.`,
      );
      return envelope;
  }
}
