# Hatchery Picking Proposal — how should the player pick Sprouts out of the Nursery?

**Status:** Design investigation, not yet approved or scheduled.
**SUPERSEDED 2026-08-01 (partial):** this doc's recommendation to keep
Sunflower Meadow permanently hand-carried "as a feature" (see the
"Recommendation" section below) was overridden by the 2026-07-31 Meadow
automation change (`src/sim/systems.ts`'s `unlockSystem`) and the user has
since confirmed keeping that automation (`work_progress.yaml` decisions:
"Keep the 2026-07-31 Sunflower Meadow automation..."). The picking-problem
analysis (Problem A/B split, the individual-waiting-slots requirement) is
still live and unaffected by this — only the Meadow-stays-manual conclusion
is no longer current.
**Scope note:** This document proposes gameplay, not code. It touches no
source file. If the "If/when this is built" sketch below is ever adopted,
it needs `docs/CONTRACTS.md`'s `AutomationId` union extended and
`docs/GAME_DESIGN.md`'s "no additional automations" non-goal (see Option E)
lifted deliberately, per GameRules §17 — not as a quiet code change.

## The question

> Should picking Sprouts from the Nursery be a new type of upgrade — one
> that grabs a specific colour as configured — or something else?

## The actual problem, and the evidence for it

Two different things get called "the picking problem" in casual
conversation about this feature, and they have different answers. I'm
treating them separately because conflating them is exactly how a feature
ends up solving the wrong one.

**Problem A — routing: "which habitat does an automated Sprout go to?"**
This is what Garden Slide and Colour Gate already do. Evidence that it's
solved: `src/data/unlocks.ts`'s `isColourGateUnlocked` fires precisely when
the player has felt one slide's limit (a 30-second single-habitat feed plus
a pile of ≥3 idle Sprouts of another kind — `requiredSingleHabitatFeedTicks:
300`, `requiredUnsortedPileSize: 3`), and once built, the Gate's two lanes
cover exactly the two kinds Garden Slide's single target can't
(`src/sim/systems.ts`'s `colourGateDestination`/`planRide` — the code the
brief calls `findEligibleSprout`/`destinationFor` appears to have been
renamed to these since that description was written; if a concurrent edit
renames them again, the logic being described is "pick an idle Sprout at a
tile that some destination will currently accept," wherever it lives).

One real gap exists inside Problem A, but it's **intentional, not open**:
`src/sim/layout.ts`'s `COLOUR_GATE_LANE_HABITATS` fixes the Gate's two lanes
to `emberNook` (west) and `dewPond` (east) permanently — the player chooses
which *kind* rides each lane, never where it leads — and the Garden Slide's
one target is fixed forever at the moment it auto-builds (`unlockSystem` in
`src/sim/systems.ts`; `targetHabitatId` is written once, at construction,
and read everywhere else, never rewritten). `unlockSystem` picks the
habitat with the strictly greatest settled count, breaking ties by
`HABITAT_ORDER` order (`if (count > best)`, not `>=`), so `emberNook` wins
any tie and `sunflowerMeadow` is only chosen if it is *strictly* ahead of
both other habitats at the 20th placement. Because pod spawns split evenly
across ember/dew/sun, that's the less likely outcome for a player sorting
without a deliberate strategy. In the common case, Garden Slide ends up
feeding Ember Nook, the Gate's default lanes cover Ember (redundant) and
Dew, and **Sunflower Meadow is left with no automated route at all** — Sun
Sprouts (~31% of spawns, `pickSproutType`'s 94%÷3 split) and Star Sprouts
(6%) sit in the Nursery until hand-carried, for the rest of the game. But
`docs/GAME_DESIGN.md` says this on purpose ("the southern run is
untouched... stays the hand-carried route and the fallback"), so this is a
routing gap the design chose to leave open, not a defect Problem A failed
to close. I'm citing it here as evidence for the mechanism question below —
whether to *reopen* an intentional decision — not as an unsolved bug.

**Problem B — selection: "can the player find and grab the specific Sprout
they want, by hand, out of a mixed waiting crowd?"** This is what the
user's question is actually pointed at ("picking Sprouts from the
hatchery"), and it is not closed: every idle Sprout waiting at the Nursery
is rendered at the exact same world position. `src/render/sprouts.ts`'s
`spawn()` places every new mesh at `tileToWorld(NURSERY_TILE)` with no
horizontal offset — the only per-Sprout variation is a vertical sine bob
keyed by `wanderSeed` (`Math.sin(nowMs / 500 + visual.wanderSeed)`).
Contrast this with *settled* Sprouts, which already get an individual,
stable `settleIndex` and a computed slot offset (`sproutSettleOffset`,
tested in `tests/unit/render.settleSlots.test.ts`) so a full habitat still
reads as distinct individuals. Idle Sprouts get no equivalent. With the
Nursery's own easing thresholds (`src/data/spawning.ts`: normal up to 6
waiting, easing 7–11, resting 12+), a crowd of up to ~11 mixed-type Sprouts
can legitimately stack on one tile before the pod even slows down.

This is more than a visual nit. It's a dual violation:

- **§7.4**: "must never create visual chaos or selection frustration" — a
  stack of overlapping sprites at one point is exactly that.
- **§11**: every idle mesh has `isPickable = true` at the identical tile
  position, so a pointer click or a keyboard-driven selection resolves to
  whatever happens to be topmost in the stack, not to a specific, targetable
  Sprout. That's a failure of "keyboard navigation for... core interactions
  where practical," "large touch targets," and "ARIA labels and accessible
  equivalents for significant canvas actions" — a player using any input
  modality other than a mouse hunting by trial-and-error simply cannot
  choose *which* Sprout to grab.

I flag this explicitly because it may already be moot by the time this is
read: the user's brief says another agent is concurrently editing
`src/render/sprouts.ts`, and per-idle-Sprout waiting slots (an extension of
the existing settle-slot pattern) are the obvious, minimal fix — independent
of whatever this document recommends about automation. I am not counting on
that fix landing; I'm noting it so the automation recommendation below isn't
mistaken for also being the fix for stacked sprites. It isn't: spacing out a
pile makes an existing Sprout choosable, it doesn't change who is *allowed*
to be picked, which is what an automation/upgrade would change.

**So the mechanism question actually being asked is this**: given that
Sunflower Meadow's route was deliberately left manual, should the game add
a new mechanism that reopens that decision (lets the player automate or
prioritize what reaches it), separately from the accessibility fix Problem
B needs regardless?

## Options considered

| Option | What it is | Verdict |
|---|---|---|
| **A. New configurable upgrade — "grabs a chosen kind"** (the user's suggestion) | A third automation, sold as an upgrade, with its own pictorial kind-picker, carrying one nominated Sprout type from the Nursery to a home | **Rejected for now** — see reasoning below |
| **B. Extend Garden Slide with a selectable (not fixed) target** | Same physical Slide, but the player can retarget which habitat it feeds, any time | **Rejected** |
| **C. Separate helper family member** (GameRules §9.5's Priority Petal / Gentle Merge / Caretaker Sign) | A new physical garden object dedicated to selection/priority, distinct from Slide and Gate | **Deferred, not rejected** — right *shape* of answer, wrong *time* |
| **D. Property of the Nursery itself** (e.g., spawn-order bias, a "favorite kind" toggle on the pod) | No new object; the Nursery pod itself is configured to prioritize a kind | **Rejected** |
| **E. Nothing new — Colour Gate already covers it** | Ship no automation change; treat Sunflower Meadow's manual status as intended | **Correct for Phase 1, incomplete as a full answer** |

### A. New configurable upgrade — rejected for now

The end-state device this implies and option C's helper converge on the
same object, so the disagreement here isn't "should this exist" (that's
answered under C/timing) — it's about **where the rule gets set**. Three
problems:

- **Wrong control surface.** GameRules §9.1/§9.2: "Use physical garden
  objects, not abstract menus" / "physical routes... not abstract menus." An
  `UpgradeId` in this game is purchased from the Upgrades panel
  (`src/data/upgrades.ts`), a settings-style list with a description string
  — that's the right place for a one-off purchase, but the wrong place for
  an ongoing, changeable *rule*. Compare `colourGateUnlock`: it is an
  `UpgradeId`, but buying it only unlocks and builds a physical Colour Gate
  object; the rule itself (which kind rides which lane) is set at the
  Gate's own in-world panel (`src/ui/components/colourGate.ts`), never from
  the Upgrades list. A "picking upgrade" that lets the player choose a kind
  *from the upgrades menu* would skip that step and put a live gameplay
  rule behind a static purchase screen — the wrong surface even if the
  underlying idea (nominate a kind, get it prioritized) is sound. If this
  ships, it must be: buy a physical object once (upgrade-shaped is fine for
  that part), then set its rule at the object (Colour-Gate-shaped, not
  upgrade-shaped, for that part).
- **The player hasn't felt the problem yet.** GameRules §2.2's teach-through-play
  sequence requires "let repetition become pleasantly inconvenient" *before*
  offering the fix. Colour Gate's own unlock already consumed the felt
  moment of "one automation isn't enough" (the 30-second-feed-plus-pile-of-3
  condition). A second automation-unlock condition, arriving on the heels of
  the first, doesn't teach anything new — the player just bought two
  vending-machine buttons in a row without the garden ever showing them why
  a *third* one exists. Nothing in the current game state creates a felt
  need for it: there is no scenario where the player has two-or-more
  concurrently-unreachable automatable destinations. There is exactly one
  (Sunflower Meadow), and it has been that way, by design, since before the
  Gate existed.
- **It jumps the complexity curve.** GameRules §9.6 places "priority"
  (which is what "grabs a chosen kind out of a mixed pile ahead of others"
  actually is) at **stage 8**, after multi-attribute routing (4),
  capacity/congestion (5), care stations (6), and habitat synergy (7). The
  game currently sits at **stage 3** (Colour Gate = "two destinations and
  fallback"). Shipping a priority mechanism now isn't wrong forever, it's
  five stages early.

### B. Extend Garden Slide with a selectable target — rejected

This looked like the cheapest fix (no new object, no new upgrade, just
unlock a dropdown), which is exactly why it's worth explaining why it's
wrong rather than just cheap:

- **It doesn't solve Problem B.** Retargeting the Slide changes which one
  habitat gets automated help — it does nothing for "can the player find a
  specific Sprout in a mixed pile." A retargeted Slide still only feeds one
  destination at a time; Sunflower Meadow and whichever of Ember/Dew the
  Slide no longer targets would trade places, not both become reachable.
- **It replaces a physical decision with a menu.** GameRules §9.2: "Use
  physical garden objects, not abstract menus." The Slide's target is
  currently a *fact* about the garden, established by where the player was
  already dropping Sprouts by hand at the moment of the 20th placement — it
  reads as a natural outgrowth of play. A "change target" control turns that
  into an abstract setting with no in-world analog (there's no second slide
  to point somewhere else; it'd be the same ramp silently rerouting).
  Compare to how the Gate does this correctly: choosing a lane's kind is a
  tap on a portrait *at the fork*, not a settings-panel dropdown.
- **It has the same ceiling as doing nothing.** One Slide, retargetable or
  not, still only reaches one habitat at a time. It doesn't scale to "three
  automatable destinations," it just changes which two you get.

### C. Separate helper family member — deferred, not rejected

This is the shape option A wanted, done as a proper GameRules §9.5 citizen
(a Routing helper — Priority Petal is the listed candidate that fits: a
device whose entire job is "this kind goes first"). The reasoning against
it *right now* is identical to option A's (§2.2, §9.6), because Problem B's
structural half is single-habitat, not the "several concurrently
unreachable destinations" scenario that would justify it. It becomes the
right answer **the moment a fourth habitat or a fourth common Sprout kind
exists** — at that point two Gate lanes structurally cannot cover the
routing space, in exactly the way one Slide target couldn't. See "If/when
this is built" below for the full design, kept ready rather than shipped.

### D. Property of the Nursery itself — rejected

Two ways to read this, both bad:

- If it means the pod's *spawn order or odds* are configurable ("make Sun
  Sprouts hatch less often" or "call a Sun Sprout out of the queue next"),
  that's a numeric-ratio control wearing a garden costume, which GameRules
  §9.6 explicitly forbids at every stage ("No stage requires writing rules,
  code, boolean algebra, or manual ratios"), and it also risks reading as
  opaque-odds manipulation of a collectible-adjacent system (§2.5's
  "artificially opaque odds" guardrail is about Star Sprout rarity
  specifically, but the spirit — don't let players fiddle with hidden
  probabilities — applies here too).
- If it means *how idle Sprouts are arranged while waiting* (i.e., the
  legibility fix from the Problem B evidence above), that's not a "picking
  mechanism" at all — it's the render fix, already in flight, and it doesn't
  touch which Sprout the player is *allowed* to grab, only how easy the pile
  is to look at.

Neither reading produces a new mechanism worth calling "Nursery picking."

### E. Nothing new — correct for Phase 1, incomplete as a full answer

`docs/CONTRACTS.md` fixes `AutomationId = 'gardenSlide' | 'colourGate'`, and
`docs/GAME_DESIGN.md`'s out-of-scope list is explicit: "No additional
Sprout types, habitats, or automations beyond the exact ids in
`docs/CONTRACTS.md`." That's a **scheduling** fact, not a **design**
argument — it says a third automation isn't due now, not that it would be
wrong. The design argument for the same conclusion is options A/C's
reasoning above (§2.2, §9.6). Both point the same way, so: ship nothing new
for Problem B right now, and treat Sunflower Meadow's permanently
hand-carried status as intended texture, not a defect — it keeps at least
one habitat inside the core "Notice → Guide → Settle" loop for the entire
game, which is arguably a feature (per §2.4's "gentle depth," full
automation of everything would hollow out the caretaking fantasy §1 is
built on) rather than a gap.

**One documentation inconsistency spotted in passing, not load-bearing for
this recommendation**: `src/data/upgrades.ts` prices `colourGateUnlock` at a
flat 700, while `docs/GAME_DESIGN.md`'s "Progression math" section (written
earlier) says 450 and reasons about affordability using that number. Whoever
owns `docs/GAME_DESIGN.md` should reconcile this; I haven't used either
number as evidence here.

## Recommendation

**Ship nothing new right now.** Colour Gate is the correct, sufficient
answer to "picking Sprouts by kind" at the game's current stage (§9.6 stage
3). Separately from this decision, treat giving idle Nursery Sprouts
individual waiting slots — the way settled ones already get via
`settleIndex`/`sproutSettleOffset` — as a requirement, not polish: as
argued above it is both a §7.4 legibility fix and a §11 accessibility fix
(without distinct positions, no non-mouse input can target a specific idle
Sprout at all). It's likely already underway in the concurrent
`src/render/sprouts.ts` work; if it isn't, it should be prioritized ahead
of any mechanism decision, because no automation design in this document
matters if the player can't reliably select an individual Sprout by hand in
the first place.

**Hold "Priority Petal" as the answer for later**, specifically for the
moment Phase 2 introduces a fourth habitat, a fourth common Sprout kind, or
otherwise creates a second permanently-unreachable-by-automation
destination alongside Sunflower Meadow's. At that point two Gate lanes are
structurally insufficient in the same way one Slide target was, the player
will have felt it the same way they felt the Gate's own unlock condition,
and a routing-family helper earns its unlock honestly rather than being
handed out early.

## If/when this is built: Priority Petal

Kept here as a ready design so the *next* time this question comes up (with
a real fourth destination in hand) nobody has to re-derive it. **Do not
build this now** — it fails §2.2 and §9.6 today for the reasons above, and
it also needs `docs/CONTRACTS.md`'s `AutomationId` union extended, which
requires the intentional-revision process in GameRules §17 (a recorded
reason — "Phase 2 added a fourth habitat" — plus updated
design/architecture/QA docs and tests), not a quiet code change.

### What it is, in-world

A **Priority Petal** is a small flowering marker the player can plant
*directly on a waiting Sprout*, or on the Nursery itself with one kind
selected. A petalled Sprout (or the Nursery, if the petal is planted there)
gets called forward by any automation whose passing criteria it already
matches — Garden Slide, Colour Gate, or a hypothetical third route — ahead
of un-petalled Sprouts of eligible kinds. It never creates a route that
didn't exist; it only reorders who goes first among the routes already in
place. That framing keeps it a Routing helper, not a fourth Slide/Gate.

### Configuration — pictorial, no numbers, no booleans

- The player opens the Petal from the build menu (same interaction pattern
  as opening the Colour Gate panel, `src/ui/components/colourGate.ts`).
- The panel shows large kind portraits (ember/dew/sun — Star excluded, same
  reasoning as the Gate: automating away the rare-reveal moment is
  off-limits per §6.5/§7.2) and a single "no priority" state.
- Tapping a portrait plants the Petal on that kind, full stop. There is no
  strength slider, no percentage, no "priority level 1/2/3" — a kind either
  currently has a Petal on it or it doesn't, matching the binary,
  picture-driven pattern the Gate already established and users already
  understand from it.
- The world shows the rule directly: petalled Sprouts wear a visible flower
  while idle (readable in the same waiting area the legibility fix above
  already organizes; large and high-contrast enough to clear §4.1's "avoid
  tiny unreadable icons," not a decorative sliver), so "who currently has
  priority" is answered by looking at the Nursery, not by opening a panel.
- **Accessible equivalent (§11):** the world-space flower cannot be the only
  signal, per "colour-plus-shape-plus-icon differentiation" and the
  audio/visual redundancy rule elsewhere in GameRules. The panel's own
  `aria-pressed` state on the chosen kind's portrait (mirroring
  `colourGate.ts`'s existing pattern) is the canonical source of truth for a
  keyboard or screen-reader user — the current rule must be readable from
  the panel alone, exactly as the Colour Gate's lane summary text
  (`"Sending {kind}s this way."`) already stands in for its lane lamps.

### Feature checklist (§15) applied to Priority Petal, today

| # | Question | If built now |
|---|---|---|
| 1 | Strengthens caretaker fantasy? | Yes, in isolation |
| 2 | Non-technical player understands its purpose visually? | Yes — same portrait pattern as the Gate |
| 3 | Adds visible delight/choice/capability? | Marginal — one habitat already reachable by hand |
| 4 | **Introduced after the player understands the problem it solves?** | **No** — no in-game state currently shows the player "one automated route isn't enough," the way the Gate's own pile-of-3 condition does |
| 5 | Preserves calm, recoverable, no-failure play? | Yes |
| 6 | Works with colour-blind/reduced-motion/keyboard/muted/touch play? | Only if the §11 accessible-equivalent note above is honored |
| 7 | Avoids coercive retention / pay-to-win? | Yes |
| 8 | Creates in-world result vs. opaque menu complexity? | Yes, if built as a physical object (see option A's control-surface note) |
| 9 | Preserves visual clarity and performance? | Yes |
| 10 | Documented, testable, correctly licensed? | Yes, per the sketch below |

§15's own rule: "If any answer is no, revise or defer the feature." Row 4 is
a clean no today, which is the checklist independently reaching this
document's recommendation — defer, don't build.

### Where it sits in the unlock order, and what earns it

Placed **after Colour Gate**, gated the same way Colour Gate was gated
after Garden Slide — behaviorally, not by a placement count:

1. Colour Gate must already be built (mirrors `requiresGardenSlideBuilt`).
2. A **second** kind of Sprout must be piling up unreachable by any built
   automation, for a sustained window — the same shape as
   `requiredUnsortedPileSize`/`requiredSingleHabitatFeedTicks`, but counting
   Sprouts that no current Slide target *and* no current Gate lane can
   reach, not just "a different type than the one Slide feeds." This is the
   condition that only becomes satisfiable once a fourth habitat/kind
   exists; today it's permanently false, which is exactly why the Petal
   can't unlock now even if it existed in code.

This ordering keeps intact the thing the current progression already gets
right: an automation's unlock condition is a description of a problem the
player has already lived through, not a countdown.

### Implementation sketch

- **`docs/CONTRACTS.md`**: extend `AutomationId` (or add a parallel
  `HelperId` union if Priority Petal shouldn't ride the automation-instance
  machinery at all — worth deciding at design time, since a Petal doesn't
  itself transport anything, it only reorders who an existing automation
  picks). Record the revision reason per §17.
- **`src/data/`**: a new `priorityPetal.ts` (or fold into `unlocks.ts` /
  `upgrades.ts` depending on the `HelperId` decision) holding the unlock
  threshold shape, mirroring `UnlockThreshold`'s existing optional-field
  pattern in `src/data/unlocks.ts`.
- **`src/sim/state.ts`**: `SimState` needs one new field, e.g.
  `petalledKind: SproutTypeId | null` (single global petal, matching "one
  Colour Gate rule" simplicity) or `petals: Partial<Record<SproutTypeId,
  boolean>>` if multiple simultaneous petals are wanted later. Bump
  `SIM_SHAPE_VERSION` (currently 3 → 4) and add a v3→v4 save migration
  defaulting `petalledKind` to `null`, following the exact pattern
  `docs/CONTRACTS.md`'s "Save format" section already documents for the
  v2→v3 `colourGateLanes`/`nurseryRhythm` backfill.
- **`src/sim/systems.ts`**: `findIdleAt`'s search order (currently
  first-match in array/spawn order) needs a priority pass — when a petal is
  set, `planRide`'s candidate search should look for a matching *petalled*
  Sprout before falling through to the existing first-idle-match logic. This
  is a small, local change to the existing selection function, not a new
  transport system.
- **`src/events/types.ts`**: one new `GameEvent` member,
  `{ type: 'automation:priorityChanged'; sproutType: SproutTypeId | null }`,
  mirroring `automation:colourGateRuleChanged`'s shape and its
  "announced on every player change and once on build" emission rule so a
  late-subscribing UI still learns the current rule.
  `SaveLoadedSnapshot` needs a matching `petalledKind` field for the same
  reason `colourGateLanes`/`nurseryRhythm` are snapshotted rather than
  replayed (replaying would fire the visual "flower appears" effect on
  every load).
- **`src/ui/components/`**: a new `priorityPetal.ts` panel, structurally a
  near-copy of `colourGate.ts` (portrait grid, `aria-pressed`, one hook
  function) — reuse `sproutVisuals.ts`'s helpers rather than duplicating
  colour/icon logic.
- **`src/render/`**: the visible flower marker on a petalled Sprout's idle
  sprite — an additive decal, not a new mesh type, following the pattern
  the Star Sprout's aura already uses for "this individual Sprout carries
  extra state."

### How it would be tested

Following the existing test-file naming convention
(`tests/unit/{layer}.{feature}.test.ts`):

- `tests/unit/data.priorityPetal.test.ts` (or folded into
  `data.unlocks.test.ts`): unlock threshold logic, mirroring
  `data.unlocks.test.ts`'s exact-threshold assertions for Colour Gate.
- `tests/unit/sim.priorityPetal.test.ts`: `planRide`/`findIdleAt` actually
  prefer a petalled Sprout over an earlier-spawned non-petalled one of an
  eligible kind, across both Garden Slide and Colour Gate dispatch; a petal
  on a kind with no eligible route does nothing (never silently transports
  where none existed); clearing the petal reverts to plain first-idle-match
  order; determinism preserved (`sim.determinism.test.ts`'s pattern —
  same seed, same petal sequence, same outcome).
- `tests/unit/persistence.save.test.ts`: v3→v4 migration defaults
  `petalledKind` to `null` and old saves still load.
- `tests/e2e/`: one new Playwright spec (or an addition to the existing
  Colour Gate flow spec) covering: plant a petal, observe the visible flower,
  observe the petalled Sprout get carried before an eligible non-petalled
  one, reload and confirm the rule persisted.

### Ways it could go wrong

- **It reads as a priority queue with a flower sticker on it** — exactly
  the "operator of a cold production system" GameRules §14 warns against —
  if the UI ever shows more than "on/off per kind." Any temptation to add
  "priority level" or "petals remaining" numeric state should be treated as
  a sign the feature has drifted into the boolean-logic/ratio territory
  §9.6 forbids, not as a natural extension.
- **It quietly reduces manual play to zero.** If a future fourth habitat
  gets both a Gate-equivalent lane AND petal priority, there may be no
  Sprout kind left that requires hand-carrying at all, which would remove
  the core "Notice → Guide → Settle" loop entirely rather than freeing the
  player from repetition (§9.1: "automate repetition, not discovery" — full
  automation risks automating the *discovery* moment too, i.e. every future
  rare/new kind arrives pre-sorted and unremarkable). Star Sprout must stay
  excluded from petal targeting for the same reason it's excluded from
  Gate lanes.
- **It's built before the fourth destination actually exists**, in which
  case its unlock condition is permanently unsatisfiable and it ships as
  dead, confusing code — the single biggest risk, and the reason this
  document recommends deferring rather than building speculatively now.
- **The priority pass changes existing Garden Slide/Colour Gate throughput
  characteristics** in a way `tests/unit/sim.systems.test.ts`'s existing
  assertions don't expect — the search-order change in `planRide`/
  `findIdleAt` touches code every current automation depends on, so it
  needs regression coverage on the *existing* Slide/Gate tests, not just new
  Petal-specific ones.
- **Save migration drift**: if `SIM_SHAPE_VERSION` gets bumped for this
  without also updating the exact place `docs/CONTRACTS.md` documents the
  v2→v3 migration, a future reader loses the one place that history is
  recorded — the migration note should be appended alongside the existing
  one, not replace it.

## Summary

Problem A (routing) is solved, with one gap — Sunflower Meadow's route —
that the design left open on purpose, not by accident. Problem B
(selection: finding a specific Sprout in a mixed pile) has a real,
demonstrable gap, but it's a rendering/accessibility fix (individual
waiting slots), not a mechanism decision. Reopening the intentional
Sunflower gap with a new automation is a legitimate future move — the
user's instinct that "an upgrade that grabs a chosen colour" is *a* real
answer is correct — but nothing in current play makes the player feel a
*second* unreachable destination the way they felt the first (which is what
justified Colour Gate), so it should stay Priority Petal-in-waiting, one
stage later than where the game sits today, rather than ship now.
