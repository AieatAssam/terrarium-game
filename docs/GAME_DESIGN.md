# Tiny Terrarium Works — Game Design

Owned by Subagent B (docs/GAME_DESIGN.md, src/data/). Authority for shared
interfaces is docs/CONTRACTS.md; this document explains and justifies the
*values* B chose inside those interfaces, and the player-facing design they
serve. Art direction (palette, silhouette rules, animation timing) lives in
`docs/ART_DIRECTION.md`, owned by Subagent C — referenced here, not
duplicated.

> **GARDEN TRANSIT SHIPPED AND VERIFIED, 2026-08-03.** GameRules' 2026-08-02
> revision replaces the single Garden Slide with **Garden Transit**: up to four
> paid, configured Slides with per-Slide Sprout-kind filters, plus open-ended
> buildable Sprout Conveyor segments (GameRules §9.3, §9.12–§9.17). The old
> single-Slide model is explicitly rejected, not merely superseded — see
> GameRules §9.17. Passages below that describe the old model are labelled as
> shipped history or historical pacing; current behavior is the Garden Transit
> model above.

> **Current live model:** a Slide has an `acceptedKind`, `destination`, and
> `enabled` rule; a Conveyor is an owned tile in the route graph. Ports are
> derived, ride endpoints are persisted for safe reload, and removal,
> disablement, blocked destinations, disconnected routes, and save repair return
> Sprouts without loss. The authored painted route remains the empty-Conveyor
> compatibility seam.

> **Status note (updated 2026-08-02):** Phase 1 of this document is
> **implemented and verified** — all three common Sprouts, the Garden Slide,
> the Colour Gate, the Mood Bell (added 2026-08-01, see below), upgrades,
> achievements, Journal, save/offline progress, and accessibility modes are
> in the running game (see the "Phase 1 scope" note under the non-goals
> below, and work_progress.yaml's completed/in_flight records). Anything here
> describing minute-by-minute pacing or Dewdrop totals is still a *design
> projection* computed from the tuned constants in `src/data/`, not an
> observed result from playing the finished game — treat the numbers as
> "checkable math," not "playtested." Actual observed timings and visual-QA
> results live in `docs/QA_REPORT.md` / `docs/ART_QA_REPORT.md` /
> `docs/visual-qa/improvement-log.md`.

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
  habitat holds settled Sprouts). Habitats are small on purpose (capacity 8
  each) — `firstFullHabitat` typically doesn't fire until just after this
  window (see "Capacity pressure" below, ≈5.1 minutes expected for one
  habitat to fill), not by its middle. This is still the first hint that
  "capacity" is a thing the player might want to grow, just a beat later
  than a capacity-6 garden would have shown it.
- **~4:30–5:00** — After 20 correct manual placements, Garden Slide unlocks
  (`automation:unlocked`). **Superseded 2026-08-01 (manual placement,
  GameRules §9.8):** unlocking no longer auto-builds it — the build menu
  offers it, and the player places it on any valid path tile. Its
  destination is computed from wherever they put it (`nearestReachableHabitat`,
  `src/sim/layout.ts`), not hardcoded to Sunflower Meadow — see
  `docs/ARCHITECTURE.md`'s manual-placement paragraph and `placeAutomation`'s
  doc comment (`src/sim/systems.ts`). `firstAutomation` fires on
  `automation:built` (the actual placement), not on unlock. See "Progression
  math" below for why 20 lands here. **The rest of this section's minute
  markers describe the pre-2026-08-01 auto-build flow and have not been
  re-walked against manual placement — treat the timing as approximately
  right and the "always Meadow" specifics as stale.**

  **Garden Transit implementation, 2026-08-03:** the 20-placement milestone
  survives, but it now
  grants *permission* to build rather than a free Slide. The first Slide
  **costs 150 Dewdrops**, and Slides are owned in multiples at
  `round5(150 × 1.8^(N-1))` capped at 2400. At the ~20-settled-Sprout income
  rate (4.8 Dewdrops/minute per settled Sprout) that first purchase is roughly
  90 seconds after the milestone, so this beat moves to ~6:00–6:30 rather than
  disappearing. The shipped acceptance matrix covers the purchase, configure,
  route, recovery, and save-repair behavior.

### Arc to 15–25 minutes

