# Worldhopper — Developer Brief

**To:** the AI development agent with repo access
**From:** the project owner (human, writes zero code, playtests everything)
**Status:** working title — non-commercial Cosmere fan project

---

## 0. Read this first

You are a developer of this project. In the early milestones (M0–M2) you are the
**only** developer; from M3 the owner runs **2 agent sessions** against this
repo, and from M5, **5** — see the Crew plan section of `ROADMAP.md` and the
multi-agent rules in §10. The owner will not write, read, or debug code. They
*will* play the game on real hardware (desktop and phone) and they own every
taste decision. Your job has two halves:

1. Build what can be built and **verify what can be verified** (tests,
   screenshots, console logs, state assertions).
2. Clearly separate what cannot be verified by you and **hand it to the human
   with a short playtest checklist**.

The companion document is `ROADMAP.md` — the milestone plan you will work
through. If this brief and the roadmap ever conflict, stop and ask the owner
instead of guessing.

Two rules that override everything else in this document:

- **Never claim a motion, timing, or "feel" feature is good.** You cannot feel.
  See §8.
- **Never break the scale fence in §5.** Almost every catastrophic failure mode
  in this genre is a scale problem wearing a costume.

---

## 1. The pitch

A low-poly 3D planet-exploration game set in the Cosmere. The player is a
worldhopper-scholar exploring small worlds across several star systems: walking
their surfaces in the **Physical Realm** (3D), and dipping into the **Cognitive
Realm** — a 2D, orthographic reading of the *same world*, where the realm of
ideas renders objects as glass beads, living things as flames, and meaningful
connections as lines — to see truth hidden from the physical eye and change it.
Each world's **Perpendicularity** is the gate to the next world.

**Natural reference:** *Outer Wilds* — a tiny system where every location is
built around exactly one idea.

**Anti-reference:** *No Man's Sky* — infinite scale and content volume are
explicitly out of scope. Do not imitate its crafting/grind loops.

**Also core to the pitch:** the world is dangerous but readable (health, blocky
enemies, telegraphed attacks, beacon respawns); NPCs exist and speak in text;
the player **attunes** between magic kits via a menu — and each kit rebinds the
keyboard and relabels the HUD. The Cognitive Realm's *appearance is per-world
data* — beads and flames over Roshar only; Scadrial shows the Expanse of the
Vapors; the space between systems is the **emberdark**. Lore is pinned in
`ROADMAP.md` § "Canon anchors" — treat that section as source of truth and never
contradict it or invent around it.

---

## 2. The core loop (the game IS this loop)

1. **Land** on a planet (a short canned landing moment — see §7).
2. **Explore on foot in 3D.** Walk, climb, observe. The journal fills as you
   scan things.
3. **Shift to the Cognitive Realm.** Same world, second rendering: orthographic,
   flat, diagrammatic. Objects you know become beads; the living glow; hidden
   things become visible.
4. **Solve something only solvable there** — reveal a route, unblock a passage,
   calm an entity, learn where the Perpendicularity is.
5. **Shift back.** The world has changed because of what you did.
6. **Find and open the Perpendicularity → hop to the next world.**

The realm switch is the game's core verb. It must feel instant, frequent, and
tactical — a tool you think with, not a level you visit.

**Two supporting layers:**

- **Encounters & health.** Danger comes in pockets: ≤3 enemy archetypes per
  world, ≤6 active at once, every attack telegraphed ≥0.4 s, no untelegraphed
  off-screen attacks, knockback + invuln window after hits, aggro/leash ranges so
  escape always works. At least one enemy per world cannot be fought — only
  avoided. Death = respawn at the last beacon, **no item loss**. Health is a
  consequence layer, never progression (no levels, gear tiers, damage numbers, or
  loot).
- **Attunement.** The player swaps magic kits via a menu; bindings and the HUD
  legend change with the kit. This is a **project interpretation** (canon has no
  free swapping): the worldhopper carries unkeyed Invested relics. See §4 for the
  `MagicKit` contract.

