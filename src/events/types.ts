// GameEvent union copied verbatim from docs/CONTRACTS.md ("Event bus"). Do not
// redefine or rename members here; report needed changes back for a
// CONTRACTS.md update first.

import type { AchievementId, AutomationId, HabitatId, SproutTypeId, UpgradeId } from '../core/ids';
import type { TileCoord } from '../sim/grid';

export type GameEvent =
  | { type: 'sprout:spawned'; sproutId: string; sproutType: SproutTypeId; podId: string }
  | { type: 'sprout:pickedUp'; sproutId: string }
  | { type: 'sprout:dropped'; sproutId: string; overHabitat: HabitatId | null }
  | { type: 'sprout:placed:correct'; sproutId: string; habitatId: HabitatId }
  | { type: 'sprout:placed:incorrect'; sproutId: string; habitatId: HabitatId }
  | { type: 'sprout:settled'; sproutId: string; habitatId: HabitatId }
  | { type: 'habitat:dewdropTick'; habitatId: HabitatId; amount: number }
  | { type: 'habitat:full'; habitatId: HabitatId }
  | { type: 'currency:dewdropsChanged'; total: number; delta: number }
  | {
      type: 'sprout:transportStarted';
      sproutId: string;
      automationId: AutomationId;
      instanceId: string;
      fromTile: TileCoord;
      toTile: TileCoord;
      /**
       * How long this ride will actually take, in milliseconds, as the
       * SIMULATION computed it — i.e. `durationTicks * TICK_MS`, already
       * including the `gardenSlideSpeed` upgrade.
       *
       * The renderer MUST animate over exactly this interval rather than
       * deriving its own duration. Both sides used to compute a duration
       * independently from the same 420ms-per-tile constant, but only the sim
       * side applied the speed upgrade — so buying Garden Slide Speed changed
       * when a Sprout settled without changing how fast it appeared to travel,
       * and the two drifted further apart with every upgrade level (a real
       * defect: the upgrade had no visible effect, which GameRules §8.3
       * forbids). Sim is the single authority; this field is how that
       * authority reaches the renderer.
       */
      durationMs: number;
    }
  | {
      type: 'sprout:transportCompleted';
      sproutId: string;
      automationId: AutomationId;
      instanceId: string;
    }
  | {
      type: 'automation:built';
      automationId: AutomationId;
      instanceId: string;
      /**
       * The single habitat this instance delivers to, when it has one (Garden
       * Slide). Absent for the Colour Gate, which routes each Sprout to its own
       * matching habitat rather than to one fixed destination.
       *
       * Optional so existing emitters/tests that predate it still typecheck.
       * The renderer uses it to show a built Slide as *blocked* (GameRules §9.7)
       * the moment its destination habitat fills up — including before the Slide
       * has ever run a delivery, which is exactly the case that carries no
       * `sprout:transportStarted` to infer a destination from.
       */
      targetHabitatId?: HabitatId;
    }
  | { type: 'automation:unlocked'; automationId: AutomationId }
  | { type: 'upgrade:purchased'; upgradeId: UpgradeId; level: number }
  | { type: 'achievement:unlocked'; achievementId: AchievementId }
  | { type: 'journal:entryDiscovered'; sproutType: SproutTypeId }
  | {
      type: 'save:loaded';
      offlineSeconds: number;
      offlineDewdrops: number;
      /**
       * Full restored-state snapshot so UI-side stores (src/ui/uiState.ts)
       * can hydrate silently on load instead of only ever mirroring live
       * events going forward (a real bug found during QA: dewdrops/
       * unlocks/achievements/journal all read back as fresh defaults right
       * after a reload even though the persisted SimState was correct).
       * Deliberately separate from `dewdropTotal`/etc's celebratory
       * counterparts (`achievement:unlocked` etc) — a UI reducer for this
       * event must NOT set `lastAchievementUnlocked`/`lastBuiltAutomation`
       * or anything else that would replay a toast/SFX for old history.
       */
      snapshot: {
        dewdrops: number;
        unlockedAutomations: AutomationId[];
        upgradeLevels: Partial<Record<UpgradeId, number>>;
        unlockedAchievements: AchievementId[];
        journalDiscovered: SproutTypeId[];
        /**
         * Habitats that are already at capacity at load time. `habitat:full`
         * only fires on the exact tick a habitat REACHES capacity, so after a
         * reload there is otherwise no way for anything downstream to know a
         * home is full — which the renderer needs in order to show a Garden
         * Slide as blocked (GameRules §9.7) rather than merely idle. Carried in
         * the snapshot rather than by replaying `habitat:full` on load, because
         * replaying it would also replay its SFX and celebratory reactions.
         *
         * Optional so consumers/tests written before it still typecheck.
         */
        fullHabitats?: HabitatId[];
        /**
         * Where each built automation delivers to, for the same reason: a
         * restored save replays no `automation:built`, so without this the
         * renderer knows a Garden Slide exists but not which home it serves —
         * and therefore cannot tell whether `fullHabitats` blocks it. Together
         * these two fields let a garden that was jammed when the player left
         * still look jammed when they come back, instead of quietly reading as
         * idle until the next delivery.
         *
         * Only automations with a single fixed destination appear here (the
         * Garden Slide); the Colour Gate routes per-Sprout and has none.
         */
        automationTargets?: Partial<Record<AutomationId, HabitatId>>;
        /**
         * Every Sprout alive in the restored save. Meshes are built from
         * `sprout:spawned`, which by definition never replays for Sprouts that
         * were already alive when the game was saved — so without this the
         * garden came back visually empty no matter how the load was ordered
         * (measured: 15 Sprout meshes before a reload, 1 after). Carried in the
         * snapshot rather than by replaying `sprout:spawned` per Sprout, which
         * would fire pod-open SFX and reveal animations for creatures the
         * player met long ago.
         *
         * Optional so consumers/tests written before it still typecheck.
         */
        sprouts?: {
          id: string;
          sproutType: SproutTypeId;
          tile: { x: number; z: number };
          /** 'settled' Sprouts sit in their habitat; everything else waits at the Nursery. */
          settled: boolean;
          habitatId?: HabitatId;
        }[];
      };
    }
  | { type: 'save:written' };

export type GameEventType = GameEvent['type'];

export type GameEventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