- **~5–9 min** — Garden Slide now carries Sprouts automatically to the habitat
  the player placed it to serve. The other two types keep spawning and need
  manual sorting, so a small "unsorted pile" starts building near the nursery
  — the first felt sense that one slide isn't enough.

  **2026-08-03 (Garden Transit shipped):** "one slide isn't enough" now has
  two answers rather than one, and the game supports both:
  the player to meet both. A **second Slide** (270 Dewdrops, filtered to a
  different Sprout kind) is the direct answer; the **Colour Gate** remains the
  answer when one *route* must serve two kinds. Both are legitimate, and the
  Gate is no longer the only escape from a single-Slide bottleneck. This is
  the central progression change of the revision: automation scales by
  *owning more artifacts*, not only by adding cleverness to the one you have. This is a firmer setup for the Colour Gate
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
  (700, the most expensive single purchase in Phase 1 — see "Income &
  affordability" below; a capacity-aware projection puts this closer to
  minute 9 in practice). Building it completes
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

**Habitat rate** (`src/data/habitats.ts`): `baseCapacity = 8`,
`baseDewdropRate = 0.008` Dewdrops per settled Sprout per tick = 0.08/sec =
**4.8 Dewdrops/min per settled Sprout**. All three habitats share these
values — Phase 1 has no reason to make one biome objectively better, which
would just bias which corner of the garden players rush to first.

> **RECONCILED 2026-08-01** (was flagged STALE 2026-07-31): this section
> previously carried `baseCapacity = 6` and `baseDewdropRate = 0.02`, both
> outdated by commit bf4c1cd's rebalance ("whole upgrade tree went from ~9
> minutes of income to ~33") and a later capacity change. Every number below
> this point has now been recomputed against the live constants in
> `src/data/` rather than patched piecemeal — see "Income & affordability"
> below for where the corrected math actually changes a conclusion (it
> doesn't break pacing, but the margin is different from what the old text
> claimed). `tests/unit/data.*.test.ts` derive their assertions from these
> same live constants, so the mechanics were never actually wrong — only
> this narrative was. See `work_progress.yaml`'s `e2e-not-rerun` entry for
> the original discovery.

**Pod spawn** (`src/data/spawning.ts`): `BASE_POD_SPAWN_INTERVAL_MS = 12000`
(12s), reduced 25% multiplicatively per `podRhythm` level (9000ms → 6750ms →
5062.5ms at levels 1–3).

### Garden Slide unlock timing (target: 4–6 minutes)

*(2026-08-02: the 20-placement threshold is retained by the Garden Transit revision as the PERMISSION gate — GameRules §9.12 keeps it explicitly because `tests/unit/data.spawning.test.ts` pins session pacing to it. What changes is that permission is now followed by a 150-Dewdrop purchase rather than a free build. Do not move this threshold while implementing Phase 7.)*

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

3 habitats × capacity 8 = 24 settled slots. Each common type spawns at
≈31.3% per pod ((1 − 0.06) / 3), so filling one habitat to 8 takes an
expected ≈25.5 spawns of matching pods — at the base 12s interval, ≈5.1
minutes — a little *after* the ≈4.4 minute Garden Slide unlock, not
concurrent with it (with capacity 6 this used to land right at unlock; at
capacity 8 the margin is real, but the two events still land close enough
together in normal play — variance across the 3 habitats means the first
`habitat:full` typically fires within a minute either side of Slide
unlock). That's still the natural cue to buy `habitatCapacity` (+3 capacity
per habitat per level) shortly after automation arrives.

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
that window is about affording its 700-Dewdrop cost, not waiting on the
condition (see "Income & affordability" below — affording it lands around
minute 9, so the behavioral condition is the binding constraint, not the
price).

**Mood Bell's unlock (2026-08-01) is simpler still**: both Garden Slide and
Colour Gate must already exist (`requiresGardenSlideBuilt` and
`requiresColourGateBuilt`, `src/data/unlocks.ts`) — no tick/pile condition,
since "you've mastered single-route and dual-route routing" is itself the
felt milestone this time. Its 1500-Dewdrop cost is the binding constraint by
construction (the behavioral gate is satisfied the instant the Gate is), and
is a first-pass estimate not yet checked against real play at this stage of
progression the way the earlier values were.

### Garden topology: authored backdrop and transit network

The Colour Gate needs somewhere to *be* a gate. The authored garden therefore
keeps a shared trunk and a real fork, while Garden Transit adds a player-owned
route layer on top: Conveyor tiles extend the same route substrate without a
fixed node limit. With no owned Conveyors, the painted path below remains the
compatibility route for a fresh or migrated garden. Slide sites are player
chosen and their ports are validated; no Slide has a fixed automatic site.

The authored backdrop has a short shared **trunk** ending in a real **fork**:

