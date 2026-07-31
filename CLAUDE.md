# Tiny Terrarium Works — working agreement

A cosy 2.5D Sprout-sorting automation game. Babylon.js + TypeScript + Vite.

## Keep `work_progress.yaml` current — this is mandatory

`work_progress.yaml` in the repo root is the handoff record. This project has
repeatedly lost work-in-flight to API spend limits, connection drops and agent
stalls, and that file is how the next session, a different agent, or a subagent
inheriting someone's half-finished change picks up without re-deriving
everything.

**Every agent, including every subagent, must maintain it.** Specifically:

1. **Read it first.** Before starting work, read `work_progress.yaml` — it
   records what is already done, what is uncommitted and owned by someone else,
   which approaches were already tried and rejected, and the gotchas that have
   cost real time. Reading it is cheaper than rediscovering any of that.
2. **Write your intent before a long task**, not only after. An interruption
   mid-task should leave a trail, not a mystery. Record what you are about to
   attempt and why.
3. **Record expensive findings, especially negative ones.** "X is not the
   cause, proved by Y" is exactly the knowledge that is costly to rediscover
   and that nobody thinks to write down.
4. **Update it as part of the work, not as a chore afterwards** — an update
   that never happens because the agent was killed is worth nothing.
5. **Never mark something done unless its checks actually passed.** A truthful
   `blocked` or `partial` entry is more valuable than an optimistic `done`. If
   you could not verify something, say so and say why.
6. **Note in-flight file ownership.** If you leave uncommitted changes, record
   which files are yours so a concurrent agent does not commit or "fix" them.

Keep it accurate rather than exhaustive. A short truthful entry beats a long
aspirational one.

## Authority when documents disagree

`docs/_scratch/GameRules.md` is the canonical design spec. Its §17 states it
wins over any implementation, and that revising it requires a deliberate,
recorded change plus updates to dependent docs and tests.

Do not quietly contradict it to make an implementation easier, and do not
quietly implement a request that conflicts with it. Surface the conflict, cite
the sections, and ask. Either answer is fine — revise the doc deliberately, or
change the plan — but the conflict must be visible, not resolved by silence.

Then, in order: `docs/CONTRACTS.md` (event union, ids, grid, save format),
`docs/ARCHITECTURE.md` (as-built; it has gone stale before — update it when you
change the shape of things).

## Verification standard

```
npm run typecheck && npm run lint && npm test && npm run build
```

All four must pass before claiming work is complete. For anything that renders,
**source reading is not sufficient evidence** — verify in the browser. This
project has produced several confident-but-wrong conclusions from reading code
alone, and several more from trusting a stale browser (see the `stale-hmr` and
`browser-session-sharing` entries in `work_progress.yaml`).

Report outcomes faithfully. If tests fail, say so with the output. If a step was
skipped, say that. State plainly what you verified and what you did not.

## Architecture boundary

Nothing under `src/sim/` may import from `src/render`, `src/ui`, `src/audio` or
`src/input` — a test enforces this. Simulation is deterministic, fixed-step and
headless-testable. Player intent with no `GameEvent` member is exposed as plain
functions on `SimRuntime`.

Prop dimensions live once in `src/render/propDims.ts`; derive heights from it
rather than writing literals. Balance values in `src/data/` are coupled to each
other — tests derive from the data tables rather than hardcoding, deliberately.
