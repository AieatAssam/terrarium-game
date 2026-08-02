// Versioned save envelope per docs/CONTRACTS.md ("Save format"):
// `{ version, sim, meta: { lastSavedAt } }`. `version` covers the envelope +
// SimState shape together; any SimState shape change bumps it, and a new
// case is added to migrateEnvelope. v1 migration is a no-op stub.

import {
  AUTOMATION_SITE_TILES,
  GARDEN_PATH_TILES,
  defaultColourGateLanes,
  HABITAT_TILES,
  nearestReachableHabitat,
} from '../sim/layout';
import { createInitialSimState, type SimState } from '../sim/state';
import { idbDelete, idbGet, idbSet } from './db';

export const CURRENT_SAVE_VERSION = 8;

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
  return normaliseEnvelope(migrateEnvelope(raw));
}

/**
 * Last line of defence after migration: fill in any field the current SimState
 * shape requires but this particular envelope does not carry.
 *
 * Migration handles the honest case — a save written by an older version, whose
 * `version` says exactly which upgrade to run. This handles the dishonest one: a
 * save LABELLED with the current version that nonetheless lacks a current field.
 * That is not hypothetical. It happened during development the moment
 * `CURRENT_SAVE_VERSION` was bumped in one edit and the matching migration case
 * landed in the next: the running dev build loaded a v2 save through the
 * not-yet-written case, fell through to the "unrecognised version" branch, and
 * then autosaved the result back out stamped as v3 with the new fields missing.
 * From then on no migration would ever touch it again, and the Colour Gate came
 * back with an empty rule that routed nobody (found in browser QA).
 *
 * It is deliberately a narrow, additive backfill rather than a deep merge over
 * defaults: it can only ADD a missing key, never overwrite a real saved value,
 * so it cannot silently paper over a migration that is genuinely wrong.
 */
