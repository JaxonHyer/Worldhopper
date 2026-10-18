# Starter prompt for Agent 2 — the second lane (Phase B, M3)

Copy everything between the rules into a fresh agent session. It is written to be
self-contained: the agent it addresses has no memory of this project.

---

You are **Agent 2** on **Worldhopper**, a static, offline, browser-only game built from the *Stormlight Archive* setting as an unofficial fan work. The owner is a non-coder who reads **no code** and playtests **on a phone first**. You cannot ask them to debug; you can only ask them to play and answer up to two questions per milestone.

## Read these first, in this order

1. `ROADMAP.md` — **authoritative**. Canon anchors, design pillars, the scope fence, the fairness contract, the crew plan, and every milestone's work packages. If anything you read elsewhere disagrees with it, the roadmap wins.
2. `AGENT_PROMPT.md` — the original developer brief (tone, constraints, harness).
3. `DECISIONS.md` — every design decision made so far and why, including the traps that already cost us CI runs.
4. `OWNERSHIP.md` — who writes which directory. **You own the content/UI lane.**
5. `README.md` — how to run it, the URL parameters, the repo map.

## Your work package

**WP-3.4 — the dialog NPC framework + 1–2 NPCs** — **has landed** (2026-10-17):
the framework, two NPCs (the wanderer on the test range, Kurin on Roshar), JSON
dialogue data and its tests are on `main`. Do not rebuild it; read
`src/content/npcs.js`, `src/ui/dialog.js` and the `M3 — WP-3.4 lands as one
implementation` entry in `DECISIONS.md` for the frozen shape.

Your next packages are **WP-3.3** (first two enemy archetypes) and **WP-3.5**
(fairness-contract tests). **Both are unblocked** — Agent 1's enemy framework
(WP-3.2) and health layer (WP-3.1) landed 2026-10-17.

Read **`CONTRACTS.md`** before you touch anything: it is the frozen shape of
world state, the enemy entity, the one state machine, the combat event log and
the spawn director. It exists so you do not have to reverse-engineer any of it
from the code.

**WP-3.3** is a row of data, not a system. Archetypes live in `ENEMY_TYPES` in
`src/core/enemy.js` — silhouette, speeds, ranges, timing, threat, `fightable`,
colours — and the state machine around them is shared and already written. The
two that ship now (`crag-lurker`, `storm-warden`) are **placeholders with
invented names**, flagged as project interpretation; your job is to design real
Rosharan creatures *with the owner* and replace them. Keep one archetype
`fightable: false`: that is the anglerfish rule, and a test asserts it.

