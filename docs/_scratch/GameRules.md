# Tiny Terrarium Works — Game Rules and Design Ground Truth

**Status:** Canonical design specification  
**Purpose:** This document is the authoritative reference for product, game-design, art, UX, content, and engineering decisions. Every new feature must preserve the player fantasy, core loop, accessibility rules, and scope boundaries set here. If an implementation conflicts with this document, change the implementation—not the design—unless the design change is explicitly approved and this file is revised intentionally.

## 1. Design North Star

**Tiny Terrarium Works** is a premium-feeling, cosy browser automation and collection game set inside a magical living terrarium.

The player cares for adorable creatures called **Sprouts**. They first sort Sprouts into appropriate homes by hand, then build charming garden helpers that perform repetitive care automatically. Over time, a small, quiet terrarium becomes a beautiful, lively, self-running ecosystem.

The game’s primary emotional promise is:

> “I made this little garden work, and it is becoming more beautiful, capable, and uniquely mine.”

The game must feel approachable in the first five seconds, rewarding in the first minute, and increasingly rich over many sessions. It must never require programming knowledge, factory-game familiarity, arithmetic optimisation, or the ability to read dense system documentation.

## 2. Product Pillars

### 2.1 Care before industry

The player is a caretaker, not a production-line manager. Sprouts are living, expressive creatures, habitats are homes, and automation is gentle garden care.

Internally, systems can behave like factory logistics. Externally, the language and visual presentation must remain warm and intuitive:

- “Garden Slide,” never “conveyor belt”
- “Colour Gate,” never “filter splitter”
- “Habitat,” never “consumer building”
- “Dewdrops,” never “currency unit”
- “Garden Journal,” never “collection database”
- “Seed Renewal,” never “prestige reset”

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

Earn them through correct settlement, ongoing habitat care, achievements, limited offline care, and occasional discoveries. Spend them on Garden Slides, Colour Gates, capacity upgrades, nursery rhythm improvements, garden expansion, and visible improvements. Dewdrops are never sold for real money, gated by ads, or made scarce simply to force waiting.

### 8.3 Upgrade principles

Every upgrade must be understandable, visibly affect the garden or available options, solve known friction or create a new choice, have transparent cost, and not make early play feel pointless.

Phase 1 categories:

- Pod Rhythm
- Habitat Room
- Garden Slide Speed
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

Phase 1 paths connect Nursery, Slide, Gate, and Habitat. Use a ghost preview, generous snapping, kind invalid placement feedback, and no pixel-perfect placement. Players can remove/reposition Phase 1 structures without punitive loss.

### 9.3 Garden Slide

The Garden Slide means: **“This helper carries Sprouts from the Nursery to one home.”**

It unlocks only after manual sorting is understood, is placed visibly in the world, has a clear destination, carries Sprouts with a fun movement animation, shows throughput/congestion simply, benefits from speed upgrades, and creates space for the next challenge instead of eliminating all interaction.

### 9.4 Colour Gate

The Colour Gate means: **“This garden sign guides one kind of Sprout down the right path.”**

It uses large pictorial colour/type controls, visibly shows its active rule, routes matching Sprouts toward a connected output, and sends nonmatches to fallback/waiting paths. Missing outputs produce friendly, specific feedback. It turns a mixed flow into understandable orderly routes.

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

No stage requires writing rules, code, boolean algebra, or manual ratios.

### 9.7 Bottlenecks

Bottlenecks are kind opportunities for problem-solving: busy waiting areas, full homes, queues at incomplete routes, or a new type without a home. Show the cause through animation/world state, then offer a simple recommended solution. Never hide critical information in dense metrics panels.

## 10. Building and Future Progression

Building is both functional and decorative. Players should be proud of compact, efficient layouts, winding whimsical paths, symmetrical gardens, and themed displays.

Placement uses forgiving grid/snap rules, translucent previews, valid/invalid signals that do not rely solely on colour, clear concise explanations, and safe early repositioning. Never auto-rebuild player gardens without consent.

Decorations are proof of restoration, including flower beds, lanterns, miniature bridges, water features, crystal clusters, trees, path skins, and biome landmarks. They must not compromise readability.

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

## 16. Phase 1 Definition of Done

Phase 1 is complete when a player can:

1. Load into a polished Hearth Garden
2. Recognise and settle Red Ember, Blue Dew, and Yellow Sun Sprouts without technical explanation
3. Receive joyful feedback and Dewdrops for correct care
4. Recover safely from an incorrect habitat attempt
5. Unlock, place, and observe Garden Slide automate a familiar task
6. Unlock, configure, and observe Colour Gate route a mixed stream
7. Buy meaningful upgrades and see their effects in the world
8. Discover a rare Star Sprout
9. Use Garden Journal, achievements, settings, and credits
10. Save/reload and receive modest offline care
11. Play successfully with muted audio, reduced motion, and high contrast
12. Feel their choices made the garden more alive and capable

The required closing feeling is:

> “I started by helping a few adorable little creatures, and now I have built a beautiful garden that gently takes care of itself—but I cannot wait to see what I can unlock and improve next.”

## 17. Change Control

`GameRules.md` is stable by design. Do not change it for implementation convenience. An intentional revision requires a recorded reason, updates to related design/architecture/art/accessibility/QA documents, relevant test updates, and a check against the North Star, Pillars, and Non-Goals.

When uncertain, choose the option that is kinder, more readable, more visibly expressive, and more faithful to the magical caretaker fantasy.