**Architectural consequence:** both realms render the *same* world state. There
is exactly one source of truth (entity positions, what is open/closed, what the
player knows). Rendering is a lens over it, never a copy of it. If you ever find
yourself maintaining two versions of the world, stop — that is the design
failing, not a bug.

---

## 3. Non-negotiable technical constraints

Hosting is **GitHub Pages** (static, no server, no websockets, no database),
deployed via **GitHub Actions**.

- Build with **Vite**. Ship what `vite build` emits. `base: './'` so the same
  build works locally, in a subfolder, and on Pages.
- Include `.nojekyll`.
- Deploy with the official Pages actions (`upload-pages-artifact` +
  `deploy-pages`). Never commit build output to the default branch.
- **No custom HTTP headers are possible on GitHub Pages.** Therefore: never
  depend on `SharedArrayBuffer`, `crossOriginIsolated`, wasm threads, or anything
  requiring COOP/COEP. Single-threaded wasm is acceptable; plain JS is preferred
  where it is cleaner.
- **No external network requests at runtime.** No CDNs, no Google Fonts, no
  analytics. Everything self-hosted in the repo. (This also keeps the game
  working offline and inside sandboxed previews.)
- Pin every dependency to an exact version. What you test is what ships.
- File names: lowercase, no spaces — Pages is case-sensitive.

---

## 4. Stack & architecture

- **One engine: Three.js (pinned exact revision).** Low-poly, flat shading,
  fog-heavy rendering. No physics engine initially — custom capsule-vs-terrain
  collision is enough for walking on heightfields and is fully testable. Add a
  physics library only if a milestone genuinely requires it, and ask first.
- **The Cognitive Realm is not a second engine.** It is the same scene viewed
  through:
  - an **orthographic camera** (top-down or high-angle) — this is what makes it
    read as "2D",
  - a **material/filter pass** that abstracts forms (beads for objects,
    flame-billboards for living things, connection lines),
  - its own palette and fog.
  Reuse the same world state, same entities, same coordinates.
- **Deterministic core.** Fixed-timestep simulation tick, seeded RNG. The seed
  must be shown in the debug overlay and be settable via URL query parameter, so
  any run is reproducible by the owner or by you.
- **Worlds are separate scenes ("maps").** Each star system — and each world
  within it — is its own scene with its own pocket-scale coordinates (§5) and its
  own seed. Load maps on demand as code-split chunks; never hold two systems in
  one coordinate space at real distances, and never simulate or render one while
  another is open. Other systems visible in the sky are a painted skybox, not
  geometry.
- **Two layers of state, kept explicit:** a small **global save** (journal,
  knowledge, unlocks, which Perpendicularities are open) that persists across
  maps, and **per-map state** that is rebuilt deterministically on load. Do not
  let per-map state leak into the global save; do not let the global save grow
  into a god-object.
- **Cross-system travel is a canned, ceremonial transition staged in the
  emberdark.** Canonically, worldhopping between systems runs through the
  Cognitive Realm (space is contracted by perception); technically, the 2D realm
  is your cheapest space to render, so the crossing doubles as the loading
  screen. Give system-to-system hops more ceremony than planet-to-planet hops.
- **`cognitiveSkin` is per-world data, never global code.** Each map declares
  what objects become (Roshar: dark glass beads; Scadrial: misty figures), what
  the living become (flames/glow), how water and land manifest (Roshar inverts:
  water → solid obsidian, land → bead sea; Scadrial: land → misty fluid, water →
  solid dark stone), and its light source (Roshar: black sky, one fixed frail
  white sun, no day/night cycle). **Beads exist only over the Rosharan system.**
- **Health & damage:** a tiny event-based system — hearts, damage cooldown,
  knockback, vignette, death → respawn at last beacon, no item loss. All numbers
  in the tuning panel.
- **Enemy framework:** box-part rigs (body/head/1–4 limbs), flat colors,
  **procedural animation only** (bob, lurch, lunge, recoil, hit-flash) — no
  skeletal rigs, no IK, no facial animation. One state machine (idle → alert →
  hunt → attack → disengage), shared by all archetypes. Every damage event must
  be preceded by its telegraph event (this is testable — do it).