```
              Ember Nook (4,4)                    Dew Pond (12,4)
                    |                                   |
                  (4,5)                               (12,5)
                    |                                   |
   (4,6)--(5,6)--(6,6)--(7,6)--[ COLOUR GATE 8,6 ]--(9,6)--(10,6)--(11,6)--(12,6)
                                        |
                                [ GARDEN SLIDE 8,7 ]
                                        |
                                  Nursery (8,8)--[ MOOD BELL 9,8 ]
                                        |
                                (8,9) ... (8,12)
                                        |
                             Sunflower Meadow (8,13)
```

The diagram is the visual/layout contract for the backdrop and the empty-
Conveyor fallback, not a list of owned transit artifacts.

Why this shape:

- **Two homes at the same z make a natural two-way decision.** Ember Nook is
  west, Dew Pond is east, and a Sprout leaving the Gate visibly turns left or
  right. That turn *is* the Gate's decision, made legible without a single word
  of UI.
- **RESOLVED 2026-08-01 (manual placement, GameRules §9.8).** The Slide's
  structure used to stand at a single fixed default tile (8,7), north of the
  Nursery on the trunk, while its ride went wherever the current hardcoded
  target happened to be — the paragraphs below described exactly the
  resulting mismatch, which a player reported as "looks horrible and ugly."
  The site tile is now player-chosen (`placeAutomation`,
  `src/sim/systems.ts`), and the destination is computed FROM that site tile
  via `nearestReachableHabitat` (`src/sim/layout.ts`) — the nearest habitat
  reachable over the real path network from wherever the structure actually
  stands. Placing the Slide at (8,7) today, for instance, resolves to
  Sunflower Meadow anyway (backtracking through the Nursery and south is
  still the shortest route from that specific tile — see
  `tests/unit/sim.layout.test.ts`), but a player who places it further along
  the trunk gets whichever habitat is genuinely closest from there, and the
  visible route always matches. `work_progress.yaml`'s
  `garden-slide-site-not-on-its-own-route` open question is closed by this.
  The history below is kept for context, not as current behavior.
- **(historical) The Slide's structure stood beside the Nursery, one tile
  north on the trunk (8,7).** Its ride never actually travelled through that
  tile for ANY target — `gardenRouteBetween` BFS-searches the path network
  between the ride's real endpoints (Nursery and the target habitat) and
  never references the Slide's own site tile as a waypoint. That
  coincidentally overlapped the northern trunk when the Slide used to target
  Ember Nook or Dew Pond; from 2026-07-31 it always targeted Sunflower
  Meadow instead, so its cargo visibly travelled the SEPARATE southern run
  while the structure itself kept standing one tile north of the Nursery.
- **The southern run to Sunflower Meadow** leaves the Nursery directly and
  never passes the Gate. It is reachable both by a placed Garden Slide (if
  its site tile resolves there) and by hand-drag, exactly as before. It was
  never the Colour Gate's actual fallback — a non-matching or off-lane
  Sprout simply stays idle in the Nursery's own waiting area (see
  `planRide`'s doc comment in `src/sim/systems.ts`); the Meadow path was
  only ever narrated that way, not functionally load-bearing for it.
- **The Mood Bell's structure stands on a short spur east of the Nursery
  (9,8), added 2026-08-01.** Same precedent as the Slide's own site tile: no
  ride ever travels through it. A Bell delivery rides Nursery -> whichever
  habitat the boarded Sprout's own type wants, reusing the exact same path
  network the Slide and Gate already use for all 3 habitats — the spur
  exists purely so the structure has somewhere to stand on the path network
  (§9.2), not because any ride needs it.
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
| A kind on no lane card (Sun, Star) | The Colour Gate itself never touches either — Sun is not the Gate's to route, only the Slide's; Star is deliberately never offered as a lane choice — automating it away would rob the player of the rare-reveal moment (§6.5, §7.2). Once the Garden Slide is built (which happens before the Gate ever can be), a Sun Sprout is carried automatically down the southern run; a Star Sprout always waits for the player | Splitting "the Gate declines to route it" from "so it waits forever" stopped being true for Sun as of the 2026-07-31 Sunflower Meadow automation — see `unlockSystem`'s doc comment in `src/sim/systems.ts` |
| A lane card naming a kind that lane's home does not welcome | The Gate declines, and the card says why in garden language | Carrying them there would get them turned away and bounced back — an endless shuttle. §5.3's friendly retry is for a *player's* drop, not a machine's loop |
| A lane whose home is currently full | They wait, exactly as the Garden Slide already waits | Forcing a rejected delivery is neither kind nor useful |

