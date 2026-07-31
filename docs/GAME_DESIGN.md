# Tiny Terrarium Works — Game Design

Owned by Subagent B (docs/GAME_DESIGN.md, src/data/). Authority for shared
interfaces is docs/CONTRACTS.md; this document explains and justifies the
*values* B chose inside those interfaces, and the player-facing design they
serve. Art direction (palette, silhouette rules, animation timing) lives in
`docs/ART_DIRECTION.md`, owned by Subagent C — referenced here, not
duplicated.

> **Status note:** everything in this document describing minute-by-minute
> pacing or Dewdrop totals is a *design projection* computed from the tuned
> constants in `src/data/`, not an observed result from playing the finished
> game (the game isn't fully playable yet — rendering, input, and UI are
> being built in parallel by other agents). Treat the numbers as "checkable
> math," not "playtested." Per `IMPLEMENTATION_PLAN.yaml`'s QA phases, actual
> observed timings belong in `docs/ART_QA_REPORT.md` / `docs/QA_REPORT.md`
> after the game runs end to end.

## Player experience and fantasy

You tend a tiny terrarium. Sprouts — small, friendly creatures shaped like
plant/critter hybrids — hatch from a nursery pod one at a time and wander
toward you. Your only real job at first is simple and legible: pick each one
up and set it down in the habitat that matches it (warm Ember Sprouts in the
Ember Nook, cool Dew Sprouts in the Dew Pond, bright Sun Sprouts in the
Sunflower Meadow). Getting it right feels good — a small settle animation, a
Dewdrop trickle starts. Getting it wrong is never punished, just gently
corrected: the Sprout wobbles, waits, and can be tried again.

The fantasy is *caretaking, not managing*. There's no timer, no fail state,
no resource you can lose. The tension that keeps play interesting isn't risk,
it's a mild, cosy friction: sorting by hand is satisfying at first and then
becomes something you'd rather delegate — which is exactly when the game
hands you the tools to delegate it (Garden Slide, then Colour Gate), so
automation reads as a reward for noticing the friction, not a stat to grind
toward.

## First-session beat sheet

### First 5 minutes (second by second)

- **0:00** — Scene loads on the empty terrarium: nursery pod, three empty
  habitat plots, soft ambient motion. No text needed — the pod is visibly the
  only interactive thing in frame (E/F's job to make this obvious within 5s
  per the plan's acceptance bar).
- **~0:05–0:12** — First pod spawns a Sprout (base pod interval is 12s, but
  the very first pod is expected to fire close to scene-ready so the player
  isn't staring at nothing — an E/F implementation detail, not a data value).
  It's an Ember, Dew, or Sun Sprout roughly equally (94% combined chance; see
  "Star Sprout rarity" below) — first-time players are very unlikely to meet
  the rare Star Sprout on pod #1.
  - `sprout:spawned` fires.
- **~0:12–0:20** — Player drags the Sprout to a habitat. Correct guess (or a
  lucky one — the colour+shape match is meant to be legible even without
  instruction): `sprout:placed:correct`, the Sprout walks in and
  `sprout:settled` fires a beat later. `firstPlacement` achievement unlocks
  immediately. Wrong guess: `sprout:placed:incorrect`, friendly retry, no
  penalty, `sprout:dropped` with `overHabitat` telling the UI what to
  highlight next time.
- **0:20 – ~4:30** — This loop repeats roughly every 12 seconds (a new pod)
  while the player keeps sorting by hand. Dewdrops start trickling in as soon
  as the *first* Sprout settles (`habitat:dewdropTick` fires every tick a
  habitat holds settled Sprouts). Habitats are small on purpose (capacity 6
  each) — by the middle of this window at least one habitat is likely to
  fill up, firing `habitat:full` and the `firstFullHabitat` achievement. This
  is the first hint that "capacity" is a thing the player might want to grow.
- **~4:30–5:00** — After 20 correct manual placements, Garden Slide unlocks
  and auto-builds (`automation:unlocked` then `automation:built`), ALWAYS
  targeting Sunflower Meadow (Sun Sprouts) — changed 2026-07-31 from
  "whichever habitat the player has been feeding most" because the Colour
  Gate's fork can never physically reach the Meadow (its two lanes leave from
  the northern fork; the Meadow sits on the separate southern run out of the
  Nursery), so the Slide is the only automation that ever will. See
  `unlockSystem`'s own doc comment (`src/sim/systems.ts`) and
  `docs/ARCHITECTURE.md`. `firstAutomation` achievement unlocks. See
  "Progression math" below for why 20 lands here.

