# Tiny Terrarium Works — Game Rules and Design Ground Truth

**Status:** Canonical design specification  
**Purpose:** This document is the authoritative reference for product, game-design, art, UX, content, and engineering decisions. Every new feature must preserve the player fantasy, core loop, accessibility rules, and scope boundaries set here. If an implementation conflicts with this document, change the implementation—not the design—unless the design change is explicitly approved and this file is revised intentionally.

## Revision Log

- **2026-08-02 — Garden Transit supersedes the single Garden Slide (user decision).** The player judged the shipped Slide inadequate as an automation reward: only one may exist, it does not attach cleanly to the Nursery, it cannot be configured to collect a particular Sprout kind, it has no scalable routing role, it clips, and it reads as a snake or tube on a box rather than as a slide. Rather than patch that object, the automation layer is replaced by **Garden Transit** — two purchaseable, placeable, configurable artifact families (**Garden Slides** and **Sprout Conveyors**) that the player owns in multiples and composes into routes. See the rewritten §9.3 and the new §9.12–§9.17.
  - **What changed:** §9.3 (Garden Slide → Garden Transit, multiple ownership, colour/type filters, ports); §9.9 (route segments **renamed and specified** as Sprout Conveyors — see the naming note below); §8.2/§8.3 (Dewdrop sinks and upgrade categories); §9.4 (Colour Gate restated as a decision point *within* Transit); §9.6 (complexity curve); §14/§15 (guardrail amendments for a conveyor-shaped mechanic); §16 (Definition of Done); and new §9.12 costs/refunds, §9.13 ports and placement, §9.14 configuration, §9.15 route states and recovery, §9.16 art and readability acceptance, §9.17 the explicitly rejected prior design.
  - **NAMING RESOLUTION (important — do not reintroduce two models):** §9.9's "Garden Route buildable segment" and the new "Sprout Conveyor" are **the same mechanic**. §9.9 introduced it as a concept on 2026-08-01; this revision names, prices, ports, and specifies it. There is exactly one buildable route substrate in this game and it is the Sprout Conveyor. `plan.yaml`'s Phase 3 tasks (3.1–3.4) are superseded accordingly.
  - **What was deliberately preserved:** the caretaker fiction and §2.1's presentation vocabulary (a Slide is a "Garden Slide", never a "conveyor belt", in every player-facing string — note that "Sprout Conveyor" is itself a garden-craft name for a grown/carved trough, not an industrial belt, and §14's amendment below is the test for that); the no-permanent-failure rule (§2.5); manual placement remaining a first-class player choice (§5.2); §9.10 junction backpressure and §9.11 misroute stalls, which operate unchanged on whatever the route substrate is called; and all of §3–§8 and §11–§13.
  - **Dependent updates required by this revision, and DEFERRED:** §17 requires a GameRules revision to carry updates to related design/architecture/QA documents and tests. The task that produced this revision was scoped to `GameRules.md` and `plan.yaml` only and explicitly forbade editing other documents, so those updates are **not done here** and are instead scheduled as plan tasks: `docs/CONTRACTS.md` (Transit ids, ports, events, save shape), `docs/ARCHITECTURE.md` (as-built transit domain), `docs/GAME_DESIGN.md` (progression copy), `tests/unit/sim.layout.test.ts` (its pinned Nursery→Gate→habitat distance identity assumes a fixed topology that player-placed Conveyors make dynamic), and a save migration from the single legacy `AutomationInstance`. This deferral is recorded rather than left silent, per §17 and CLAUDE.md's authority rule.