A Sprout that reaches the Gate and can no longer go on — its home filled while it
was travelling, or the player changed the rule mid-ride — stands at the signpost
as an ordinary idle Sprout. Still pickable, still counted as waiting, never lost,
and re-checked every tick so it moves on by itself the moment the way is clear.

A newly built Gate opens with the safe recommended rule (Ember west, Dew east)
per §9.1, so it works immediately rather than arriving blank and reading as
broken.

### The Mood Bell's rule (2026-08-01, Phase 2's first feature)

**"A helper that reads whether a Sprout is Sunny or Sleepy and carries a whole
mood's worth of them straight home — of any colour."** (§9.5 names "Mood Bell"
explicitly among Routing helpers; §7.3 names "mood" as a future Sprout trait;
§9.6 stage 4 is "multi-attribute routes" — Phase 1 only reached stage 3.)

Every Sprout now carries a second, independent attribute, mood (`sunny` |
`sleepy`), assigned at spawn via its own RNG draw — completely orthogonal to
colour/type. Mood never changes which habitat is correct for a Sprout; it only
changes who carries it there.

The Bell's control is simpler than the Gate's: one toggle, not a 2-lane map —
Sunny or Sleepy, chosen with one tap. Whichever mood is chosen, ANY idle
Sprout of that mood boards and rides in a single leg straight to **its own**
correct habitat, computed from its type (unlike the Garden Slide's one fixed
destination). Delivery is always correct by construction, so unlike a Gate
lane the player could point at the wrong home, there is no per-choice
mismatch note to show.

