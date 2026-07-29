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
  | { type: 'save:loaded'; offlineSeconds: number; offlineDewdrops: number }
  | { type: 'save:written' };

export type GameEventType = GameEvent['type'];

export type GameEventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
