// GameEvent union copied verbatim from docs/CONTRACTS.md ("Event bus"). Do not
// redefine or rename members here; report needed changes back for a
// CONTRACTS.md update first.

import type { AchievementId, AutomationId, HabitatId, MoodId, SproutTypeId, TransitArtifactKind, UpgradeId } from '../core/ids';
import type { TileCoord } from '../sim/grid';
import type { ConveyorSegment, Port, RouteState, SlideInstance } from '../sim/state';

export type GameEvent =
  | { type: 'sprout:spawned'; sproutId: string; sproutType: SproutTypeId; mood: MoodId; podId: string }
  | { type: 'sprout:pickedUp'; sproutId: string }
  | {
      type: 'sprout:dropped';
      sproutId: string;
      overHabitat: HabitatId | null;
      /**
       * The habitat INSTANCE (Phase 2, buildable habitats) the drop landed
       * on, if any — the concrete home, whose kind is `overHabitat`. The sim
       * adjudicates against the instance; the kind alone is ambiguous once a
       * player has built a second copy. A drop is over AT MOST one of
       * `overHabitat`/`overAutomation`, never both, since the two are
       * disjoint drop-target regions.
       */
      overHabitatInstance?: string | null;
      /**
       * The built automation site (Garden Slide/Colour Gate) the drop landed
       * on, if any — a player putting a Sprout directly onto a helper rather
       * than waiting for it to notice one on its own (GameRules §9.1). A drop
       * is over AT MOST one of `overHabitat`/`overAutomation`, never both,
       * since the two are disjoint drop-target regions. Optional so
       * existing emitters/tests written before it still typecheck (absent ==
       * same as `null`, "over open ground or a habitat").
       */
      overAutomation?: AutomationId | null;
    }
  | { type: 'sprout:placed:correct'; sproutId: string; habitatId: HabitatId; habitatInstanceId: string }
  | { type: 'sprout:placed:incorrect'; sproutId: string; habitatId: HabitatId; habitatInstanceId: string }
  | { type: 'sprout:settled'; sproutId: string; habitatId: HabitatId; habitatInstanceId: string }
  | {
      /**
       * A drop onto a built automation site did NOT board the Sprout — the
       * same "never punitive, always a specific reason" rule
       * `sprout:placed:incorrect` follows for a wrong-habitat drop
       * (GameRules §5.3, §11), for the Garden Slide/Colour Gate case. The
       * Sprout is untouched: still idle, still exactly where it was, still
       * pickable. `reason` is a short code, not prose — src/sim stays
       * decoupled from copywriting (docs/CONTRACTS.md); a listener composes
       * player-facing text from it the way src/ui composes copy from
       * `nursery:rhythmChanged`'s rhythm field.
       */
      type: 'sprout:automationDeclined';
      sproutId: string;
      automationId: AutomationId;
      reason: 'notBuilt' | 'busy' | 'noRoute' | 'wrongKind' | 'destinationFull';
    }
  | { type: 'habitat:dewdropTick'; habitatId: HabitatId; habitatInstanceId: string; amount: number }
  | { type: 'habitat:full'; habitatId: HabitatId; habitatInstanceId: string }
  | {
      type: 'habitat:built';
      /**
       * The player committed building a NEW habitat of an existing kind
       * (Phase 2, plan.yaml Phase 2.2). `habitatId` is the kind; the concrete
       * new home is `habitatInstanceId` at `tile`, starting empty. The
       * renderer creates a fresh habitat visual here; rides from
       * already-built automations begin serving it on their next dispatch.
       * `cost` is what was deducted from the player's Dewdrops.
       */
      habitatId: HabitatId;
      habitatInstanceId: string;
      tile: TileCoord;
      cost: number;
    }
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
       * Where the player placed the structure (2026-08-01, manual placement
       * — GameRules §9.8). The renderer creates/positions the structure's
       * mesh here rather than at a fixed default.
       */
      siteTile: TileCoord;
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
  | { type: 'transit:slideBuilt'; slide: SlideInstance; entryPort: Port; exitPort: Port }
  | { type: 'transit:conveyorBuilt'; conveyor: ConveyorSegment; entryPort: Port; exitPort: Port }
  | { type: 'transit:routeStateChanged'; artifactId: string; artifactKind: TransitArtifactKind; state: RouteState }
  | { type: 'automation:unlocked'; automationId: AutomationId }
  | {
      /**
       * The Colour Gate's active rule changed — which Sprout kind each lane of
       * the fork now invites, `null` meaning "nobody yet".
       *
       * GameRules §9.4 requires the Gate to "visibly show its active rule", and
       * the rule is player-authored state that lives in SimState. Both the
       * Gate's own panel (src/ui) and the structure in the world
       * (src/render/automation.ts) have to be able to show it without reaching
       * into SimState, which docs/CONTRACTS.md forbids — hence an event rather
       * than a getter. Emitted on every change AND once when the Gate is first
       * built (with its safe default: Ember west, Dew east), so a listener that
       * subscribed before the build still learns the starting rule.
       */
      type: 'automation:colourGateRuleChanged';
      lanes: { west: SproutTypeId | null; east: SproutTypeId | null };
    }
  | {
      /**
       * The Mood Bell's active rule changed — which mood it currently
       * welcomes. Mirrors `automation:colourGateRuleChanged`'s reasoning
       * exactly, for a single toggle instead of a 2-lane map. Emitted on
       * every change AND once when the Bell is first built (with its safe
       * default, 'sunny'), so a listener that subscribed before the build
       * still learns the starting rule.
       */
      type: 'automation:moodBellRuleChanged';
      mood: MoodId;
    }
  | {
      /**
       * The Nursery pod changed how briskly it opens, because of how many
       * Sprouts are currently waiting for a home (see src/data/spawning.ts).
       *
       * `'easing'` and `'resting'` are the world-state signal GameRules §9.7
       * asks a bottleneck to be shown through, and the UI turns them into the
       * warm, concrete recovery copy §11 requires ("settle a few, or add
       * Habitat Room"). Fired only when the rhythm actually CHANGES, never per
       * tick — `waitingCount` rides along so the copy can be specific about how
       * many little ones are queueing.
       */
      type: 'nursery:rhythmChanged';
      rhythm: 'lively' | 'easing' | 'resting';
      waitingCount: number;
    }
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
         * Habitat INSTANCES that are already at capacity at load time
         * (Phase 2 — instance ids, not kinds). `habitat:full` only fires on
         * the exact tick a habitat REACHES capacity, so after a reload there
         * is otherwise no way for anything downstream to know a home is full
         * — which the renderer needs in order to show a Garden Slide as
         * blocked (GameRules §9.7) rather than merely idle. Carried in
         * the snapshot rather than by replaying `habitat:full` on load, because
         * replaying it would also replay its SFX and celebratory reactions.
         *
         * Optional so consumers/tests written before it still typecheck.
         */
        fullHabitatInstances?: string[];
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
         * Where each built automation's structure actually stands (2026-08-01,
         * manual placement — GameRules §9.8). A restored save replays no
         * `automation:built`, so without this the renderer has no way to know
         * WHERE a placed structure's mesh belongs — there is no longer a
         * single fixed default tile per automationId to fall back to. Only
         * automations that are actually placed appear here; an unlocked-but-
         * unplaced automation appears in `unlockedAutomations` but not here.
         */
        automationSites?: Partial<Record<AutomationId, TileCoord>>;
        /**
         * Every habitat INSTANCE standing in the restored save (the three
         * originals plus any the player built — Phase 2). A restored save
         * replays no `habitat:built` and the originals' meshes are created at
         * startup, so without this the renderer has no way to know WHERE the
         * player-built copies stand (or even that they exist), and settled
         * Sprouts could not be placed on them. Optional so consumers/tests
         * written before it still typecheck.
         */
        habitatInstances?: {
          id: string;
          habitatId: HabitatId;
          tile: { x: number; z: number };
          count: number;
        }[];
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
          mood: MoodId;
          tile: { x: number; z: number };
          /** 'settled' Sprouts sit in their habitat; everything else waits at the Nursery. */
          settled: boolean;
          habitatId?: HabitatId;
          /** The concrete home instance a settled Sprout sits in (Phase 2). */
          habitatInstanceId?: string;
        }[];
        /**
         * The Colour Gate's restored rule, and the Nursery's restored rhythm.
         * Both are live SimState the UI has to show, and both are announced
         * elsewhere only on CHANGE — so without them in the snapshot a reload
         * would show a Gate with no rule and a lively-looking Nursery that is
         * in fact resting under a queue of waiting Sprouts. Optional so
         * consumers/tests written before them still typecheck.
         */
        colourGateLanes?: { west: SproutTypeId | null; east: SproutTypeId | null };
        moodBellRule?: MoodId;
        nurseryRhythm?: 'lively' | 'easing' | 'resting';
        /** How many Sprouts are waiting for a home right now, to go with `nurseryRhythm`. */
        waitingSproutCount?: number;
      };
    }
  | { type: 'save:written' };

export type GameEventType = GameEvent['type'];

export type GameEventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