### Arc to 15–25 minutes

- **~5–9 min** — Garden Slide now carries Sun Sprouts automatically to the
  Meadow. Ember and Dew keep spawning and need manual sorting, so a small
  "unsorted pile" starts building near the nursery — the first felt sense
  that one slide isn't enough. This is a firmer setup for the Colour Gate
  than the old "whichever two types weren't picked" framing: the pile is now
  ALWAYS "Ember and Dew", which is exactly what the Gate's two lanes exist to
  solve. Once the slide has fed the Meadow continuously for
  30 seconds *and* at least 3 Sprouts of another type are waiting unsorted at
  once, the Colour Gate becomes purchasable in the build menu (behavioral
  unlock — see "Automation unlocks" below). Meanwhile accumulated Dewdrops
  should already cover the cheapest upgrades (`decorativeExpansion1` at 60,
  `podRhythm` level 1 at 80) — this is the first "I can afford something"
  moment, not gated behind anything but currency.
- **~9–20 min** — Player buys 1-2 cheap upgrades, likely `habitatCapacity`
  (relieving the fill-up from the first 5 minutes) and/or `podRhythm` (more
  Sprouts to sort/automate). Dewdrops keep accumulating from all settled
  Sprouts across all three habitats — "all three habitats active" is true
  well before this point, since pods are evenly split across the 3 common
  types from minute one. Somewhere in this window the player should also
  meet their first Star Sprout (see "Star Sprout rarity").
- **~15–25 min** — Enough Dewdrops accumulate to afford `colourGateUnlock`
  (450, the most expensive single purchase in Phase 1). Building it completes
  the "satisfying arc" the brief asks for: all three habitats active, at
  least one upgrade purchased, and the second automation either unlocked or
  within easy reach.

## Star Sprout habitat rule

There are 4 Sprout types (`ember`, `dew`, `sun`, `star`) and only 3 habitats
(`emberNook`, `dewPond`, `sunflowerMeadow`) — flagged by Subagent A as needing
a real decision, since the original stub silently pointed `star` at
`sunflowerMeadow` as a placeholder.

**Decision: Star Sprout has no single correct habitat — it settles happily in
any of the 3.** It's the rare, "no wrong answer" Sprout: narratively, a
wandering star doesn't belong to one corner of the garden, it belongs
wherever the player chooses to place it. Mechanically this also keeps rarity
purely about *frequency*, not about adding a fourth sorting rule the player
has to learn for a Sprout they'll rarely see.

Implementation (`src/data/sproutTypes.ts`): `SproutTypeDefinition.habitatId`
is now typed `HabitatId | null`, and `null` means "matches any habitat" —
`SPROUT_TYPES.star.habitatId === null`. This is a deliberate, loud signal
rather than defaulting to one habitat (which is exactly the bug being fixed:
a naive reader silently treating Star as "only correct in Sunflower Meadow").
A helper, `sproutMatchesHabitat(sproutType, habitatId)`, is the one sanctioned
way to check correctness — it already handles the `null` case, so consumers
(E's drag/drop valid-preview logic, F's placement-feedback copy) never need
to compare `habitatId` directly.

Rewards still apply normally: dropping a Star Sprout anywhere fires
`sprout:placed:correct` and eventually `sprout:settled`, feeding whichever
habitat it landed in at the same `baseDewdropRate` as any other settled
Sprout.

