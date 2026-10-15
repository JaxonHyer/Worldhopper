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
- [x] Desktop: **click the world to capture the mouse** (Esc releases it; the
      camera then follows the mouse with no button held), WASD/arrows, space,
      Q/E turn. Drag-look is the fallback and can be forced with `?capture=off`
      (also a switch in the tuning panel)
- [x] Live feel sliders: walk speed, jump height, gravity, acceleration, view bob
- [x] Debug overlay reports the player and the input mode
- [x] 118 headless unit tests + 60 e2e tests on desktop and phone projects
- [ ] **M1 sign-off — needs the owner's playtest** (checklist in the PR)

### M1.5 — third person + the blocky look (owner's playtest notes, 2026-10-15)

*M1 passed playtest ("that was a pass"), with two changes: third person, and
blocky characters.)*

- [x] Third-person camera: a boom behind the character, which shortens rather
      than pass through terrain or rocks, and hides the body when it is too
      short to see past
- [x] `Camera` (third/first) and `Camera distance` controls; first person keeps
      the full vertical look range
- [x] Blocky player: box limbs with pivots at the shoulders and hips, walking
      cycle driven by the sim's stride phase, arms raised in the air
- [x] The owner's playtested feel numbers are the defaults (pinned by a test)
- [x] Tuning panel grouped into world / camera & looking / walking & jumping
- [ ] **M1.5 sign-off — needs the owner's playtest** (third person distance and
      height, the blocky look, and whether the avatar's walk reads well)

### M1.6 — animation, pixels, plain clothes (owner's playtest notes, 2026-10-15)

- [x] Walk-cycle rate capped (2 cycles/s default) with a live slider; extra
      speed widens the swing instead of quickening it
- [x] Pose easing is frame-rate independent (30 fps and 120 fps agree)
- [x] Characters carry real pixel textures (nearest-filtered, mip-mapped),
      authored as data and asserted by tests
- [x] Ordinary clothes: plain shirt, trousers and boots; ten boxes; no pack
- [x] **M1.6 sign-off — accepted by the owner** ("the animation was perfect, i
      did not have to change anything")

### M1.7 — the face, the girl, sprint (owner's playtest notes, 2026-10-15)

- [x] A Minecraft-style face (eyes with whites, nose, mouth, jaw) in the head
      texture, and the body turns to face the way it walks so the camera can see
      it ("because of camera position I cannot see the face")
- [x] An alternate girl character behind one boolean (`girlPlayer`, `?girl=1`,
      a checkbox in the panel): slimmer arms, long hair, her own palette
- [x] Sprint: hold shift on desktop, a bottom-left toggle button on the phone,
      `?sprint=` multiplier, stride cap intact
- [x] **M1.7 sign-off — accepted by the owner** ("It was all good except for
      that the girl's hair looks weird, ...")

### M1.8 — hair as texture, sprint at 2.20 (owner's playtest notes, 2026-10-15)

- [x] The girl's long hair is drawn into her textures — no geometry; she has
      the boy's box count and the boy's texture set
- [x] Sprint default is 2.20× (the owner's number), still under the stride cap
- [x] **M1.8 sign-off — accepted by the owner** ("It's good. All of it.")

### M2 — the Cognitive Realm (the realm switch)

**Plan:** the same world, a second rendering (§2/§4 — never a second engine).

- [x] `state.realm` + `toggleRealm()`: a lens flag the sim never reads; a unit
      test walks the same seed in both realms to the same entity hash, and the
      e2e test checks tick, entity hash and player position across a shift
- [x] The Cognitive lens: an orthographic, high-angle camera in the same scene,
      same coordinates, yaw following the player, fixed diagram pitch, visible
      height from `Cognitive lens height` (`?realmzoom=`, 16–140 m)
- [x] Input on both devices: <kbd>F</kbd> on desktop, a **realm** button on the
      phone; consumed as an edge, never a held state; a HUD badge that says which
      realm you are in
- [ ] The look: palette, fog and the abstracted forms (what objects and living
      things *become*) — per-world `cognitiveSkin` data, with the canon guard
      that beads are Rosharan-only; presented to the owner as screenshot options
- [ ] Something solvable only in the lens (§2 step 4): one hidden thing that the
      Cognitive realm reveals, and a gate that only opens because of it
- [ ] **M2 sign-off — needs the owner's playtest**

### Later — the owner's requests (not yet scheduled)

- **Swappable input bindings per magic kit** (owner, 2026-10-15): "multiple
  different input bindings that the player can swap between ... for different
  magic sets. (Like windrunner and mist born.)" Today's controls are the
  permanent default set; kits add their own binding tables, and the swap changes
  the bindings *and* the HUD legend. Belongs with the `MagicKit` contract (M6
  in the brief), together with the attunement swap window already declared in the
  tuning panel.

### Blocked on the owner

- **M1 sign-off** — the checklist in PR #2 needs a playtest (phone first: stick,
  jump button, look sensitivity, view bob; desktop second: does the mouse
  capture feel standard?).
- (Resolved) Pages deploys: the repository is public and M0 is merged
  (`main` = `93d9147`), so <https://jaxonhyer.github.io/Worldhopper/> is live
  and updates from `main`.

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