function normaliseEnvelope(envelope: SaveEnvelope): SaveEnvelope {
  const sim = envelope.sim as Partial<SimState> | undefined;
  if (!sim) return envelope;
  const defaults = createInitialSimState(sim.rngSeed ?? 0);
  let patched: SimState | null = null;
  for (const key of Object.keys(defaults) as Array<keyof SimState>) {
    if (sim[key] !== undefined) continue;
    patched ??= { ...(sim as SimState) };
    (patched as unknown as Record<string, unknown>)[key] = defaults[key];
  }
  return patched ? { ...envelope, sim: patched } : envelope;
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
    case 2: {
      // v2 predates the Colour Gate's player-set lane rule and the Nursery's
      // rhythm bookkeeping. Backfill both with the same values a fresh garden
      // starts from — the safe recommended lane cards, and a lively pod, which
      // the very next tick re-derives from how many Sprouts are actually
      // waiting (so a returning 700-Sprout garden correctly settles into
      // 'resting' immediately rather than being told it is lively).
      const sim = envelope.sim as unknown as SimState &
        Partial<Pick<SimState, 'colourGateLanes' | 'nurseryRhythm' | 'nurseryWaitingCount'>>;
      const migratedSim: SimState = {
        ...sim,
        shapeVersion: 3,
        colourGateLanes: sim.colourGateLanes ?? defaultColourGateLanes(),
        nurseryRhythm: sim.nurseryRhythm ?? 'lively',
        // Deliberately 0, not the real count: it is the LAST-ANNOUNCED figure,
        // so leaving it at zero guarantees the first tick after a load announces
        // the true crowd size instead of assuming the player already knows it.
        nurseryWaitingCount: sim.nurseryWaitingCount ?? 0,
      };
      return migrateEnvelope({ ...envelope, version: 3, sim: migratedSim });
    }
    case 3: {
      // v3 predates the Mood Bell feature: SproutInstance had no `mood`
      // field and SimState had no `moodBellRule`. Backfill both and fall
      // through.
      //
      // IMPORTANT: normaliseEnvelope (below) only backfills MISSING
      // TOP-LEVEL SimState keys — it never reaches into `sprouts[]`. It
      // covers a missing `moodBellRule` for free (a top-level key), but
      // this case is the SOLE mechanism backfilling `mood` on individual
      // sprouts. If this case is ever skipped or wrong, a loaded sprout's
      // `mood` silently becomes `undefined`, not a default.
      const sim = envelope.sim as unknown as Omit<SimState, 'sprouts'> &
        Partial<Pick<SimState, 'moodBellRule'>> & {
          sprouts: Array<Omit<SimState['sprouts'][number], 'mood'> & Partial<Pick<SimState['sprouts'][number], 'mood'>>>;
        };
      const migratedSim: SimState = {
        ...sim,
        shapeVersion: 4,
        moodBellRule: sim.moodBellRule ?? 'sunny',
        // Deterministic default — migration is pure and cannot re-roll with
        // RNG, so every pre-existing sprout becomes 'sunny'. A one-time
        // visual quirk for saves that predate mood, not a gameplay concern.
        sprouts: sim.sprouts.map((s) => ({ mood: 'sunny', ...s })) as SimState['sprouts'],
      };
      return migrateEnvelope({ ...envelope, version: 4, sim: migratedSim });
    }
    case 4: {
      // v4 predates manual placement (2026-08-01, plan.yaml Phase 1.2/1.3):
      // AutomationInstance had no `siteTile` field, because every automation
      // was auto-built at a single fixed default tile per automationId
      // (AUTOMATION_SITE_TILES). A v4 save's automations were ALWAYS built
      // at exactly that default — there is no other tile they could have
      // been at — so backfilling from AUTOMATION_SITE_TILES[automationId] is
      // not a guess, it is the true historical value for every pre-existing
      // instance. Same "explicit migration case, not normaliseEnvelope"
      // discipline as v3's per-sprout `mood` backfill above: normaliseEnvelope
      // only fills MISSING TOP-LEVEL SimState keys, never reaches into
      // `automations[]`.
      const sim = envelope.sim as unknown as Omit<SimState, 'automations'> & {
        automations: Array<Omit<SimState['automations'][number], 'siteTile'> & Partial<Pick<SimState['automations'][number], 'siteTile'>>>;
      };
      const migratedSim: SimState = {
        ...sim,
        shapeVersion: 5,
        automations: sim.automations.map((a) => ({ ...a, siteTile: a.siteTile ?? AUTOMATION_SITE_TILES[a.automationId] })) as SimState['automations'],
      };
      return migrateEnvelope({ ...envelope, version: 5, sim: migratedSim });
    }
    case 5: {
      // v5 predates buildable habitats (Phase 2, plan.yaml Phase 2.1/2.2 —
      // the INSTANCE model): SimState.habitats was a
      // Partial<Record<HabitatId, HabitatState>> (one entry per kind that had
      // ever held a Sprout), and habitatDewdropFraction was keyed by kind.
      // Every pre-existing home was by definition the original instance of
      // its kind at HABITAT_TILES[kind], so each becomes `{kind}-1`; kinds
      // with no entry get a fresh empty original instance (a v5 save could
      // legitimately lack a kind nobody had ever settled, and `settleSprout`
      // in v6 requires the instance to exist).
      const sim = envelope.sim as unknown as Omit<SimState, 'habitats' | 'habitatDewdropFraction'> & {
        habitats: Partial<Record<string, { id: string; count: number }>>;
        habitatDewdropFraction: Partial<Record<string, number>>;
      };
      const habitats = (Object.keys(HABITAT_TILES) as Array<keyof typeof HABITAT_TILES>).map((habitatId) => ({
        id: `${habitatId}-1`,
        habitatId,
        tile: HABITAT_TILES[habitatId],
        count: sim.habitats[habitatId]?.count ?? 0,
        builtAtTick: 0,
      }));
      const habitatDewdropFraction: Record<string, number> = {};
      for (const [key, value] of Object.entries(sim.habitatDewdropFraction)) {
        if (value === undefined) continue;
        // Re-key from kind to that kind's original instance id.
        habitatDewdropFraction[`${key}-1`] = value;
      }
      return migrateEnvelope({
        ...envelope,
        version: 6,
        sim: { ...sim, shapeVersion: 6, habitats, habitatDewdropFraction } as SimState,
      });
    }
    case 6: {
      // v6 predates Garden Transit. Its one legacy Slide carried the exact
      // site and computed destination needed to preserve the player's build.
      // The old fixed path is now owned by explicit Conveyor segments, so
      // backfill every tile without charging or changing any other progress.
      const sim = envelope.sim as unknown as SimState & {
        slides?: SimState['slides'];
        conveyors?: SimState['conveyors'];
      };
      const legacySlide = sim.automations.find((a) => a.automationId === 'gardenSlide');
      const slideTile = legacySlide?.siteTile ?? AUTOMATION_SITE_TILES.gardenSlide;
      const fallbackDestination = nearestReachableHabitat(
        slideTile,
        sim.automations.map((a) => a.siteTile),
      ) ?? 'sunflowerMeadow';
      const slides =
        sim.slides && sim.slides.length > 0
          ? sim.slides
          : legacySlide
            ? [
                {
                  id: 'slide-1',
                  tile: slideTile,
                  acceptedKind: 'any' as const,
                  destination:
                    typeof legacySlide.targetHabitatId === 'string' &&
                    Object.prototype.hasOwnProperty.call(HABITAT_TILES, legacySlide.targetHabitatId)
                      ? legacySlide.targetHabitatId
                      : fallbackDestination,
                  enabled: true,
                  builtAtTick: legacySlide.builtAtTick,
                },
              ]
            : [];
      const conveyors =
        sim.conveyors && sim.conveyors.length > 0
          ? sim.conveyors
          : GARDEN_PATH_TILES.map((tile) => ({
              id: `conveyor-${tile.x}-${tile.z}`,
              tile,
              builtAtTick: 0,
            }));
      return migrateEnvelope({
        ...envelope,
        version: 7,
        sim: {
          ...sim,
          shapeVersion: 7,
          slides,
          conveyors,
          automations: sim.automations.filter((a) => a.automationId !== 'gardenSlide'),
        },
      });
    }
    case 7: {
      // v7 introduced configured Slides but did not persist their ride slot.
      // v8 adds the idle/active ride fields so a reload never strands a
      // passenger; missing fields are an idle Slide, not a changed rule.
      const sim = envelope.sim as SimState;
      return migrateEnvelope({
        ...envelope,
        version: 8,
        sim: {
          ...sim,
          shapeVersion: 8,
          slides: sim.slides.map((slide) => ({
            ...slide,
            carryingSproutId: slide.carryingSproutId ?? null,
            fromTile: slide.fromTile ?? slide.tile,
            toTile: slide.toTile ?? HABITAT_TILES[slide.destination],
            completesAtTick: slide.completesAtTick ?? null,
          })),
        },
      });
    }
    case 8:
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