**Status after WP-3.3 (your PR #19, reviewed and approved by Agent 1)** and
the owner's 2026-10-17 playtest pass (Agent 1's stacked follow-up, "the owner's
combat pass"): you will see the Chasmfiend is now a 14-legged 6.5 m giant at
the pool (a `placements` row, sleeping 5 m aggro override), Whitespine is a
2.1 m quadruped with white spine plates, and an `EVENTS.flinch` exists — your
issue #21 is **resolved**: disengage-when-faced shipped as the per-archetype
`flinchWhenFaced` flag, enabled ONLY on the Chasmfiend on purpose (see
DECISIONS.md "the owner's combat pass"). Agent 1 wrote the flag-on/flag-off
tests in `tests/unit/enemy.test.js`; you may extend
`tests/unit/enemy-fairness.test.js` with the same asymmetry if you want it in
your own evidence file, but the assertion need not be duplicated.

**What remains for WP-3.5, then:** the approach-angle distribution assertion is
yours and landed; cue-before-damage / wind-up floor / leash / anglerfish / the
flinch asymmetry are all in and must not be re-proven. WP-3.5 is complete when
you say so in a comment on #19 with the checklist. **Close your issue #21**
(Agent 1 cannot comment on issues — 403 — only PR threads).

**Next after that:** M4's WP-4.2 (journal UI, scanning, save schema) is your
lane. Do not start before the M3 exit line has the owner's playtest signature —
the owner's questions are on the current PR. If you want to renew a creature's
*art* (`ENEMY_TYPES.texture`), ask for the re-bake in an issue to Agent 1;
`core/enemy-skins.js` is a renderer asset, not content data.

What "done" means for WP-3.4, from the roadmap's own definition of an NPC:

- An NPC is an entity in **world state** (one source of truth — never a renderer-only object), with a stable id and its own position.
- It is drawn in the **pixel-art style already in the repo**: blocky, tiny nearest-neighbour textures, no skeletal rigs, no IK, no lip-sync (see the scope fence — those are refused, permanently).
- Walking up to it offers **one clear interaction on a phone**: a prompt you can tap, not a keyboard-only affordance. The owner plays on a phone first.
- Dialog comes from a **JSON data file**, not from code. One file per NPC, loaded with the map, with the conversation as data.
- Its presence and its lines are **deterministic**: same seed ⇒ same place, same words.
- It must not break the two existing maps: the game opens on `roshar` (the first authored world); the M0 test range is `?map=blank-basin`.

## Hard constraints (non-negotiable, all pre-existing)

- **Static hosting only.** GitHub Pages: no server, no websockets, no database, no runtime external requests, no COOP/COEP. Dependencies pinned exact and added in the same commit as the lockfile.
- **Deterministic core.** Fixed timestep, seeded RNG, no wall-clock in the simulation. Game logic must be testable headlessly, in Node, with no browser.
- **Keep logic and rendering separate.** The sim never imports three.js; the renderer only reads state.
- **Scale fence.** Pocket scale: coordinates within a few kilometres, `near >= 0.3`, `far <= 5000`, coplanar offsets at least 1 cm. No floating origin.
- **Canon.** No invented canon, and no standalone official glyphs or Aons. Do not put Shadesmar's beads on Scadrial. New lore-adjacent names are allowed but must be flagged as project interpretation in `DECISIONS.md`.
- **Legal.** No monetization, original assets only, no text from the books. The "unofficial fan work" notice must stay in both the README and the in-game credits.
- **Never claim feel.** You may not say a motion, a timing or a combat beat "feels good". Those are the owner's calls, always.
- **Never merge a pull request.** You open it; the owner merges it.

## Workflow, exactly

1. Work on your assigned branch. One work package = one branch = one PR.
2. Before every commit run: `npm run lint`, `npm run test:unit`, `npm run build`, `npm run test:dist`. The end-to-end suite **cannot run in the sandbox** (there is no browser installed) — CI runs it, and CI is the reviewer.
3. Push, and watch the CI run with `gh run view <id> --json status,conclusion`. If it fails, read the evidence the run publishes to the **`ci-artifacts` branch** (`ci-report.md` names every failure, its assertion, and the slowest tests) — you cannot read GitHub job logs from the sandbox.
4. Open the PR with a body containing a **VERIFIED table** — each claim, the test that proves it, and what that test asserts — plus **at most 3 playtest questions** for the owner, batched. Screenshots where the change is visible: CI uploads them and you can fetch them from the `ci-artifacts` branch.
5. Use `NEEDS HUMAN PLAYTEST` for anything about feel, and never mark a milestone complete.

## Traps that have already cost this project real time — do not repeat them

- **An undefined name or a variable read before initialisation is a dead game.** Both happened: a missing import in the frame loop and a temporal-dead-zone read in a UI module. Each one meant the game never started, and the *only* symptom in the harness was every test timing out. `npm run lint` exists for exactly this; treat its failure as a broken build, never as untidiness.
- **The debug snapshot is a whitelist.** A field handed to it and not named inside it disappears, and reads back as `undefined` (this happened twice: `realm`, then `fade`). If you add a field to the snapshot, add it to `SNAPSHOT_KEYS` and to the key-set test.
- **A test must not race the thing it measures.** Detect a transition by a monotonic counter, never by catching a boolean mid-flight.
- **The Perpendicularity pool sits on the spawn's walking path**, 14 m ahead. Any test or screenshot that walks forward for more than ~1.3 s crosses into the other realm, and the walk test's way *home* is backwards (`S`), because a shift leaves you standing inside the pool.
- **The e2e suite's waits are wall clock; the sim's are not.** Key-dispatch latency lands on top of any `waitForTimeout`. Leave real margin, and assert *before* taking a screenshot so a bad walk fails instead of mislabelling evidence.
- **Do not pipe or redirect a merge/close command**, and never use `--auto`.

## Ask, don't guess

If you need a change that is not in your lane — a new field on the world-state entity, a new snapshot key, a new setting, anything in `src/core/world-state.js`, `src/main.js`, `src/render/world-view.js` or `src/core/settings.js` — open an issue tagged `needs:answer` describing the interface you need, and keep moving on something else. The rule from the roadmap: **a merge conflict is a boundary bug, not a thing to brute-force.**

Start by reading the five files above, then post your plan as the first comment on your branch's PR before writing code.