- **The Inquisitor (M7) is a system, not a mob:** FOV-aware approach (prefer
  vectors outside the player's view cone; raycast line-of-sight gates), stalk at
  range, strike only with full wind-up + cue, disengage when the player turns to
  face it, and it uses Allomancy itself to reposition. "Genius" is these rules
  tuned by the owner — never a claim you make.
- **Magic kits & attunement:** one frozen `MagicKit` interface (verbs, resource,
  binding table, VFX, HUD widget, rules) + a kit registry the swap menu reads.
  The HUD rebinds and relabels per kit. Swap = near-instant + brief vulnerable
  window (tunable). Ship ONE complete kit for v1 (Radiant; 1–2 exploration
  abilities — scope locked with the owner), Allomancy arrives with Scadrial (M7).
  Include a debug kit (no powers) purely as a swap test target.
- **Dialog NPCs are data:** JSON dialogue trees (2–4 choices), text box,
  nameplate; the owner edits copy without code. No voices, no lip sync.
- Keep game logic (state, rules) separate from rendering code. Test logic
  headlessly without a browser where possible.

---

## 5. Scale fence (read §7 for why)

These numbers are load-bearing. They exist to delete entire classes of failure.
Do not exceed them without asking the owner **and** explaining what changes.

- **The fence applies per map.** Multiple star systems are fine — as *separate
  scenes*, each independently pocket-scale (§4). Two systems must never share one
  continuous coordinate space at real distances.
- Entire solar system span: **≤ ~8 km across.** Outer Wilds' system is
  pocket-sized and it enhances the game. Small numbers keep floating point
  precision perfect; you then need **no floating-origin system**.
- Planet radius: **30–80 m.** Walkable, lovable, and visible from its moon.
- Camera: near plane **≥ 0.3**, far plane **≤ ~5000**. Fog hides everything
  beyond that (see §6), which keeps the far/near ratio in a range where the depth
  buffer never shimmer-fights.
- All world coordinates stay within a few kilometers of the origin. If a feature
  proposal needs positions at 10⁶ m (planetary orbits at real scale, realistic
  moon distances), it is **out of scope** — say so and propose the pocket
  version.
- Surfaces: never place two opaque surfaces coplanar. Offset geometry (decals,
  ground markings) by ≥ 1 cm. If z-fighting appears, fix the geometry, do not
  attempt logarithmic-depth-buffer surgery unless the owner approves.

---

## 6. Art direction rules

Quality comes from **constraint and atmosphere**, not from asset volume. The
Cosmere is foggy by canon — mists, ash, storms, dark bead seas — and fog is
simultaneously your mood, your draw-distance manager, and your depth-fighting
insurance. Lean on it hard.

**Per planet:** one palette (3–5 colors), one sky gradient, one fog color/density
tuned to that palette, and **one landmark silhouette** visible from most of the
surface. That landmark is the planet's identity — spend disproportionate effort
making its silhouette great.

**Characters, creatures & NPCs — the "Minecraft or below" tier:**

- **Blocky box-mobs are allowed and intended.** Enemies are box-part rigs (body,
  head, limbs) in flat colors with procedural animation (walk bob, lurch, lunge,
  recoil). "Poorly animated" is fine — *unreadable* is not. Silhouette + tell +
  sound beat animation quality.
- **No realistic organic creatures. No skeletal rigs, no IK, no facial
  animation, no lip sync, no voices.** Anything that would need those is
  redesigned, not attempted.
- **Humanoid NPCs at Minecraft tier or below are fine** (blocky, static or
  idle-bob, nameplate, text-box dialogue). Player can be first-person or a blocky
  silhouette.
- **Ambient fauna remain spren** — glowing ribbons, motes, flames: cheap,
  canon-accurate, zero uncanny valley.
- Low-poly done intentionally = silhouette-first modeling: chunky forms, readable
  shapes, flat shading. Low-poly done lazily = beige mush. The difference is art
  direction, which is the owner's calls and your palette/fog/silhouette
  discipline.

---

## 7. The drowning list — fake, fence, or refuse

These are features that *look* fine in screenshots and tests while being broken
for a human. You are structurally blind to them (they fail only in motion, only
at scale, only at transitions). Do not implement them straight:

| Feature | Verdict | Instead |
|---|---|---|
| Seamless space→surface flight | **Refuse the seamless version.** | A canned entry: point at the planet, clouds swallow the camera, brief whiteout, you're landed. Discrete triggerable states you can test. |
| Floating-origin precision system | **Not needed if §5 is respected.** | Read §5. If you think you need it, you have broken the scale fence — fix that instead, and tell the owner. |
| Atmosphere shader as a continuous transition | **Refuse the continuous version.** | Canned entry (§ above). The *sky after landing* still gets a proper sky — that part is verifiable in a screenshot. |
| Procedural/realistic creatures; skeletal rigs; facial animation or lip sync | **Refuse.** | Blocky box-mobs at Minecraft tier or below, procedurally animated; spren for ambient fauna. Redesign anything needing rigs. |
| "Genius AI" as an open-ended goal | **Refuse the framing.** | Explicit rules: FOV-aware approach, LOS gating, telegraph-before-attack, disengage-when-faced. Assertions + owner feel test. |
| Combat progression: levels, gear tiers, damage numbers, loot | **Out of scope.** | Health is a consequence layer; encounters are seasoning. No grind, ever. |
| Guaranteed kit parity (every kit equally deep) | **Refuse the promise.** | Kits ship one at a time, each with its world; v1 has ONE complete kit. |
| Mining, crafting trees, resources, base building | **Out of scope.** | The journal and the realm mechanics are the progression. |
| More than a handful of hand-authored scenes; procedural infinite worlds | **Out of scope.** | 2–3 systems, ≤6 hand-authored scenes, one idea each. Quality per world over count. |
| Multiple systems in one continuous world at real interstellar distances | **Refuse.** | Separate pocket-scale scenes + canned travel staged in the Cognitive Realm (§4). Skybox for the other stars. |

If the owner asks for anything in this table, do not silently comply and do not
silently refuse — quote the tradeoff from this section and offer the faked
alternative.

---

## 8. Verification duties (how you are graded)

**Build this harness in M0, before any gameplay:**

- **Headless smoke test** (Playwright + Chromium) runnable from CI: load the
  built game, assert zero console errors, execute scripted input
  (keys/clicks/timers), take before/after screenshots, and assert game state via
  a debug hook exposed on `window` (e.g. `window.__debug()` returning realm,
  position, seed, entity states).
- **Debug overlay** toggled by a key: FPS, **distance of player from origin**
  (this is the scale-fence canary), current realm, seed, entity count. If
  distance-from-origin ever climbs past ~4 km, something has gone wrong — flag
  it.
- **Tuning panel** (hidden dev panel, toggled by a key): sliders for walk speed,
  jump, gravity, mouse look sensitivity, fog density, and anything feel-related
  you build — including all **combat** numbers (wind-up, damage, cooldown,
  knockback, aggro radius, enemy speed) and the attunement-swap window. **The
  owner tunes feel through sliders; they do not describe it to you in words and
  wait for a rebuild.** Persist the panel settings in the URL or localStorage so
  a tuned feel can be pasted back to you as a config value.
- **AI behavior assertions** (M3 onward): headless tests that assert
  approach-angle distribution (approaches land outside the player's view cone),
  that a telegraph event fires before every damage event, and that disengage
  triggers when the player faces the attacker. "Genius" is not testable; these
  rules are.
- **Binding snapshots** (M6 onward): every kit's binding table is
  snapshot-tested so input, HUD legend, and the attunement menu can never drift
  apart.

**Classify every deliverable.** In every progress report, mark each item as
either:

- **VERIFIED** — test name + what it asserts + screenshot attached, or
- **NEEDS HUMAN PLAYTEST** — with a checklist of at most 3 concrete questions
  (e.g. "1) Does walking feel heavy, floaty, or right? 2) Is the far landmark
  readable through fog or murky? 3) Anything that stutters when the storm wall is
  on screen?").

**Never do these:**

- Never say a motion/timing/feel feature "feels good" or "is smooth." You cannot
  know. Say "NEEDS HUMAN PLAYTEST."
- Never quote FPS numbers from your sandbox as evidence — it is a software
  renderer on 2 CPU cores. Meaningless. (Watch your own code for per-frame
  allocations and frame-loop spikes instead.)
- Never mark a milestone complete unilaterally. Propose completion with
  evidence; the owner confirms after playtesting.

---

## 9. Legal / IP guardrails

This is an **unofficial, non-commercial fan work**. The author's policy permits
non-commercial fan creations — but the ceiling is permanent:

- **No monetization of any kind, ever.** No ads, no donations, no tips, no
  paywalls, no merch, no Patreon links.
- **Original assets only.** Never copy official art, maps, or interior
  illustrations. Never reproduce book text. No official glyphs, symbols, or Aons
  used standalone (only as integral parts of original compositions, if at all).
- Include an "**unofficial fan work**" notice in the README and in the in-game
  credits.
- Prefer original interpretations ("Cosmere-shaped") over exact reproductions
  when in doubt. Keep the repo and game title free of trademarks other than a
  descriptive fandom mention.
- Keep everything public and free (GitHub Pages' own terms also forbid commercial
  use on free hosting — the two constraints agree).

---

## 10. Working agreements

- Work **one milestone at a time** from `ROADMAP.md`. Do not start milestone N+1
  until the owner has playtested and signed off N.
- Every milestone opens with a **plan comment** (a few lines: what you'll build,
  how you'll test it) and closes with a **report** (§8 format: VERIFIED / NEEDS
  HUMAN PLAYTEST).
- Maintain `DECISIONS.md`: one line per meaningful decision, with the reason. The
  owner reads this to stay oriented.
- Keep `ROADMAP.md` checkboxes updated — it is the shared source of truth for
  status.
- Touch input (phone) is required from M1 onward: a simple on-screen stick +
  look-drag is enough. The owner's phone is a first-class target, not an
  afterthought.
- When you are uncertain about a taste call (palette, fog density, which
  landmark), present **2–3 concrete options as screenshots** and let the owner
  pick. Never choose silently on a taste matter when a screenshot comparison is
  possible.

**Multi-agent rules (Phase B onward, M3+):**

- Work only from **assigned work packages** on the GitHub Issues board. One work
  package = one branch = one agent = one PR (`wp/<id>-<slug>`). Never start
  unassigned work.
- **`OWNERSHIP.md` maps files to agents.** One writer per file at a time. Never
  edit outside your lane; if your package needs a change in someone else's file,
  open an issue, tag the lane's owner, and keep moving.
- **`CONTRACTS.md` is frozen.** Shared schemas change only via a
  `contract`-labeled PR authored by Agent 1 (the integration lead), and are
  logged in `DECISIONS.md`.
- **CI is the reviewer** (the owner reads no code). A PR merges only when the
  headless suite is green *and* the PR body states how the change was verified,
  with a screenshot where the change is visible.
- Keep PRs small; merge within a day; rebase daily. A merge conflict is a
  boundary bug — escalate to Agent 1, do not brute-force the merge.
- Blocked? Label it `blocked` and switch to another ready package. Never
  idle-wait, and never invent scope to fill time.
- Questions go in issues labeled `needs:answer`; keep working. Playtest requests
  are batched to the milestone gate — at most 2 questions per agent per
  milestone.
- Parallelism multiplies throughput, never scope. The scale fence and the content
  ledger (≤6 scenes, one idea each) are unchanged by crew size.

---

## 11. Your first task — M0 only

1. Initialize the repo: Vite + pinned Three.js, `.nojekyll`, correct `base`,
   Pages deployment via Actions, a LICENSE/NOTICE with the unofficial-fan-work
   text, and a stub README.
2. Build the **blank world**: a sky gradient, a ground plane, fog tuned to the
   palette. Nothing interactive.
3. Build the harness: headless smoke test wired into CI, debug overlay, empty
   tuning panel scaffold.
4. Get it **live on GitHub Pages**, then stop and hand over with a playtest
   checklist (max 3 questions) covering: does it load on the owner's phone, does
   the fog/sky palette read as intended, and does the page work when desktop and
   phone open it simultaneously.