**Building the Bell changes what the Slide and Gate do.** This is the part
worth being explicit about, because it is a real behavior change to two
automations the player already understands, not a hidden priority quirk:
once the Bell exists, a Sprout matching its current mood is excluded from
the Garden Slide's and Colour Gate's own Nursery-pickup eligibility — it is
the Bell's, full stop, regardless of which automation's `planRide` checks
first on a given tick. Without this exclusion, the Slide/Gate (checked
earlier in the tick's dispatch order) would keep taking any Sprout they are
independently eligible for, and the Bell — built later, with nothing
reserved for it — would visibly do nothing for its cost. `isMoodBellClaimed`
in `src/sim/systems.ts` is this partition; see its own doc comment for the
mechanics. A Sprout already mid-journey at the Gate's signpost when the
partition applies to its mood keeps going — only a *fresh* Nursery pickup is
ever redirected.

Unlock is behavioral, simpler than the Gate's: both the Garden Slide and
Colour Gate must already be built (no tick/pile condition needed — "you've
mastered single-route and dual-route routing" is itself the milestone).
Cost: `moodBellUnlock`, flat 1500 Dewdrops — roughly 2x the Gate's 700,
continuing the escalating per-automation cost pattern; a first-pass estimate
like every other balance value in this doc, not yet playtested at real
scale. The Bell excludes Star Sprouts from delivery, same reason the Gate
does (no single correct habitat — automating it away would rob the rare-
reveal moment, §6.5/§7.2). A newly built Bell opens with the safe default
rule (`sunny`), same §9.1 reasoning as the Gate's own default lanes.

Visually, mood is a small additive badge — a billboard quad with a
procedurally drawn alpha-cut glyph (sunny is a four-point sparkle, sleepy a
crescent, each with a soft tinted halo — shape carries the distinction, not
colour alone, §7.1) parented to each Sprout's sprite, deliberately NOT folded
into the existing (sproutType × visual-state) shared-material cache
(`src/render/sprouts.ts`) — a second multiplicative dimension there would
multiply the texture/material count for no reason, since a badge's appearance
depends on mood alone. The 2026-08-01 square-block fix replaced the original
sphere/box primitives with these glyphs and deleted the drag-tint materials;
see `docs/visual-qa/improvement-log.md` and `src/render/pbrMaterials.ts`
(`createMoodBadgeMaterial`).

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

The old flat "average settled Sprouts" heuristic understated income once the
garden is actually capacity-aware: an attentive player fills all 24 base
slots (3 habitats × 8) well before minute 20, and income then plateaus at
the maximum rate rather than continuing to ramp. A ramp-then-plateau
estimate:

```
ramp (0–6 min):     settled count rises ~0 → 24 (Slide feeding Meadow +
                     manual Ember/Dew sorting, per "Capacity pressure" above)
                     avg ≈ 12 settled × 0.008/tick × 3,600 ticks (6 min)
                     ≈ 346 Dewdrops
plateau (6–20 min):  24 settled × 0.008/tick × 8,400 ticks (14 min)
                     ≈ 1,613 Dewdrops
total by ~20 min    ≈ 1,959 Dewdrops
```

That comfortably clears `colourGateUnlock` (700) — in fact the running total
crosses 700 around minute **9**: ~346 from the ramp plus (700 − 346) / (24 ×
0.008 × 10 ticks/sec × 60) ≈ 3.1 more minutes of plateau income. Since the
behavioral gate itself opens around minute 6–8 ("Automation unlocks" above),
affording it is the binding constraint by a couple of minutes, not the
condition — the Gate becomes purchasable sooner than the original 15–25
minute target assumed, not later. `tests/unit/data.upgrades.test.ts` checks
the cheap end of this claim (level-1 costs reachable against a conservative,
low settled-Sprout estimate at the 4.5-minute mark) directly against the live
`baseDewdropRate` constant, independent of this doc's projection.

### Seven upgrades

| id | effect | maxLevel | cost curve (per level) |
|---|---|---|---|
| `podRhythm` | pod spawn interval −25%/level (mult.) | 3 | 80, 160, 320 |
| `habitatCapacity` | +3 capacity per habitat per level | 3 | 100, 200, 400 |
| `gardenSlideSpeed` | Garden Slide transport time −20%/level (mult.) | 3 | 90, 180, 360 |
| `dewdropMultiplier` | +15% Dewdrop income per level (additive to 1.0 base) | 3 | 130, 275, 575 |
| `decorativeExpansion1` | unlocks first cosmetic scenery set | 1 | 120 |
| `colourGateUnlock` | builds the Colour Gate automation | 1 | 700 |
| `moodBellUnlock` | builds the Mood Bell automation (2026-08-01) | 1 | 1500 |

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
  thousands of Dewdrops — many times the cost of `colourGateUnlock` (700),
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
- ~~No additional Sprout types, habitats, or automations beyond the exact
  ids in `docs/CONTRACTS.md`.~~ **LIFTED 2026-08-01 (user decision, deliberate,
  recorded — see work_progress.yaml's decisions).** Phase 1 (this document's
  own scope) is complete per GameRules §16's Definition of Done — all three
  common Sprouts, both Phase 1 automations, upgrades, achievements, Journal,
  save/offline progress, and accessibility modes are implemented and
  verified. GameRules itself never forbade a Phase 2: §9.5 names concrete
  future automation families (Routing/Care/Growth/Organisation helpers),
  §9.6's complexity curve has 12 stages and Phase 1 only reaches stage 3, §7.3
  anticipates later Sprout traits, and §16's own required closing feeling
  ends "...but I cannot wait to see what I can unlock and improve next" —
  this was always a Phase-1-scoped implementation-tracking non-goal in THIS
  document, not a GameRules constraint, so lifting it is not a GameRules §17
  revision (nothing in `docs/_scratch/GameRules.md` itself needs to change).
  What DOES need
  updating deliberately, not as a quiet code change, once a specific Phase 2
  feature is chosen: `docs/CONTRACTS.md`'s `AutomationId`/`SproutTypeId`
  unions, this document's own scope sections, and whatever tests currently
  assert "no additional automations" as a boundary. As of this lift the
  unions were exactly `'gardenSlide' | 'colourGate'` and
  `'ember' | 'dew' | 'sun' | 'star'` — the first concrete Phase 2 addition
  (the Mood Bell) has since extended `AutomationId` with `'moodBell'`; the
  live unions are defined in `src/core/ids.ts` and `docs/CONTRACTS.md`, not
  restated here. The 8 locked Journal slots were always visibly Phase 2+
  content, present but not yet implemented or mechanically hinted at.

  **The Mood Bell (2026-08-01) is the first concrete feature realizing this
  lift** — see "The Mood Bell's rule" above. `docs/CONTRACTS.md`'s
  `AutomationId` now includes `'moodBell'` and a `MoodId` union exists
  alongside `SproutTypeId` (mood is a second, orthogonal attribute, never a
  fourth Sprout type).
- **No per-habitat upgrade instances.** `habitatCapacity` and
  `dewdropMultiplier` apply uniformly across all three habitats; there is no
  "upgrade Ember Nook specifically" path in Phase 1.
- **No difficulty settings, no game speed controls** beyond accessibility
  features (reduced motion, high contrast) listed above.
- **No third-party art or audio** — original SVG (C) and Web Audio synthesis
  (F) only, per the plan's global constraints.
