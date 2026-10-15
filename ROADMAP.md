# Worldhopper — Roadmap

*(working title — unofficial, non-commercial Cosmere fan project)*

A low-poly **3D** planet-exploration game. You are a worldhopper-scholar:
explore small worlds on foot, dip into the **Cognitive Realm** (a 2D,
orthographic reading of the *same* world, with a per-world appearance —
see Canon anchors) to see hidden truth and change it, survive the
world's dangers, attune to different magic systems, and open each
world's **Perpendicularity** to hop onward.

- **Reference touchstone:** *Outer Wilds* — a tiny system, each planet
  built around exactly one idea.
- **Explicit anti-reference:** *No Man's Sky* — infinite scale and
  content volume are out of scope. No crafting, no grind, no infinite
  generation.

---

## How this project works

- The **owner writes zero code**. AI development agents build and
  verify everything; see `AGENT_PROMPT.md` (the agents' brief).
- The crew scales in phases: **1 agent (M0–M2) → 2 agents (M3–M5) →
  5 agents (M6–M8).** Coordination rules live in the **Crew plan**
  section. Nothing coordinates through chat memory — all state lives
  in the repo (issues, PRs, files).
- Every milestone ends with a **playtest** by the owner on real
  hardware (desktop + phone). Feedback arrives as words; feel is tuned
  via in-game sliders (the tuning panel), not rebuild requests.
- Status lives in the checkboxes below and on the GitHub Issues board.
  `DECISIONS.md` logs why things are the way they are.

---

## The core loop (the game IS this loop)

---

## Status

*(Maintained by the agents; the checkboxes are the shared source of truth. A
milestone is never "done" because an agent says so — the owner confirms it after
playtesting.)*

### M0 — foundation — **in review, awaiting the owner's playtest**

- [x] Vite + three.js pinned exact, `base: './'`, `.nojekyll`
- [x] Pages deployment via the official Pages actions (`dist/` is never committed)
- [x] `LICENSE` + `NOTICE.md` with the unofficial-fan-work text, and the same
      notice in the in-game credits
- [x] Blank world: sky gradient, faceted ground, fog at the palette's colour, one
      landmark silhouette (the Grey Needle), seeded rock scatter
- [x] Debug overlay (`` ` ``): FPS, distance from origin (scale-fence canary),
      realm, seed, entity count, draw calls, GL info
- [x] Tuning panel (`p`): live sliders, URL + localStorage persistence, copyable
      config link; later-milestone controls declared and disabled
- [x] Headless smoke test (Playwright + Chromium) in CI, screenshots as artifacts
- [x] 75 headless logic + scene-graph tests (`npm run test:unit`) and a dist
      constraint check (`npm run test:dist`)
- [x] Phone layout + touch look path, and on-screen dev buttons behind `?dev=1`
- [ ] **M0 sign-off — needs the owner's playtest** (three questions in the PR)

### M1 — the player — **in review, awaiting playtest**

*Scope note: the roadmap has no milestone list yet (see Open questions), so M1 is
scoped from the brief: "touch input required from M1 onward", M0 was explicitly
non-interactive, and M2 is the Cognitive Realm.*

- [x] Player: capsule-vs-heightfield movement with solid rocks and landmark,
      step height, slide-along-walls, world bounds
- [x] Jump with coyote time (0.12 s) and a jump buffer (0.15 s)
- [x] Phone-first touch: thumb-stick, right-side look-drag, jump button
- [x] Desktop: WASD/arrows, space, drag-look, Q/E turn
- [x] Live feel sliders: walk speed, jump height, gravity, acceleration, view bob
- [x] Debug overlay reports the player and the input mode
- [x] 105 headless unit tests + 48 e2e tests on desktop and phone projects
- [ ] **M1 sign-off — needs the owner's playtest** (checklist in the PR)

### Blocked on the owner

- **GitHub Pages cannot deploy while this repository is private.** Pages requires
  a public repository (or a paid plan), and `main` has never been pushed, so
  nothing is live yet. Also note `main` currently has **no commit at all** — it
  has no files, so merging this branch would be the first commit on it. Making
  the repo public and merging the M0 PR turns the deploy workflow on.

### Open questions for the owner

- The brief (§1) names `ROADMAP.md` § "Canon anchors" as the source of truth for
  lore, and §0/§10 name a "Crew plan" section, but neither section exists in this
  file yet. M0 needed no lore (the test range is explicitly non-canon), so no
  canon was invented. **Do you want the agent to draft those sections from the
  brief, or will you write them?**
- Milestones M1–M8 are referenced throughout the brief (touch at M1, AI
  assertions at M3, five agents at M5, binding snapshots at M6, the Inquisitor
  and Scadrial at M7) but are not listed here yet. Same question: draft them from
  the brief, or do you write them?
