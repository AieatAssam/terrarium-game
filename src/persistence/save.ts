// Versioned save envelope per docs/CONTRACTS.md ("Save format"):
// `{ version, sim, meta: { lastSavedAt } }`. `version` covers the envelope +
// SimState shape together; any SimState shape change bumps it, and a new
// case is added to migrateEnvelope. v1 migration is a no-op stub.

import type { SimState } from '../sim/state';
import { idbDelete, idbGet, idbSet } from './db';

export const CURRENT_SAVE_VERSION = 2;

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
 * When SimState shape changes, bump CURRENT_SAVE_VERSION, add a `case N`
 * here that upgrades an (N)-envelope to an (N+1)-envelope, and let it fall
 * through to the next case.
 */
function migrateEnvelope(envelope: SaveEnvelope): SaveEnvelope {
  switch (envelope.version) {
    case 1: {
      // v1 SimState predates spawnAccumulatorMs/correctPlacementCount/
      // habitatDewdropFraction and AutomationInstance's builtAtTick/
      // targetHabitatId/carryingSproutId/completesAtTick (added in v2's
      // gameplay-systems pass). Backfill defaults and fall through.
      const sim = envelope.sim as unknown as Omit<SimState, 'automations'> &
        Partial<Pick<SimState, 'spawnAccumulatorMs' | 'correctPlacementCount' | 'habitatDewdropFraction'>> & {
          automations: Array<Partial<SimState['automations'][number]>>;
        };
      const migratedSim: SimState = {
        ...sim,
        shapeVersion: 2,
        spawnAccumulatorMs: sim.spawnAccumulatorMs ?? 0,
        correctPlacementCount: sim.correctPlacementCount ?? 0,
        habitatDewdropFraction: sim.habitatDewdropFraction ?? {},
        automations: sim.automations.map((a) => ({
          builtAtTick: 0,
          carryingSproutId: null,
          completesAtTick: null,
          ...a,
        })) as SimState['automations'],
      };
      return migrateEnvelope({ ...envelope, version: 2, sim: migratedSim });
    }
    case 2:
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
