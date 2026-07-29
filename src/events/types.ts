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
    }
  | {
      type: 'sprout:transportCompleted';
      sproutId: string;
      automationId: AutomationId;
      instanceId: string;
    }
  | { type: 'automation:built'; automationId: AutomationId; instanceId: string }
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
      };
    }
  | { type: 'save:written' };

export type GameEventType = GameEvent['type'];

export type GameEventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