## Progression math

All constants referenced below live in `src/data/` and are exported (not just
asserted here) — `tests/unit/data.*.test.ts` checks the claims that matter
for correctness (monotonic costs, exact-threshold unlocks, offline cap
clamping). Timing/economy projections are checked too, against documented
assumptions, but a projection is only as good as its assumptions — flagged
above.

**Sim tick:** 100ms (`TICK_MS`, `src/sim/loop.ts`) → 10 ticks/sec, 600
ticks/min.

**Habitat rate** (`src/data/habitats.ts`): `baseCapacity = 6`,
`baseDewdropRate = 0.02` Dewdrops per settled Sprout per tick = 0.2/sec =
**12 Dewdrops/min per settled Sprout**. All three habitats share these values
— Phase 1 has no reason to make one biome objectively better, which would
just bias which corner of the garden players rush to first.

> **STALE 2026-07-31**: the code's actual `BASE_DEWDROP_RATE`
> (`src/data/habitats.ts`) is `0.008`, not `0.02` — 0.08/sec = **4.8
> Dewdrops/min per settled Sprout**, 2.5x slower than this section's math.
> Discovered while root-causing a failing e2e test
> (`placement.dev.spec.ts`'s 5s `dewdropTotal > 0` wait — 0.02 gives exactly
> 5.0s to a whole Dewdrop with 1 settled Sprout, matching that test's
> timeout precisely; 0.008 needs ~12.5s). Almost certainly dates to commit
> bf4c1cd ("Dewdrop income rebalanced against upgrade costs... whole upgrade
> tree went from ~9 minutes of income to ~33") outliving this doc. Every
> Dewdrops/min figure and downstream timing projection below this point is
> now suspect and NOT reconciled against the current rate — flagged rather
> than silently rewritten, since several of these values are load-bearing
> against each other (see the coupled-balance-values gotcha in
> `work_progress.yaml`) and a partial fix could be worse than an honestly
> stale one. See `work_progress.yaml`'s `e2e-not-rerun` entry.

**Pod spawn** (`src/data/spawning.ts`): `BASE_POD_SPAWN_INTERVAL_MS = 12000`
(12s), reduced 25% multiplicatively per `podRhythm` level (9000ms → 6750ms →
5062.5ms at levels 1–3).

### Garden Slide unlock timing (target: 4–6 minutes)

`UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements = 20`.

An attentive player's placement cadence is bottlenecked by the pod spawn
interval, not by drag speed (a drag takes a couple of seconds; the next pod
takes 12) — so cadence ≈ spawn interval, adjusted for a documented, not
simulated, ~90% success rate (occasional missed or late drags):

```
timeToUnlock ≈ requiredCorrectPlacements × BASE_POD_SPAWN_INTERVAL_MS / successRate
             = 20 × 12000ms / 0.9
             ≈ 266,667ms ≈ 4.44 minutes
```

That lands inside the 4–6 minute target with some margin. `N = 20` was picked
(over, say, 12) specifically so the player feels the repetition of manual
sorting — and hits at least one full habitat — before the reward arrives; see
`tests/unit/data.spawning.test.ts` for the checkable assertion (projected
seconds ∈ [240, 360]).

### Capacity pressure → habitatCapacity upgrade

3 habitats × capacity 6 = 18 settled slots. At ~20 correct placements spread
close to evenly across 3 common types (Star Sprouts are rare and land
wherever placed), at least one habitat is expected to hit capacity — firing
`habitat:full` — right around the same time Garden Slide unlocks. That's
intentional: it's the natural cue to buy `habitatCapacity` (+3 capacity per
habitat per level) shortly after automation arrives, not before.

### Automation unlocks: Colour Gate's behavioral condition

The brief asks for Colour Gate's unlock to be gated on "having experienced
the limitation of one manual slide" — defined concretely in
`src/data/unlocks.ts` as three measurable conditions, all required together:

1. `requiresGardenSlideBuilt = true` — Garden Slide must exist.
2. `requiredSingleHabitatFeedTicks = 300` (30 real seconds at 100ms/tick) —
   the slide must have been actively, continuously feeding its one target
   habitat for that long. A flash isn't enough; the player has to watch it
   work for a little while.
3. `requiredUnsortedPileSize = 3` — at the same time, at least 3 Sprouts of a
   *different* type must be sitting idle/unsorted near the nursery. Since the
   slide only routes one type to one habitat, the other two types keep
   arriving and piling up while it works — that pile **is** "the limitation
   of one manual slide," made visible and countable rather than left to vibes.

`isColourGateUnlocked()` in `src/data/unlocks.ts` takes these three as a
plain params object (not a `SimState` field) because two of the three don't
exist as `SimState` fields yet and `SimState` is owned by Subagent A, not B.
`unsortedPileSize` is derivable today from the existing `sprouts[]` array
(count of `state === 'idle'` Sprouts whose type isn't the fed type) with no
schema change. `singleHabitatFeedTicks` needs exactly **one** new field —
recording the tick an automation instance was built (e.g.
`AutomationInstance.builtAtTick: number`) so a consumer can compute
`tickCount - builtAtTick` — which would bump `SIM_SHAPE_VERSION`. Flagged for
A/integration, not implemented here.

Given Garden Slide unlocking ~4.4 min in, the 30-second feed window plus a
pile of 3 forming from ongoing pod spawns realistically completes within a
couple more minutes — Colour Gate becomes *purchasable* (its behavioral gate
opens) around minute 6–8, well before the 15–25 minute target; the rest of
that window is about affording its 450-Dewdrop cost, not waiting on the
condition.

### Garden topology: the trunk and the fork

The Colour Gate needs somewhere to *be* a gate. The first layout gave each
habitat its own straight run out of the Nursery, so the three routes shared
exactly one tile — the Nursery itself — and then fanned out immediately. There
was no junction anywhere in the garden, so there was nothing for a routing
helper to govern; and both automation site tiles sat in open grass, off every
path, which GameRules §9.2 explicitly rules out.

The garden now has a short shared **trunk** ending in a real **fork**:

```
              Ember Nook (4,4)                    Dew Pond (12,4)
                    |                                   |
                  (4,5)                               (12,5)
                    |                                   |
   (4,6)--(5,6)--(6,6)--(7,6)--[ COLOUR GATE 8,6 ]--(9,6)--(10,6)--(11,6)--(12,6)
                                        |
                                [ GARDEN SLIDE 8,7 ]
                                        |
                                  Nursery (8,8)
                                        |
                                (8,9) ... (8,12)
                                        |
                              Sunflower Meadow (8,13)
```

Why this shape:

- **Two homes at the same z make a natural two-way decision.** Ember Nook is
  west, Dew Pond is east, and a Sprout leaving the Gate visibly turns left or
  right. That turn *is* the Gate's decision, made legible without a single word
  of UI.
- **The Slide's structure stands beside the Nursery, one tile north on the
  trunk (8,7).** Its ride never actually travels through that tile for ANY
  target — `gardenRouteBetween` BFS-searches the path network between the
  ride's real endpoints (Nursery and the target habitat) and never
  references the Slide's own site tile as a waypoint, for any target it has
  ever had. That coincidentally overlapped the northern trunk when the Slide
  used to target Ember Nook or Dew Pond; as of 2026-07-31 it always targets
  Sunflower Meadow instead (see the beat sheet above), so its cargo now
  visibly travels the SEPARATE southern run while the structure itself keeps
  standing one tile north of the Nursery. Mechanically fine — §9.2 only
  requires the site to sit on the path network, which (8,7) still does, now
  serving the Ember/Dew trunk it stands on rather than the route its own
  cargo rides — but it is an open visual-coherence question, not a design
  claim: see `work_progress.yaml`'s `garden-slide-site-not-on-its-own-route`
  entry.
- **The southern run to Sunflower Meadow** leaves the Nursery directly and
  never passes the Gate. As of 2026-07-31 it is the Garden Slide's route
  (previous paragraph); a player can still drag a Sprout down it by hand
  exactly as before. It was never the Colour Gate's actual fallback — a
  non-matching or off-lane Sprout simply stays idle in the Nursery's own
  waiting area (see `planRide`'s doc comment in `src/sim/systems.ts`); the
  Meadow path was only ever narrated that way, not functionally load-bearing
  for it.
- **Travelling through the Gate is free.** `tileDistance(Nursery, Gate) +
  tileDistance(Gate, home)` equals `tileDistance(Nursery, home)` (2 + 6 = 8) for
  both northern homes, so a Gate delivery takes the same time as the old direct
  ride. If a future layout breaks that, Gate routes silently become a penalty —
  it is asserted in `tests/unit/sim.colourGate.test.ts`.

### The Colour Gate's rule

**"This garden sign guides one kind of Sprout down the right path."** (§9.4)

The whole control is two large picture cards, one per lane, each naming which
kind of Sprout that lane invites — or nobody. Choosing is one tap on a portrait.
There is no boolean logic, no condition syntax and no numeric entry (§9.4,
§6.4), and the words "filter" and "splitter" appear nowhere (§2.1).

A matching Sprout **physically passes through the Gate**, in two legs: up the
trunk from the Nursery to the Gate tile, a beat at the signpost while the Gate
reads it, then down its lane to its home. Both legs travel painted path tiles.
The beat is one sim tick — without it the arrival and the departure land in the
same event batch, the Sprout never visibly stops, and the decision becomes
invisible.

Everything else falls back to the waiting area it is already standing in: the
Gate simply does not call it forward. Three cases, all kind, all legible:

| Case | What happens | Why not otherwise |
|---|---|---|
| A kind on no lane card (Sun, Star) | Waits by the pods for the player; the southern run stays hand-carried | Star is deliberately never offered as a lane choice — automating it away would rob the player of the rare-reveal moment (§6.5, §7.2) |
| A lane card naming a kind that lane's home does not welcome | The Gate declines, and the card says why in garden language | Carrying them there would get them turned away and bounced back — an endless shuttle. §5.3's friendly retry is for a *player's* drop, not a machine's loop |
| A lane whose home is currently full | They wait, exactly as the Garden Slide already waits | Forcing a rejected delivery is neither kind nor useful |

A Sprout that reaches the Gate and can no longer go on — its home filled while it
was travelling, or the player changed the rule mid-ride — stands at the signpost
as an ordinary idle Sprout. Still pickable, still counted as waiting, never lost,
and re-checked every tick so it moves on by itself the moment the way is clear.

A newly built Gate opens with the safe recommended rule (Ember west, Dew east)
per §9.1, so it works immediately rather than arriving blank and reading as
broken.

### Nursery rhythm: why Sprouts stop accumulating

Three habitats cap at 8 each — 24 settled slots — while the pod used to open on
a fixed cadence forever. Once every home filled, every further Sprout became
permanent clutter waiting at the Nursery; a measured save held **768** live
Sprouts. That is neither the kind, legible bottleneck §9.7 asks for nor free of
the "visual chaos or selection frustration" §7.4 forbids.

The pod now reads the room. With `waiting` = Sprouts still looking for a home
(idle at the Nursery, or paused at the Gate's signpost):

| Waiting | Rhythm | Pod interval |
|---|---|---|
| 0–6 | lively | normal |
| 7–11 | easing | stretches smoothly, up to 6× |
| 12+ | resting | the pod dozes; nothing spawns |

The four properties this has to hold simultaneously, each pinned by a test in
`tests/unit/sim.nurseryRhythm.test.ts`:

1. **Bounded.** That's the bug. 120,000 ticks of a completely full, unattended
   garden never exceeds the rest threshold.
2. **Nothing is ever deleted.** §7.4 forbids despawning for player inaction, so
   the cap comes from *not spawning*, never from removing. Sprout population is
   monotonically non-decreasing.
3. **No punishment, no stall.** The spawn accumulator is clamped while resting,
   so a garden that rested for forty pod-intervals owes exactly *one* pod on
   recovery, not forty — tidying up must not immediately produce a bigger mess.
   Recovery is always available: settle Sprouts by hand, or buy Habitat Room.
   Settled Sprouts keep earning Dewdrops throughout, so the means to buy room is
   always accumulating.
4. **The player is told.** `nursery:rhythmChanged` drives a warm note beside the
   Dewdrop counter (`src/ui/components/nurseryNote.ts`) naming how many little
   ones are waiting, promising nobody is going anywhere, and offering the two
   real ways out with a button straight to Upgrades — §9.7's "simple recommended
   solution", in §11's concrete, friendly voice. The count is re-announced as it
   shrinks: announcing on a change of *rhythm* alone froze the quoted figure at
   whatever it was when the pod dozed off, while the real one kept dropping as
   the player settled Sprouts. A stale number is worse than no number.

The note reads, at rest:

> **The nursery is having a rest.**
> 809 little ones are waiting for somewhere to live, so the pod is dozing rather
> than adding to the crowd. Nobody is going anywhere — settle some of them, or
> clear a little more room in the habitats, and it will wake up straight away.
> **[ Find more room ]**

and, while merely easing:

> **The nursery is taking its time.**
> 8 little ones are still looking for a home, so the pod has slowed to a gentle
> rhythm. Settle a few into their habitats and it will pick right back up.

The ramp matters as much as the cap: a pod that goes straight from normal to
stopped reads as a bug, whereas one that visibly slows down first is the
world-state warning §9.7 asks for. The ease threshold (6) also sits comfortably
above the Colour Gate's own unlock condition (a pile of 3 unsorted Sprouts), so
easing can never throttle the automation chain out of reach — the same class of
coupling that already bit once between habitat capacity and the Garden Slide
threshold.

### Income & affordability by minute ~20 (projection)

Using a simple linear-ramp estimate — average settled Sprout count rising
from 0 toward a modest, capacity-constrained steady state — rather than a
full simulation:

```
optimistic:    avg 8 settled Sprouts × 0.02/tick × 12,000 ticks (20 min) ≈ 1,920 Dewdrops
conservative:  same, ramp-halved for the slow first few minutes           ≈    960 Dewdrops
```

Either estimate comfortably clears `colourGateUnlock` (450) plus at least one
cheap upgrade (`decorativeExpansion1` 60, `podRhythm` L1 80, `gardenSlideSpeed`
L1 90), satisfying "at least one upgrade purchased, Colour Gate unlocked or
close to it" inside 15–25 minutes. `tests/unit/data.upgrades.test.ts` checks
the cheaper end of this claim (level-1 costs reachable against a
conservative, low settled-Sprout estimate at the 4.5-minute mark) without
depending on the full 20-minute projection above.

### Six upgrades

| id | effect | maxLevel | cost curve (per level) |
|---|---|---|---|
| `podRhythm` | pod spawn interval −25%/level (mult.) | 3 | 80, 130, 205 |
| `habitatCapacity` | +3 capacity per habitat per level | 3 | 100, 170, 290 |
| `gardenSlideSpeed` | Garden Slide transport time −20%/level (mult.) | 3 | 90, 145, 230 |
| `dewdropMultiplier` | +15% Dewdrop income per level (additive to 1.0 base) | 3 | 120, 215, 390 |
| `decorativeExpansion1` | unlocks first cosmetic scenery set | 1 | 60 |
| `colourGateUnlock` | builds the Colour Gate automation | 1 | 450 |

All multi-level curves are geometric (`cost = base × growth^(level-1)`,
rounded to the nearest 5) so each level costs noticeably more than the last;
checked for strict monotonicity in `tests/unit/data.upgrades.test.ts`.

### Five achievements

| id | triggerEvent | condition |
|---|---|---|
| `firstPlacement` | `sprout:placed:correct` | any (first-ness tracked by the achievement system, not here) |
| `firstAutomation` | `automation:built` | any |
| `firstFullHabitat` | `habitat:full` | any |
| `firstRareSprout` | `sprout:spawned` | `sproutType === 'star'` |
| `firstExpansion` | `upgrade:purchased` | `upgradeId === 'decorativeExpansion1'` |

### Star Sprout rarity

`STAR_SPROUT_SPAWN_CHANCE = 0.06` (6% of spawned pods); the remaining 94%
splits evenly across the 3 common types. Reachability check for a real ~20
minute session, deliberately using a *pessimistic* pod count (60, well under
the ~100 the base 12s interval alone would produce in 20 minutes, allowing
for a player who isn't sorting every single pod immediately):

```
expected Star Sprouts  = 60 × 0.06 = 3.6
P(zero Star Sprouts)   = 0.94^60 ≈ 2.4%
```

So even under a conservative estimate of play, a first-time player has
roughly a 97.6% chance of meeting at least one Star Sprout within 20 minutes,
and can expect several — "uncommon but reasonably reachable in normal play,"
not something that requires the debug spawn. See
`tests/unit/data.spawning.test.ts`.

## Offline progress

Flagged by Subagent A: `advanceClock()` in `src/sim/loop.ts` clamps any
single real-time delta to 1000ms and cannot correctly process a multi-hour
"player was away" gap. `computeOfflineProgress(elapsedRealMs, simStateAtClose,
tickMs?)` in `src/data/offlineProgress.ts` is a **separate closed-form
estimate**, not a call into the tick loop:

```
creditedMs   = clamp(elapsedRealMs, 0, OFFLINE_CAP_MS)         // OFFLINE_CAP_MS = 2 hours
creditedTicks = creditedMs / tickMs                             // tickMs defaults to TICK_MS (100ms)
ratePerTick  = Σ over habitats: settledCount(habitat) × baseDewdropRate(habitat)
raw          = ratePerTick × creditedTicks × OFFLINE_EFFICIENCY × dewdropMultiplier
dewdropsEarned = floor(clamp(raw, 0, OFFLINE_DEWDROP_CEILING))
```

Two caps, for two different reasons:

- **`OFFLINE_CAP_MS = 2 hours`** — the real-world time cap the brief asked
  for: no absence, however long, is credited beyond 2 hours' worth of
  production.
- **`OFFLINE_DEWDROP_CEILING = 200`** — a hard ceiling on the *amount*
  credited, independent of elapsed time. Time-capping alone isn't
  conservative enough: a well-upgraded garden (more habitat capacity, a
  purchased `dewdropMultiplier`) times a full 2 hours would otherwise produce
  thousands of Dewdrops — many times the cost of `colourGateUnlock` (450),
  the most expensive single purchase in the game. 200 is roughly one
  mid-tier upgrade's worth: a welcome-back nudge, never a way to skip the
  upgrade tree or out-earn actually playing. `OFFLINE_EFFICIENCY = 0.5`
  (offline production runs at half the active-play rate — no new pods, no
  route changes) shapes the curve for *short* absences below the ceiling; the
  ceiling is what actually keeps long absences conservative.
  `tests/unit/data.offlineProgress.test.ts` checks both: the time clamp
  (10-hour elapsed behaves identically to exactly 2 hours) and the Dewdrop
  ceiling (a fully-settled max-occupancy garden over 10 hours still caps at
  200, and 200 is asserted to be less than `colourGateUnlock`'s cost).

## Accessibility decisions

(Implemented by Subagent F in `src/ui`/`src/input`/`src/audio`; documented
here as the design requirements those systems are built against.)

- **Colour + shape, never colour alone.** Each Sprout type and habitat is
  identifiable by silhouette/icon shape as well as `primaryColor` — a
  colourblind player must be able to sort correctly without perceiving hue
  differences at all. Star Sprout's "matches anywhere" rule also removes one
  possible source of colour-matching anxiety for the rarest type.
- **No fail states, no timers.** Per the plan's global constraints — an
  incorrect placement is a friendly retry, never a loss, penalty, or ticking
  clock. This matters doubly for accessibility: no element of the core loop
  punishes slower reaction time or motor precision.
- **Large drop targets, keyboard-reachable everything.** Habitats, the build
  menu, Garden Journal, upgrades, achievements, settings, and credits must
  all be operable via keyboard nav with visible focus and ARIA labels, not
  drag-only.
- **Reduced motion honored.** Ambient animation, particle effects, and Sprout
  walk/settle tweens must respect a reduced-motion preference (system or
  in-game setting) without losing the information they convey (e.g. a
  reduced-motion "settled" state must still be visually distinguishable from
  "idle").
- **High-contrast mode.** A settings toggle for higher-contrast UI chrome
  and habitat/Sprout outlines, independent of the colour+shape encoding
  above (the two address different needs — one is about hue discrimination,
  the other about low vision/contrast sensitivity).
- **Audio is supportive, not load-bearing.** All feedback (correct/incorrect
  placement, rare reveal, automation events) has a visual counterpart; sound
  is additive flavor with its own mute/volume controls, never the only signal
  for a game-state change.

## Art direction reference

Palette, silhouette rules, animation timing, scale, export format, and
provenance for all Sprouts/habitats/automations/UI icons are specified in
`docs/ART_DIRECTION.md` (Subagent C, written in parallel with this document —
not duplicated here). The one contract this document depends on from that
side: `primaryColor` hex values above are the *data* source of truth for
colour+shape encoding; C's silhouette/shape design is what actually carries
the accessibility requirement, this doc's colours just need to stay
consistent with C's palette choices at integration time.

Asset manifest keys this data layer relies on (per `docs/CONTRACTS.md`'s key
pattern), consumed via `SPROUT_TYPES[id].silhouetteKey`:

```
sprout.ember.icon
sprout.dew.icon
sprout.sun.icon
sprout.star.icon
```

Subagent C's manifest must produce exactly these four keys (in addition to
the idle/walk/happy/reveal variants CONTRACTS.md already documents) for the
data→art integration seam to resolve.

## Out of scope for Phase 1

Explicitly not built, not planned, and not implied by anything above:

- **No accounts, no login, no cloud sync.** Single local IndexedDB save only.
- **No combat, no enemies, no threat of any kind.**
- **No multiplayer, no social features, no leaderboards.**
- **No fail states.** No losing Sprouts, no habitat "death," no game over.
- **No pressure timers, countdowns, or energy systems.**
- **No ads, no payments, no monetization of any kind.**
- **No fixed/scripted narrative content beyond what's specified here** — no
  cutscenes, quests, or dialogue trees; the Garden Journal's 4 filled entries
  (ember/dew/sun/star) and 8 locked silhouettes (per CONTRACTS.md's 12-slot
  journal) are the entirety of Phase 1's "content."
- **No additional Sprout types, habitats, or automations beyond the exact
  ids in `docs/CONTRACTS.md`.** The 8 locked journal slots are visibly
  Phase 2+ content, not implemented, not hinted at mechanically.
- **No per-habitat upgrade instances.** `habitatCapacity` and
  `dewdropMultiplier` apply uniformly across all three habitats; there is no
  "upgrade Ember Nook specifically" path in Phase 1.
- **No difficulty settings, no game speed controls** beyond accessibility
  features (reduced motion, high contrast) listed above.
- **No third-party art or audio** — original SVG (C) and Web Audio synthesis
  (F) only, per the plan's global constraints.