- **2026-08-01 — Phase 2 pivot toward hand-built garden logistics (user decision).** The player reported the automatic-placement model (helpers appear pre-built and pre-routed) as visually incoherent and asked for a deeper, Factorio/Satisfactory-style building layer: player-placed and player-drawn routes, junctions that accumulate Sprouts until configured, misroutes that stall for manual repair rather than silently resolving, and buildable habitats paid for in Dewdrops. This directly conflicted with §1's "must never require... factory-game familiarity" and §14's production-system guardrail as they were originally written, so the conflict was surfaced rather than resolved silently (per this document's own §17). The user chose to revise the design toward the Factorio direction. This log entry, plus the amended §1, §2.1, §2.5, §9, §10, §14, §15, and §16 notes below, is that intentional revision.
  - **What changed:** automation, routes, and (new) habitats become player-placed and player-connected, constrained by tile/junction rules rather than auto-built; junctions can accumulate Sprouts under backpressure until routed; a misrouted Sprout stalls before the wrong habitat awaiting a manual fix instead of resolving invisibly.
  - **What was deliberately preserved:** the caretaker fiction and presentation vocabulary (§2.1's naming table stands — a belt is still a "Garden Slide" in every player-facing string), the no-permanent-failure-state rule (a stall is always recoverable, never a loss), all of §3–§8 and §11–§13 (Sprouts' dignity, art direction, accessibility, licensing) unchanged, and the general principle that depth stays spatial and visual rather than becoming arithmetic, code, or off-screen optimisation.
  - **Dependent updates required by this revision:** `docs/CONTRACTS.md` (new ids/events for placed structures, routes, junction state), `docs/ARCHITECTURE.md` (placement/routing as-built), `tests/unit/sim.layout.test.ts` (the pinned Nursery→Gate→habitat distance identity assumes fixed topology, which player-drawn routes make dynamic), and a save migration for existing auto-placed `AutomationInstance` records. See `plan.yaml` for the staged implementation this revision unlocks.

## 1. Design North Star

**Tiny Terrarium Works** is a premium-feeling, cosy browser automation and collection game set inside a magical living terrarium.

The player cares for adorable creatures called **Sprouts**. They first sort Sprouts into appropriate homes by hand, then build charming garden helpers that perform repetitive care automatically. Over time, a small, quiet terrarium becomes a beautiful, lively, self-running ecosystem.

The game’s primary emotional promise is:

> “I made this little garden work, and it is becoming more beautiful, capable, and uniquely mine.”

The game must feel approachable in the first five seconds, rewarding in the first minute, and increasingly rich over many sessions. It must never require programming knowledge, arithmetic optimisation, or the ability to read dense system documentation.

**2026-08-01 revision:** Phase 2 deliberately introduces hand-built garden logistics — the player places helpers and draws the routes between them, and a junction can back up until it is configured correctly. This is spatial, visual building, not "factory-game familiarity" in the sense the original sentence meant to exclude (spreadsheets, formulas, or system documentation): a player must never need to compute throughput, read a manual, or write a rule in anything but pictures and drag gestures. If a mechanic can only be solved by doing arithmetic off-screen, it does not belong here regardless of how it is dressed up visually.

## 2. Product Pillars

### 2.1 Care before industry

The player is a caretaker, not a production-line manager. Sprouts are living, expressive creatures, habitats are homes, and automation is gentle garden care.

Internally, systems can behave like factory logistics — as of the 2026-08-01 revision, quite literally: player-placed routes, junctions, backpressure, and manual misroute repair. Externally, the language and visual presentation must remain warm and intuitive. **The 2026-08-01 revision changes the mechanics, not the fiction** — this naming table still governs every player-facing string:

- “Garden Slide,” never “conveyor belt”
- **2026-08-02 tension, recorded rather than glossed:** the new artifact family is named **“Sprout Conveyor”** (§9.3.2) at the user's explicit direction, and the word sits uncomfortably beside the line above. The rule is refined, not abandoned: **“conveyor belt”, “belt”, “splitter”, “throughput” and “factory” remain forbidden in every player-facing string**, and a Sprout Conveyor must be presented as a grown or carved garden channel — a thing that looks planted, never a rubber belt on rollers. If the in-game object ever reads as industrial, the name is not the defence; §14's amendment is the test and the implementation is wrong.
- “Colour Gate,” never “filter splitter”
- “Habitat,” never “consumer building”
- “Dewdrops,” never “currency unit”
- “Garden Journal,” never “collection database”
- “Seed Renewal,” never “prestige reset”
- “Garden Route” (or “Slide segment”), never “belt” or “conveyor” — a route is still a mossy trail, glass root-tube, or water channel per §9.2; it just now has a shape the player draws
- “Junction,” never “splitter node” — a junction is a signpost/crossing in the world, not a diagram symbol
- “Waiting to be sorted” / “needs your help,” never “blocked” or “error” — a backed-up junction or a stalled misroute is narrated the same gentle way §11's recovery copy already handles an incorrect placement

### 2.2 Learn through play

The game teaches through direct action and immediate response, not explanatory walls of text.

New mechanics follow this sequence:

1. Present a safe, simple version of the problem.
2. Let the player solve it manually.
3. Let repetition become pleasantly inconvenient.
4. Offer an automation or upgrade that removes the repetition.
5. Give a small celebration and introduce the next idea.

Never introduce multiple unfamiliar systems at once. Never make players read a tutorial before taking their first action.

### 2.3 Visible transformation

Progress must be visible in the garden itself, not only in a number panel.

Every meaningful unlock should produce at least one of the following:

- A new animated object in the world
- A visibly fuller or more beautiful habitat
- A new route or movement pattern
- A newly discovered Sprout silhouette
- A new area or decorative landmark
- A changed environmental mood, soundscape, or lighting effect

The player should be able to compare a new garden against an early one and immediately see its growth.

### 2.4 Gentle depth

The game must be easy to begin but rewarding to improve. The first hour uses only obvious visual rules such as colour, shape, mood, or habitat preference. Later layers may introduce route priority, multi-trait sorting, layout choice, timing, ecosystem synergy, and optional optimisation.

Depth is opt-in. A player who follows recommendations must make steady progress. A player who enjoys systems can build elegant, compact, fast, or decorative gardens.

### 2.5 Respectful retention

The game should be compelling because it creates curiosity, pride, and a clear next project—not because it pressures, punishes, or exploits.

The game must not contain:

- Forced advertisements
- Pay-to-win mechanics
- Energy systems
- Punishing timers
- Login streak penalties
- Loss of resources while away
- Permanent failure states
- Artificially opaque odds for collectible creatures

Offline progress is a warm bonus, not an obligation. Active play is best for discovery, placement, redesign, and solving new garden problems.

**2026-08-01 revision — stalls are not failure states.** §9.11 introduces a Sprout that stalls on its route just before the wrong habitat when a junction is misconfigured, waiting for the player to fix the routing or move it by hand. This is explicitly NOT a "permanent failure state": nothing is lost, nothing decays, the Sprout waits indefinitely and contentedly, and a single junction fix or hand-carry resolves it immediately with no penalty. The distinction that matters: a failure state punishes the player for a past choice; a stall is a visible, friendly invitation to make a choice, identical in spirit to the bottleneck framing already established in §9.7.

### 2.6 Delightful polish

The target tone is a colourful, high-fidelity, AA-quality browser game: readable, tactile, playful, and cohesive. No core player-facing surface may look like a default framework widget, internal tool, debug interface, or generic admin dashboard.

## 3. Setting and Premise

### 3.1 The world

The game takes place in **The Great Conservatory**, a magical collection of self-contained terrariums tended by generations of unseen gardeners.

Each terrarium is a tiny world made of soil, water, crystal, moss, warm light, and gentle magic. The player begins with a neglected starter terrarium called the **Hearth Garden**. Its old care systems have gone dormant, its habitats are sparse, and its Sprouts need help finding their homes.

The Great Conservatory is not post-apocalyptic, dangerous, or bleak. It is mysterious, peaceful, and hopeful. The player restores it through curiosity and care.

### 3.2 Sprouts

Sprouts are small magical plant-creatures that hatch from Nursery Pods. They are expressive, non-verbal, and unmistakably alive.

Every Sprout has:

- A species identity
- One or more readable visual traits
- A preferred habitat or care route
- Idle, movement, happy, and reveal behaviours
- A collection entry in the Garden Journal
- A rarity level where applicable

Sprouts must never be framed as disposable materials. They are gently guided, settled, nurtured, evolved, admired, or relocated. They are never killed, harvested, consumed, trapped, or punished.

### 3.3 The player’s role

The player is the new **Terrarium Keeper**. They do not have an avatar that needs combat, hunger, or movement mechanics. Their presence is expressed through a soft cursor/hand interaction, construction choices, journal discoveries, and the growing personality of their gardens.

The player’s journey is from attentive caretaker to imaginative ecosystem designer.

### 3.4 Narrative delivery

Narrative is light, optional, and environmental. It should appear as short Journal notes, new-territory discoveries, and small observations from the Conservatory rather than long dialogue sequences.

The game does not need a villain or conflict. Its central story is restoration, discovery, and the growing relationship between the Keeper and the living garden.

## 4. Style and Presentation

### 4.1 Visual style

Use a premium, toy-like 2.5D/isometric magical-garden aesthetic.

Required characteristics:

- Rounded and readable silhouettes
- Saturated focal colours against calmer natural backgrounds
- Soft directional lighting and gentle rim light
- Depth through layered scenery, shadows, elevation, water, and foliage
- Chunky, tactile buildings and paths
- Decorative ambient animation: leaves, drifting pollen, water ripples, fireflies, clouds, grass sway
- Clear feedback particles and small bursts of celebration
- High visual distinction between all Sprout types beyond colour alone

Avoid:

- Pixel-art presentation unless explicitly approved for a separate mode
- Realistic horror, bleakness, grime, or industrial harshness
- Flat corporate illustration
- Tiny unreadable icons
- Imitation of identifiable commercial game characters or art styles
- Generic placeholders in shipped builds

### 4.2 Camera and world readability

The main garden uses an isometric or 2.5D camera. The world should feel dimensional but always readable.

Camera rules:

- Default framing shows the Nursery, current active habitats, and main paths
- Zoom and pan are available but never required for the earliest play
- Important interaction targets remain comfortably large at default zoom
- The camera never creates hidden-object frustration
- Newly unlocked areas can be introduced with a gentle camera focus or reveal
- Reduced-motion mode disables unnecessary camera swoops and large screen movement

### 4.3 UI style

UI is a polished extension of the terrarium: rounded panels, botanical motifs, gentle translucency, large clear icons, concise labels, and satisfying transitions.

The world is the main stage. UI must support the garden rather than obscure it.

### 4.4 Audio style

Audio is warm, gentle, and responsive.

- Music: calm looping garden ambience, unobtrusive over long sessions
- SFX: soft pod pop, happy chirp, water plink, slide whoosh, building placement, reward sparkle, rare reveal flourish
- Ambient: subtle wind, water, distant birds/insects, foliage sounds
- Audio must work as enhancement, never as required information
- All music and sound effects must be original, CC0, or demonstrably CC BY 4.0 compatible with documented attribution

Players must be able to independently control music and effects, mute all audio, and play comfortably without sound.

## 5. Core Gameplay Loop

The primary loop is:

**Notice -> Guide -> Settle -> Earn -> Improve -> Automate -> Discover -> Expand**

### 5.1 Notice

A Nursery Pod reveals a Sprout. Its identity and immediate need must be obvious from colour, silhouette, icon, expression, and/or a concise visual cue.

### 5.2 Guide

At the beginning of a garden, the player drags or taps the Sprout and guides it to its matching habitat. The intended destination should be discoverable without reading instructions.

### 5.3 Settle

A correct match creates immediate, multi-sensory feedback:

- Sprout happy animation
- Habitat reaction
- Particle effect
- Pleasant SFX where enabled
- Dewdrop reward
- Optional tiny Journal or achievement acknowledgement

An incorrect match is never punitive. The Sprout kindly indicates that it is not home yet and returns to a waiting area or remains available to move.

### 5.4 Earn

Settled, happy Sprouts generate **Dewdrops** over time. Dewdrops are a visible representation of healthy magical care and are the main early currency.

### 5.5 Improve

The player spends Dewdrops on upgrades, capacity, new homes, decorative expansions, and garden helpers. Every purchase must improve visible or understandable garden capability.

### 5.6 Automate

Automations perform a task the player has already performed manually. The game must first establish what the task means, then make the helper’s value evident.

### 5.7 Discover

New Sprout species, variations, rare types, areas, and Journal entries create medium-term goals. New discoveries should provoke a simple question: “What is that, and how can I help it?”

### 5.8 Expand

The garden opens into new visual spaces and eventually new terrariums. Expansion is a reward for care and a source of new gameplay, not simply a larger empty map.

## 6. First-Session Flow

The first session must be understandable, satisfying, and complete enough to establish the automation promise in 15–25 minutes.

### 6.1 First five seconds

The initial screen loads directly into the Hearth Garden. A Nursery Pod wiggles or glows. One Red Ember Sprout emerges. The Ember Nook is visibly warm and uses the same colour family plus a flame/leaf silhouette cue.

A short prompt may say: **“This little one looks for warmth.”** It must not explain systems or use game-design terminology.

The player can immediately drag the Sprout.

### 6.2 First minute

The player guides the Red Ember Sprout to the Ember Nook. The habitat brightens, flowers bloom, the Sprout celebrates, and Dewdrops appear.

A second and third familiar Sprout reinforce the interaction. A Blue Dew Sprout then introduces the Dew Pond. The player learns that visual matching matters.

### 6.3 First repetition

After the player has manually settled enough Sprouts to understand the action, multiple Sprouts appear closely enough together that a helper would clearly be useful. The game unlocks the **Garden Slide**.

The player places a single slide from the Nursery toward a chosen habitat. The slide visibly carries matching or assigned Sprouts, freeing the player to handle a new type.

### 6.4 First routing decision

After the Garden Slide makes one route automatic, the player sees mixed-colour Sprouts or a second destination that makes a single slide insufficient. The **Colour Gate** is unlocked.

The player selects a colour through obvious pictorial controls. The Colour Gate directs that colour along the connected path. No boolean logic, conditional syntax, or numerical rule entry is presented.

### 6.5 First rare moment

A Star Sprout can appear as a special variation. It gets a distinctive reveal with unique aura, sound, and Journal entry. It must be exciting, but it must not block progression or require spending.

### 6.6 First expansion

The player earns enough Dewdrops to reveal a small decorative expansion or additional garden plot. This must make the world feel larger and more personal, not merely increase capacity invisibly.

## 7. Sprouts

### 7.1 Base types

| Sprout | Readable identity | Preferred home | Personality and feedback |
|---|---|---|---|
| Red Ember Sprout | Red/orange palette, rounded flame-leaf crown, warm glow | Ember Nook | Energetic, bouncy, enjoys warm spark effects |
| Blue Dew Sprout | Blue/teal palette, droplet-like head leaves, cool glint | Dew Pond | Calm, floaty, creates water ripples and bubbles |
| Yellow Sun Sprout | Yellow/gold palette, petal/sun-ray silhouette | Sunflower Meadow | Cheerful, spins or stretches toward light, sheds pollen sparkles |

Each species must remain distinguishable in grayscale, for colour-blind players, and at a glance. Use shape, animation, habitat icon, and pattern in addition to colour.

### 7.2 Star variation

A **Star Sprout** is a rare variation, not a separate early-game requirement.

- Clearly special before selection: starlight aura, unique particles, altered silhouette accent, and distinct sound
- Uses the underlying habitat preference of its base type unless a later system explicitly changes this
- Adds a Garden Journal entry and cosmetic prestige
- May provide a modest bonus such as increased Dewdrop generation or a decorative habitat effect
- Is never required to proceed
- Its likelihood must be disclosed in a fair, understandable form if odds are shown

### 7.3 Future traits

Later phases may introduce visible, intuitive traits one layer at a time: shape, mood, need, season, and rarity. Traits must be designed as readable needs, not abstract tags. Later routing can use these traits, but player interactions must use icons and natural metaphors.

### 7.4 Behaviour rules

Sprouts may wander, inspect scenery, react to one another, celebrate, wait politely, and use garden routes. They must never create visual chaos or selection frustration.

When idle or waiting, they occupy clear waiting spots near the Nursery, do not obscure controls, never despawn because of player inaction, and do not create anxiety through distress states.

## 8. Habitats and Progression

### 8.1 Phase 1 habitats

| Habitat | Matching Sprout | Visual identity | Correct-settlement response |
|---|---|---|---|
| Ember Nook | Red Ember Sprout | Warm stone, ember plants, orange glow | Brighter coals, warm sparks, flowering heat-vines |
| Dew Pond | Blue Dew Sprout | Clear water, lily pads, blue crystals | Ripples, bubbles, water glimmer, blooming lilies |
| Sunflower Meadow | Yellow Sun Sprout | Soft grass, sunflowers, golden rays | Petals open, pollen motes drift, gentle light pulse |

Capacity is visually communicated through spaces such as nests, perches, flower beds, and lily pads. A full habitat remains cheerful but visibly has no room. Avoid relying exclusively on text like “3/5.”

### 8.2 Dewdrops

Dewdrops are healthy magical care made visible and are the only central Phase 1 currency.

Earn them through correct settlement, ongoing habitat care, achievements, limited offline care, and occasional discoveries. Spend them on **Garden Transit** — Garden Slides and Sprout Conveyor segments (§9.3, priced in §9.12) — plus Colour Gates, capacity upgrades, nursery rhythm improvements, additional habitats (§10.0), garden expansion, and visible improvements. Every Transit purchase is fully refundable on removal (§9.12), so spending is never a trap. Dewdrops are never sold for real money, gated by ads, or made scarce simply to force waiting.

### 8.3 Upgrade principles

Every upgrade must be understandable, visibly affect the garden or available options, solve known friction or create a new choice, have transparent cost, and not make early play feel pointless.

Phase 1 categories:

- Pod Rhythm
- Habitat Room
- Transit Speed *(2026-08-02: applies to every owned Garden Slide and Conveyor, not to a single Slide)*
- Healthy Dew
- Terrarium Flourish
- Colour Gate

### 8.4 Garden Journal and achievements

The Garden Journal is a collection book, lore surface, and long-term goal system: Sprout silhouettes, discovered entries, habitats, rarity/variation records, short observations, achievements, and future biome records.

Phase 1 has 12 collection slots, while three standard Sprouts and a rare Star variation are discoverable. Achievements celebrate meaningful milestones: first correct placement, first automation, first full habitat, first Star Sprout, and first expansion. They may grant modest Dewdrops, Journal stamps, or decorative flourishes; never scheduled/social requirements.

## 9. Automation System

Automation is the signature progression system. It must look like garden care infrastructure, be intuitive, and emerge only after the player has performed the manual action.

### 9.1 Principles

- Automate repetition, not discovery
- Keep new choices and layout expression player-led
- Make routes satisfying and visible
- Use physical garden objects, not abstract menus
- Support functional and aesthetic player expression
- Never require advanced optimisation for ordinary progress
- Offer recommendations and safe defaults

### 9.2 Garden Paths

Garden Paths are physical routes: mossy trails, glass root-tubes, flower-lined paths, water channels, or bubble streams. They must clearly show direction as needed through motion, integrated arrows, light flow, or route markers.

Phase 1 paths connect Nursery, Slides, Gates, and Habitats. *(2026-08-02: a path the player BUILDS is a Sprout Conveyor — see §9.3.2 and §9.9. The decorative walking paths that dress the garden and the functional Conveyor route are distinct objects; only the Conveyor carries Sprouts.)* Use a ghost preview, generous snapping, kind invalid placement feedback, and no pixel-perfect placement. Players can remove/reposition Phase 1 structures without punitive loss.

### 9.3 Garden Transit *(2026-08-02 revision — supersedes the single Garden Slide)*

**Garden Transit** is the collective name for the player-built, garden-integrated automation layer. It has exactly two purchaseable artifact families, plus the Colour Gate as a decision point placed within it:

| Artifact | What it means to the player | Problem it solves |
|---|---|---|
| **Garden Slide** | “A charming route that carries one kind of Sprout somewhere useful.” | High-visibility route acceleration — a delightful, legible delivery path that replaces repeated hand-carrying |
| **Sprout Conveyor** | “A little grown channel I lay down to shape where Sprouts go.” | Flexible route extension — connecting artifacts to destinations across a growing garden |
| **Colour Gate** (§9.4) | “A garden sign that sends each kind the right way.” | A conditional sorting decision where routes meet |

Both families are **permanent buildable artifacts**: bought with Dewdrops, placed by the player, saved with the garden layout, movable and removable through a clear reconfiguration flow, and visually built into the terrarium rather than set on top of it.

Neither may ever feel like a factory belt, a generic pipe, floating UI, or a maze. §14's amendment is the binding test.

#### 9.3.1 Garden Slides

The Garden Slide means: **“This helper carries Sprouts I choose from a source I choose to a home I choose.”**

- **Slides are not unique.** The player may own and place **multiple** Slides at once, limited only by cost, space, route validity, performance, and the Phase 1 complexity cap (§9.12).
- A Slide unlocks only after manual sorting is understood (the existing correct-placement milestone), and the first one must be an early, achievable, obviously worthwhile upgrade from hand-carrying.
- Every Slide is **configurable** with at minimum: accepted Sprout colour/type (including **Any**), an input/source point, a directional output/destination, and an enabled/disabled state. See §9.14.
- A Slide has a clear, original physical silhouette: a visible **entrance**, a raised curved or trough-like **transport channel**, **side rails or an edge lip**, **support structure** meeting the ground, and an identifiable **exit** with readable direction. See §9.16.
- Sprouts must visibly **enter, travel along, and emerge from** a Slide, then continue toward a valid destination. Teleporting a Sprout from entry to exit is never an acceptable substitute.
- Slides attach through explicit **compatible ports** (§9.13) — to the Nursery Pod, to Conveyors, to habitat approach docks — never by arbitrary mesh overlap, and never floating, intersecting, or ending ambiguously.
- Slides benefit from the Transit Speed upgrade (§8.3), which applies to every owned Slide.

#### 9.3.2 Sprout Conveyors

The Sprout Conveyor means: **“A modular length of grown or carved garden channel that guides Sprouts onward.”** It is the concrete, named form of the buildable route segment introduced in §9.9.

- Conveyors are bought and placed **one segment at a time**, cheaply enough that laying a route reads as a creative building action rather than a grind (§9.12).
- Multiple Conveyors may be placed. They snap to the tile grid using the same forgiving placement language as every other structure (§9.8, §10) — predictable, discoverable, and visually clean. Freeform drawing remains out of scope (§9.9).
- Conveyors connect **valid ports only** (§9.13): Nursery docks, Slide entries and exits, Colour Gate ports, habitat approach points, and other Conveyors.
- Each Conveyor has a visibly readable **direction, entrance, exit, and connection state**.
- Phase 1 Conveyor behaviour is deliberately simple: carry, guide, or deliver matching Sprouts toward an assigned valid destination. This is not a factory simulator — no throughput ratios, no balancing, no numeric optimisation.
- A Conveyor may carry a simple routing rule **only where needed**: directional output, destination assignment, and/or a colour/type filter (§9.14).
- Conveyors are modular: easy to remove and reposition, safe to edit without corrupting the state of a Sprout currently in transit (§9.15).
- A Conveyor is never decoration alone. Each placed segment must have a visible gameplay purpose and a visible automation effect.
- Conveyors must never create clutter, obscure Sprouts, block player interaction, harm camera readability, or make the terrarium read as industrial.

### 9.4 Colour Gate

The Colour Gate means: **“This garden sign guides one kind of Sprout down the right path.”**

It uses large pictorial colour/type controls, visibly shows its active rule, routes matching Sprouts toward a connected output, and sends nonmatches to fallback/waiting paths. Missing outputs produce friendly, specific feedback. It turns a mixed flow into understandable orderly routes.

*(2026-08-02: the Colour Gate is now a decision point **within** Garden Transit, not a peer of the Slide. It is placed on a junction where Conveyor routes meet (§9.10), exposes ports like any other Transit artifact (§9.13), and uses the same redundant colour+icon+text rule display as Slides and Conveyors (§9.14). Slides and Conveyors carry; the Gate decides.)*

### 9.5 Future automation families

**Routing helpers:** Shape Arch, Mood Bell, Seasonal Signpost, Priority Petal, Gentle Merge.

**Care helpers:** Watering Pixie, Sunbeam Mirror, Mossy Rest, Snack Basket, Breeze Fan.

**Growth helpers:** Moonlit Incubator, Crystal Planter, Friendship Arbor, Nectar Press, Star Observatory.

**Organisation helpers:** Garden Blueprint, Caretaker Sign, Path Painter, Hearth Clock.

### 9.6 Complexity curve

1. Direct transport to one home
2. One visual-attribute route
3. Two destinations and fallback
4. Multi-attribute routes
5. Capacity/congestion
6. Care stations before homes
7. Nearby habitat synergy
8. Optional timing, priority, compact layout optimisation
9. Blueprints and challenge layouts
10. *(2026-08-01)* Hand-placed structures and hand-drawn routes, constrained by tile/junction type
11. *(2026-08-01)* Junction backpressure: a junction accumulates arrivals until its rule is configured
12. *(2026-08-01)* Misroute stalls: a wrongly-routed Sprout waits at the last junction before the mismatched home for a manual fix

13. *(2026-08-02)* Multiple owned Slides, each filtered to a Sprout kind, composed with Conveyor segments into player-built routes — §9.3, capped for Phase 1 by §9.12

No stage requires writing rules, code, boolean algebra, or manual ratios. Stages 10–13 add spatial building and repair, never arithmetic — see §9.8–§9.17.

### 9.7 Bottlenecks

Bottlenecks are kind opportunities for problem-solving: busy waiting areas, full homes, queues at incomplete routes, or a new type without a home. Show the cause through animation/world state, then offer a simple recommended solution. Never hide critical information in dense metrics panels.

### 9.8 Manual placement of every unlock *(2026-08-01 revision)*

Every unlock other than pure decoration is **placed by the player**, never auto-built. The player is constrained in *where* a structure can go, never told *that* it must appear:

- A helper (Garden Slide, Colour Gate, Mood Bell, future helpers) can only be placed on a valid site: on the path network, oriented with the flow, and — for structures that need one — on a genuine junction (a Colour Gate cannot be placed on a plain straight route; it needs a fork to govern).
- Placement uses the same ghost-preview, generous-snap, valid/invalid-signal language §9.2 and §10 already establish for structures. Nothing about placement should feel different in kind between a Phase 1 structure and a hand-built route segment.
- An unlock still has to be *earned* first (Dewdrops, and any behavioural gate already established, e.g. the Colour Gate needing the Slide built first) — earning removes the restriction on placing it, it does not place it for the player.
- Buying an unlock the player has nowhere valid to place yet must say so plainly ("Build a junction first" rather than a disabled button with no explanation) — this is the same friendly-recovery-copy standard §11 sets for a misplaced Sprout.

### 9.9 Garden Routes as buildable segments — i.e. Sprout Conveyors *(2026-08-01, respecified 2026-08-02)*

**Naming resolution:** the buildable route segment introduced here on 2026-08-01 and the **Sprout Conveyor** specified in §9.3.2 are the same mechanic. This section states the placement law; §9.3.2 states what it is and what it does; §9.12–§9.15 price, port, configure, and recover it. There is exactly one buildable route substrate in this game. Do not implement a second one, and do not treat "route segment" and "Conveyor" as different entities.

A Garden Route (§9.2's mossy trail / root-tube / water channel) is no longer a fixed, pre-painted path — it is a Conveyor segment the player places, one tile at a time, connecting a source to a destination. Building a route costs a small number of Dewdrops per segment (a real, felt cost, not decorative), so a compact layout is a genuine reward, not just an aesthetic choice.

- Segments snap to the tile grid with the same forgiving placement rules as any other structure.
- A route must connect two valid endpoints (a Nursery, a habitat, a helper, or a junction) to do anything; an unconnected segment is inert and clearly reads as unfinished, not broken.
- Removing/rerouting a segment is safe and reversible per §10's existing "no punitive loss" rule — at most it refunds a partial amount, never confiscates progress.
- This is still never freeform: a route is placed tile-by-tile on the grid, exactly like every other structure in this game, not drawn with an arbitrary freehand line. Freeform drawing is explicitly out of scope — it invites precision frustration §10 already forbids.

### 9.10 Junctions and backpressure *(2026-08-01 revision)*

A **junction** is any tile where two or more routes meet or a route forks. Junctions are what a Colour Gate (or a future routing helper) is built onto — see §9.8.

- An unconfigured junction (no Gate built, or a Gate with no rule set for an arriving Sprout's kind) does not silently drop or lose Sprouts. Arrivals **accumulate**, visibly, in a clearly readable waiting cluster at the junction — the same friendly "waiting to be sorted" language as a full Nursery (§9.7).
- Accumulation has a generous visible cap tied to the junction's own art (it fills up the way a habitat fills up, per §8.1 — nests, perches, a growing pile — never a bare progress bar). Reaching the cap pauses new arrivals at the *previous* junction or the Nursery, the same backward-pressure principle already implicit in §9.7's "busy waiting areas."
- Configuring the Gate correctly immediately drains the backlog with a satisfying flush, not an instant teleport — motion sells the fix.
- This is the "capacity/congestion" stage (§9.6 stage 5) made concrete and spatial, not a new arithmetic system: the player is never shown a queue depth number they must reason about, only a visibly fuller or emptier junction.

### 9.11 Misroutes and repair *(2026-08-01 revision)*

If a Sprout is dispatched down a route whose junction sends it toward the wrong habitat (a genuinely misconfigured Gate, not the normal fallback-to-waiting case §9.4 already covers), it **stalls on the route just before the mismatched habitat** rather than settling incorrectly or vanishing.

- A stalled Sprout is calm, not distressed (§7.4's ban on distress states applies fully here) — a small "not quite home yet" cue, matching §11's recovery-copy tone.
- Resolution is always available two ways: fix the junction's rule so the *next* wave routes correctly (does not retroactively move an already-stalled Sprout — that would be an invisible, unearned fix), or hand-carry the stalled Sprout the rest of the way exactly as in §5.2's manual Guide step.
- A stall never expires, decays, or costs the player anything — see the §2.5 revision note above. It is a visible invitation to fix a junction, not a penalty for having built one.
- This is what makes §9.4's Colour Gate configuration matter in a way it previously didn't as strongly: a wrong lane choice now has a small, friendly, visible, always-fixable consequence in the world, rather than resolving invisibly through the fallback path.

### 9.12 Transit cost, refund, and structure limits *(2026-08-02, revised 2026-08-03)*

Dewdrops (§8.2) are the **sole** currency for Slides and Conveyors. No real-money purchase, ad, loot box, random price, punishing timer, or manufactured scarcity is permitted (§14).

**Costs are always shown before purchase and before placement is confirmed.**

**Balance target — validate in browser playtest, do not treat as settled.** These numbers are proposed against the shipped economy: income is `0.008 Dewdrops × settled Sprouts × multiplier` per 100ms tick, i.e. **4.8 Dewdrops per minute per settled Sprout**, and existing one-off unlocks cost 700 (Colour Gate) and 1500 (Mood Bell).

| Purchase | Cost | Notes |
|---|---|---|
| Garden Slide **N** | `round5(150 × 1.8^(N-1))`, capped at **2400** | 150, 270, 485, 875, 1575, 2400, 2400… |
| Sprout Conveyor segment | **15**, flat, no escalation | Cheap on purpose — laying a route is creative building, not a purchase decision |

- **First Slide = 150 Dewdrops**, unlocked by the existing correct-placement milestone. The milestone grants *permission* to build; the 150 is the *price*. At ~20 settled Sprouts that is roughly a minute and a half of income — an early, achievable, clearly worthwhile first automation.
- **Slide escalation is bounded**, not open-ended: the 1.8× growth stops at a stated maximum of 2400 so a large garden never faces an unreadable price, while early spam is still discouraged.
- **Conveyors do not escalate or hit an arbitrary node cap.** Creative route building stays cheap; valid connected tiles, available garden space, and visual readability are the practical limits.

**Refund and removal policy — generous by design (§10's "no punitive loss"):**

- Before placement is confirmed (ghost/preview stage), cancelling costs **nothing**.
- After placement, removing an artifact refunds it in **full**.
- **Slide refund rule (save-schema constraint):** removing a Slide refunds the price of slide **N** where N is the count owned *at the moment of removal* — i.e. removing your 5th Slide refunds 1575. This is self-consistent, requires no per-instance purchase price in the save, and cannot be arbitraged by buying and selling at different counts.
- A refund is never partial, delayed, or taxed. Mistakes must be cheap so experimentation stays joyful.

**Structure limit.** The player may own at most **4 Garden Slides** for now. Sprout Conveyors have no fixed count cap: they are the garden route substrate and can keep extending through valid connected tiles. The practical limits are available space and readable world density (§9.8).

### 9.13 Ports, anchors, and placement validity *(2026-08-02)*

Transit artifacts connect through **ports**: explicit, named, compatible attachment points. Connection is never inferred from meshes happening to overlap.

Port-bearing objects and their ports:

- **Nursery Pod** — one or more outbound docks where Sprouts leave.
- **Garden Slide** — one entry port, one exit port, each with a direction.
- **Sprout Conveyor** — one entry port and one exit port per segment.
- **Colour Gate** — one inbound port and its lane outputs.
- **Habitat** — an approach dock where a delivered Sprout arrives before settling.

Placement rules:

- Placement uses a ghost/preview with **valid, invalid, and blocked** states, each distinguishable without relying on colour (§11).
- An artifact snaps only to a **compatible port** or a valid terrain/path location. Snapping is generous; pixel-perfect placement is forbidden (§10).
- Invalid placement is **prevented before purchase is confirmed**, and the reason is explained in plain garden language ("This Slide needs somewhere to let Sprouts off").
- Artifacts maintain safe clearance from the Nursery, habitats, paths, terrain dressing, interactive objects, and each other. They must not clip the Pod, the floor, planting, or another artifact at **any supported camera angle or viewport size**.
- Routes recompute **deterministically** after placement, removal, reconfiguration, save/load, and a destination becoming full. The same garden state always yields the same routing.

### 9.14 Transit configuration *(2026-08-02)*

Every Slide, and every Conveyor that needs one, exposes a small configuration surface. It must stay spatial and pictorial per §15's item 8 — never a rule editor, formula, or spreadsheet.

- **Accepted kind:** a specific Sprout colour/type, or **Any**. `Any` accepts every kind and is the safe default for a first Slide, so a new player's first purchase works immediately without configuration.
- **Source and destination:** chosen from compatible ports, shown in-world as a highlighted route preview, not typed or entered numerically.
- **Enabled/disabled:** a player may switch an artifact off without removing it; a disabled artifact is visibly dormant, not broken, and never consumes or holds a Sprout.
- **Redundant cues are mandatory.** Every rule is communicated by **colour *and* icon/symbol *and* species text**, plus a direction arrow and a status line. Routing may never depend on colour alone (§11).
- The player can read any artifact's current rule and route **at a glance in-world**, and in full through an accessible details panel reachable by keyboard.

### 9.15 Route states, priority, and safe recovery *(2026-08-02)*

Every transit artifact is always in exactly one legible state: **idle**, **active/flowing**, **waiting**, **blocked**, **disabled**, or **invalid**. Each is readable in-world without opening a panel, and each is explained in friendly, specific, non-technical copy (§11).

Named conditions and their required behaviour:

| Condition | Required behaviour |
|---|---|
| No matching Sprout | Idle and calm. Not an error. |
| Destination full | The Sprout waits safely; the artifact shows a "this home is cosy and full" state; nothing is lost. |
| Blocked exit / no path | Waiting state with a specific explanation; never a silent stall. |
| Disabled by player | Visibly dormant; holds nothing. |
| Invalid target (removed or stale) | Explained plainly; the player is offered the fix. Never a silent reroute. |
| Route edited while a Sprout is in transit | The in-transit Sprout completes safely or is returned to a valid waiting position. Editing is always safe. |

**Absolute guarantees. An implementation that breaks any of these is wrong regardless of how well it reads:**

- A Sprout is never **trapped**, **deleted**, **duplicated**, **permanently blocked**, or **silently rerouted**.
- Removing a route artifact safely returns or reroutes every affected Sprout, and says what happened.
- Route priority between competing artifacts is **deterministic and documented**, never random.
- Nothing here is a failure state, a timer, or a loss (§2.5).

**Manual interaction always coexists.** Hand-carrying a Sprout (§5.2) remains fully available and valuable at every stage of Transit ownership. Transit removes repetition, never agency: a player who prefers to place every Sprout by hand must always be able to, and a Sprout waiting on a route must always be pickable by hand.

### 9.16 Transit art, readability, and performance acceptance *(2026-08-02)*

These are acceptance criteria, not aspirations.

**A completed Garden Slide must:**

- Read as an original magical miniature garden slide at normal gameplay camera distance, with no tooltip.
- Show an unmistakable entry, an elevated curved travel surface, supports meeting the ground, rails or an edge lip, and a visible exit.
- Use an original tactile material from a consistent Tiny Terrarium family — painted wood, glazed ceramic, carved root, polished stone — with bevelled/layered geometry, non-flat material response, correct scale, soft shadows, and contact grounding.
- Attach through explicit ports (§9.13) with **no clipping** into the Pod, floor, planting, habitats, or other artifacts at any supported camera angle.
- Carry an original, subtle active-flow signal — travelling leaf markers, rolling seed lights, shifting petals, gentle runes — never a copied reference effect, never bloom alone.
- Remain legible in high-contrast mode and when colour information is unavailable.
- **Never resemble a snake, hose, tube, wire, or a generic pipe on a box** (§9.17).

**A completed Sprout Conveyor must:**

- Read as a modular original garden channel that looks planted, carved, or grown into the terrain — never an industrial belt.
- Show clearly connected segments, obvious direction, compatible ports, and an understandable flow state.
- Snap cleanly with no gaps, overlaps, z-fighting, terrain clipping, floating supports, or ambiguous dead ends.
- Show where a Sprout is waiting, travelling, blocked, or delivered.
- Stay readable when several segments are connected.

**Both must:**

- Make the garden look **more** charming and complete as more are purchased — density that improves the space, never clutter (§10).
- Support reduced motion: state stays fully clear without continuous travel animation.
- Hold the frame budget with multiple Slides, many Conveyor segments, and many Sprouts in transit simultaneously, on the WebGL baseline and on the low quality tier (§12).

### 9.17 The superseded Slide design — explicitly rejected *(2026-08-02)*

The Garden Slide as shipped before this revision is **rejected as a design, not merely as an implementation**. Do not rebuild any of the following, and do not treat any of them as a constraint when designing Garden Transit:

1. **Only one Slide may exist.** Superseded: Slides are owned in multiples (§9.3.1).
2. **The Slide is a fixed Nursery add-on with an automatic destination.** Superseded: the player places it and chooses its source and destination (§9.13, §9.14).
3. **The Slide cannot be configured to collect a particular Sprout colour/type.** Superseded: an accepted-kind filter with an `Any` option is mandatory (§9.14).
4. **The Slide has no scalable routing role.** Superseded: Slides compose with Conveyors and Colour Gates into player-built networks (§9.3).
5. **It clips, floats, and attaches by mesh overlap.** Superseded: explicit ports and a no-clipping acceptance criterion (§9.13, §9.16).
6. **It reads as a snake or tube on a box.** Superseded: a mandatory silhouette of entry, channel, rails, supports, exit (§9.16).
7. **Its placement, entry, route, exit, direction, and purpose are ambiguous.** Superseded: each is a named, separately testable readability requirement (§9.16).

A future implementation that reproduces any item on this list has not met this document, however closely it matches the surrounding prose.

## 10. Building and Future Progression

Building is both functional and decorative. Players should be proud of compact, efficient layouts, winding whimsical paths, symmetrical gardens, and themed displays.

Placement uses forgiving grid/snap rules, translucent previews, valid/invalid signals that do not rely solely on colour, clear concise explanations, and safe early repositioning. Never auto-rebuild player gardens without consent.

Decorations are proof of restoration, including flower beds, lanterns, miniature bridges, water features, crystal clusters, trees, path skins, and biome landmarks. They must not compromise readability.

### 10.0 Buildable habitats *(2026-08-01 revision)*

Once a habitat is consistently full, the player may build an **additional habitat of the same kind** elsewhere on the plot, paid for in Dewdrops at a real, escalating cost — not raised capacity on the existing one. This makes "the garden is full" a genuine, felt building decision (§8.2's Dewdrop sink list gains "new homes" as a first-class entry, not a hypothetical) rather than a number quietly ticking up behind the scenes.

- A new habitat is placed like any other structure (§9.8's placement rules), constrained to valid open plot tiles connected to the route network.
- It must be visually equivalent in quality and readability to the original — never a cheaper or smaller reskin — so the garden reads as *more*, per §2.3's visible-transformation pillar, not as a workaround.
- Existing habitat-capacity upgrades (§8.3) still apply per-habitat; building a second habitat is a parallel lever, not a replacement for them.

### 10.1 Future biomes

Future terrariums can include Moonpond, Crystal Hollow, Cloud Canopy, Clockwork Conservatory, Mosswood, and Sunspire Terrace. Each biome needs distinct art, ambience, species, route materials, environmental rule, and meaningful unlock.

### 10.2 Ecosystem synergies and evolution

Later systems can reward understandable proximity: Dew Sprouts improve water-fed flowers, Sun Sprouts encourage sunny growth, Ember Sprouts warm cold habitats, and compatible pairs make visual/production bonuses. Synergies must be visible and optional.

Evolution uses care conditions, health, friendship, season, and rare discoveries. It should feel like celebration and player agency—not random gambling.

### 10.3 Seed Renewal

Long-term reset is called **Seed Renewal**. When a terrarium grows a Worldflower, the player may gather Elder Seeds and start a fresh cycle. It is optional, clearly explained, preserves discovery/Journal/themes/achievements/eligible blueprints/permanent gifts, and archives the old world as a Memory Garden or equivalent record.

Elder Seed choices create strategy/aesthetic variety: starting habitat space, cosmetic variation chance, route theme, modest offline care, early need hints, a starting helper, or a biome modifier. They must not reduce to mandatory raw multipliers.

## 11. Player Modes and Accessibility

### Cozy Keeper

The default mode uses highlighted destinations, gentle placement suggestions, safe undo/repositioning, ordinary auto-collection, recommended automation, and no failure state.

### Garden Builder

An optional later mode offers manual route control, priority/timing, efficiency/beauty challenges, compact-layout goals, blueprint sharing, and constrained gardens. It adds choice without invalidating Cozy Keeper progression.

### Required accessibility

- Keyboard navigation for UI and core interactions where practical
- Clear focus states
- ARIA labels and accessible equivalents for significant canvas actions
- Colour-plus-shape-plus-icon differentiation
- High contrast mode
- Reduced motion
- Independent music/SFX volume and mute
- Large touch targets
- Legible standard-zoom text
- Safe reset-save control
- Background pause/throttling

Onboarding requires an action inside five seconds, one mechanic at a time, concise contextual language, world demonstration before explanation, dismissible/revisitable help, and no modal barrage.

Recovery copy is friendly and concrete: “This path needs a clear destination,” “This home is already cosy and full,” or “This little Sprout is looking for somewhere wetter.” Do not surface technical errors to players.

## 12. Technical Constraints

- Browser-first, desktop/laptop primary with modern touch support
- No login required; local-first persistence
- Babylon.js is the intended 2.5D engine
- WebGL baseline; WebGPU opportunistic and never required
- Deterministic fixed-step simulation separate from renderer/UI
- Serializable, versioned state in IndexedDB or equivalent
- Sensible autosave and user-confirmed reset
- Offline care calculated from elapsed time with a conservative cap
- 60 FPS target on mainstream laptops
- Avoid unbounded particles, DOM churn, texture leaks, and per-frame allocations
- Offer quality/reduced-effect settings
- Audio/network errors must not break play

Separate simulation/domain, content data, rendering, input, UI, audio, persistence, progression, achievements, and debug tools. Simulation must be testable without Babylon.js or a browser canvas.

Maintain unit tests for simulation, progression, currency, routing, capacity, save/load, offline calculation, and achievements. Maintain end-to-end browser tests for initial load, manual correct and incorrect placement, automation unlock/placement, persistence, settings, reduced motion, keyboard flow, and development-only Star Sprout spawning. Accepted runs have no unhandled console errors.

## 13. Asset and Licence Rules

All shipped visual assets must be original/in-project or demonstrably appropriately licensed. Do not use game rips, copyrighted art without permission, unverified downloaded images, assets designed to imitate identifiable artists/games, or placeholders meant to remain in release builds. Keep source files for original assets where practical.

Audio must be original, CC0, or verified CC BY 4.0. Do not use CC NonCommercial, NoDerivatives, or ShareAlike material without a distinct licensing review. `docs/ASSET_CREDITS.md` must record creator, title, source URL, licence and URL, modifications, and required attribution; the game has an accessible Credits panel with required attribution.

## 14. Non-Goals and Guardrails

Excluded unless this document is intentionally revised:

- Combat, enemies, raids, defence, death, injury, suffering, or creature exploitation
- Real-money purchases, ads, loot boxes, or undisclosed collectible odds
- Required accounts, social dependency, or mandatory multiplayer
- Competitive pressure or mandatory leaderboards
- Programming interfaces or numeric spreadsheets as core gameplay
- Long-term repetitive clicking
- Large open-world traversal
- Heavy narrative cutscenes
- Dark, dystopian, grim, or harsh industrial tone

If a feature makes the player feel like an operator of a cold production system rather than a creative caretaker of a magical living garden, it does not belong.

**2026-08-02 amendment — Garden Transit is the hardest case yet for this guardrail, and must pass it as written.** Multiple owned Slides, per-artifact colour filters, and a network of placed Conveyor segments are, mechanically, logistics. They stay on the caretaker side of this line only because every one of the following holds:

- **Materials and form are garden-grown.** Painted wood, glazed ceramic, carved root, polished stone — planted into the terrain with supports and contact shadows (§9.16). A rubber belt on steel rollers fails this line no matter what the UI calls it.
- **No number is ever optimised.** There is no throughput figure, no ratio, no balancing, no efficiency score. A player reads a route by looking at it (§15 item 8).
- **The network stays spatial and legible.** Four Slides are allowed; Conveyors
  have no arbitrary node cap, with available space and route readability as the
  practical limits (§9.12) — still a garden the player shapes, not a factory
  floor that needs a plan.
- **Nothing is lost, timed, or punished.** Full refunds, safe edits mid-transit, no trapped or deleted Sprouts (§9.12, §9.15).
- **Manual care never becomes obsolete.** Hand-carrying stays fully available and valuable (§9.15).

If an implementation of Garden Transit leaves the player feeling like a logistics operator tuning a line — measuring, balancing, or optimising rather than shaping a garden — it has crossed this line and must be revised, regardless of how faithfully it matches §9.3's letter.

**2026-08-01 revision — this guardrail still applies, and is the test for the new building layer.** §9.8–§9.11 and §10.0 introduce hand-placed structures, player-drawn routes, junction backpressure, and misroute stalls — mechanically closer to a production system than anything in this document before. They stay on the caretaker side of this line only because: placement and routing are always spatial and visual (never a formula, a rule editor, or a number to optimise); a backed-up junction or a stalled Sprout is never punished, timed, or lossy (§2.5); and every consequence is narrated in the warm vocabulary §2.1 already establishes. Any implementation of these sections that starts requiring the player to calculate throughput, read a manual, or treat a stall as a mistake to be punished for has crossed back over this line and must be revised, regardless of how faithfully it matches this document's letter.

## 15. Feature Checklist

Before adding or approving a feature:

1. Does it strengthen the caretaker fantasy?
2. Can a non-technical player understand its basic purpose visually?
3. Does it add visible delight, meaningful choice, or useful capability?
4. Is it introduced after the player understands the problem it solves?
5. Does it preserve calm, recoverable, no-failure play?
6. Does it work with colour-blind, reduced-motion, keyboard, muted, and touch play where relevant?
7. Does it avoid coercive retention and pay-to-win design?
8. Does it create an appealing in-world result instead of opaque menu complexity?
9. Does it preserve visual clarity and performance?
10. Is it documented, testable, and correctly licensed?

If any answer is no, revise or defer the feature.

**2026-08-02 note on items 3, 4, and 8 for Garden Transit:** item 3 (visible delight, meaningful choice, useful capability) — a second Slide filtered to a different Sprout kind is all three at once, which is why multiple ownership is the core of the revision rather than a convenience. Item 4 (introduced after the player understands the problem) — the first Slide still arrives only after the manual-sorting milestone, and Conveyors only become purchasable once the player has a Slide whose route they might want to extend. Item 8 (in-world result, not menu complexity) — Transit configuration is a pictorial surface attached to the artifact in the world; the accessible details panel (§9.14) is an accessibility affordance and a redundant view, never the primary way to build a route.

**2026-08-01 revision note on items 1, 5, and 8:** hand-placed structures, buildable routes, junction backpressure, and misroute stalls (§9.8–§9.11, §10.0) are designed to pass this checklist as written, not to need it softened. Item 1 (caretaker fantasy): building and repairing a garden by hand is *more* caretaker-like than watching it build itself, not less. Item 5 (calm, recoverable, no-failure): a stall or a backed-up junction must always satisfy this exactly as any other bottleneck does — if a specific implementation can't, that implementation is wrong, not the checklist. Item 8 (in-world result, not menu complexity): placement and routing must stay spatial, on the actual game board, never a separate configuration screen. Use this note to resolve apparent tension, not to lower the bar.

## 16. Phase 1 Definition of Done

Phase 1 is complete when a player can:

1. Load into a polished Hearth Garden
2. Recognise and settle Red Ember, Blue Dew, and Yellow Sun Sprouts without technical explanation
3. Receive joyful feedback and Dewdrops for correct care
4. Recover safely from an incorrect habitat attempt
5. Unlock, buy, place, and observe a **Garden Slide** automate a familiar task — and then buy, place, and configure **a second Slide filtered to a different Sprout kind**, seeing both run at once *(2026-08-02: multiple ownership is part of Done, not a later phase — a single Slide no longer satisfies this item; see §9.3.1 and §9.17)*
6. Unlock, configure, and observe Colour Gate route a mixed stream
   *(2026-08-02: as a decision point placed within Garden Transit — see §9.4)*

   *(2026-08-01 note: this list describes the shipped Phase 1 experience and remains historically accurate — Phase 1 automations arrived pre-built. The 2026-08-01 revision changes placement to player-driven going forward per §9.8; existing saves need a migration, not a rewrite of this list.)*
7. Buy meaningful upgrades and see their effects in the world
8. Discover a rare Star Sprout
9. Use Garden Journal, achievements, settings, and credits
10. Save/reload and receive modest offline care
11. Play successfully with muted audio, reduced motion, and high contrast
12. Buy and place **Sprout Conveyor segments** to extend one route from a Slide exit to a chosen habitat approach, and read that route's valid, idle, blocked, and full states without opening a panel *(2026-08-02, §9.3.2/§9.15)*
13. Remove a transit artifact, receive the documented full refund, and see every affected Sprout safely returned or rerouted with an explanation *(2026-08-02, §9.12/§9.15)*
14. Feel their choices made the garden more alive and capable

The required closing feeling is:

> “I started by helping a few adorable little creatures, and now I have built a beautiful garden that gently takes care of itself—but I cannot wait to see what I can unlock and improve next.”

## 17. Change Control

`GameRules.md` is stable by design. Do not change it for implementation convenience. An intentional revision requires a recorded reason, updates to related design/architecture/art/accessibility/QA documents, relevant test updates, and a check against the North Star, Pillars, and Non-Goals.

When uncertain, choose the option that is kinder, more readable, more visibly expressive, and more faithful to the magical caretaker fantasy.
