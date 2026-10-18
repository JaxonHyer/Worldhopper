# Decisions

One line per meaningful decision, with the reason. Newest first. The owner reads
this to stay oriented; agents add to it in the same PR as the change.

## M3 — the owner's combat pass: giant rare Chasmfiends, white spines, a calmer punch, AI skins (Agent 1, 2026-10-17)

The owner's playtest notes on WP-3.1/3.2, reviewed with Agent 2's PR #19 (WP-3.3
archetypes + WP-3.5 fairness angle test) which this PR stacks on:

- **"Chasmfiends should be more rare... have one spawn at this Perpendicularity
  when the game loads (for testing). Chasmfiends are like a 14 or more legged
  creature and they are GIANT: they are unbelievably big."** Four changes, each
  test-guarded: spawn weights 3:1 → **9:1** (one in ten draws; `chooseType` is
  exported so the rarity is sampled over 4,000 seeded draws and asserted
  between 1% and 20%); row becomes `height 6.5, radius 3.0, legs 14` (the rig
  fans legs over 4 in rippling pairs — limb count is data, the brief's "1–4" is
  the *budget default* the owner's WP-3.3 design pass overrides); each map's
  `enemyPolicy.placements` field guarantees one at the pool `(2, −20)` at load,
  seeded deterministically outside the RNG stream; and that placement carries a
  **5 m aggro override** — it sleeps until you deliberately walk up to it, which
  is what keeps every gate-adjacent e2e test (and every fresh player who only
  wanted a swim) unjumped. Verified headlessly against the whole gate gauntlet:
  hitsTaken 0 across the timed paths.
- **"Whitespines are quadrupeds with white spines; their backs are about as
  high as the players head."** Row becomes `height 2.1` — the rig puts the back
  at `height − headSize·0.85` = 1.68 m against the player's 1.70 m eye line —
  plus a `colors.spines` plate row (`#f7f2e6`) along the back, because the
  identity is read from behind, and a slimmer `dims` override. A render test
  asserts the back sits 1.5–1.8 m and the plates are near-white.
- **"The player spins around really quick [to punch] then spins around again —
  make the spin slower so it does not feel as glitchy."** The swing-facing ease
  in `player-view.js` was rate 18 (~80 ms for a half-turn): now **7** (~180
  ms). The sim's punch still resolves instantly; this is the body catching up.
  A feel number that is deliberately NOT further tunable unless the owner
  playtests back: it's recorded here in case a slider is wanted.
- **"Using AI generated textures instead of procedurally/bash/svg generated
  ones will probably look better. Try it."** Enemies get baked creature skins:
  four AI-generated sheets (chasmfiend shell + limb, whitespine body + head),
  downscaled to 32×32, quantised to ≤16 flat colours, baked to base64 RGBA in
  `core/enemy-skins.js` and drawn as nearest-filtered DataTextures — the same
  path as pixel-art.js, so the Minecraft tier holds and boot stays
  byte-identical (CI screenshots deterministic). Original assets for this
  project, per §9. Player/NPC skins stay procedural — those were accepted
  through three owner passes (M1.5–M1.8) and are not being churned.
- **Agent 2's issue #21 (disengage-when-faced) — decided.** Implemented as a
  per-archetype `flinchWhenFaced` flag, default off, enabled ONLY on the
  Chasmfiend: on a killable enemy it would make every fight spongy on a phone
  (face it, it cancels, alert, hunts, repeat — free fight denial), and the
  roadmap binds that rule to the Inquisitor (M7), not to every mob. On the
  unkillable giant it instead gives the player the one defence that isn't a
  weapon: *stand your ground and look at it.* Event `flinch` added to the
  contract log; three unit tests pin flag-on, flag-off and the facing maths.
- **Sequencing.** #19 reviewed + approved by Agent 1 (comment posted); this PR
  edits the same `ENEMY_TYPES` rows, so it is stacked on #19's branch tip and
  must merge AFTER #19 merges. Agent 2's two tests that asserted the old
  numbers (14-legs row, opening-cast size) are amended with comments pointing
  here, per the owner's design change after review.

## M3 — WP-3.1 + WP-3.2: the world fights back, and the fairness contract is a test (Agent 1, 2026-10-17)

The owner's ask was three sentences: *"enemies and a procedural roaming enemy
spawner. Also the player should have a attack button that does a punch attack."*
Enemies that cannot hurt you are scenery, so WP-3.1 (health) came with WP-3.2
(the enemy framework) rather than after it — and both are Agent 1's lane.

- **Enemies are actors, not furniture — `state.enemies`, not `state.entities`.**
  This is the decision that shaped the whole package. `state.entities` is the
  map's authored list, and `entityHash()` is its reproducibility fingerprint:
  three existing tests assert that hash does not move across a realm shift, and
  two more count entities against the cognitive realm's bead-and-flame tally
  (`souls + npcFlames === entityCount`). A runtime actor that comes and goes
  would break all five. The player has never been an entity, for the same
  reason; enemies follow the player rather than the rocks. Recorded in
  `CONTRACTS.md` §1 and `OWNERSHIP.md` so the next agent does not "fix" it.
- **The spawner's RNG is one uint32 in world state, not a closure.**
  `createRng()` returns a closure, and world state is asserted
  `JSON.stringify`-equal across a realm shift — so a live RNG object in state is
  either unserialisable or a `{}` that silently resets and re-rolls the same
  pack forever. `rngStep(state)` is the pure form and `createRng` is now built on
  it, so both produce the identical stream from one implementation.
- **"Procedural roaming" means two things, both seeded:** *where* an enemy
  appears (a ring 24–40 m around the player, never in the pool, never inside a
  rock, never on an NPC) and *what it does until it notices you* (a procedural
  wander around its own home). Plus a despawn ring at 95 m, so a long walk
  neither empties the world nor accumulates every enemy it ever made. Same seed
  plus same inputs gives the same encounter, asserted.
- **One state machine, and an archetype is a row.** `idle → alert → hunt →
  attack → disengage` exactly as the roadmap lists it, in `src/core/enemy.js`.
  WP-3.3 adds archetypes by adding data to `ENEMY_TYPES`, not by writing a
  second machine. That is what makes Agent 2's lane a one-line PR.
- **The fairness contract is enforced twice: once in the code, once in a test.**
  `resolveWindup()` applies the 0.4 s floor *after* the owner's slider and the
  archetype's own scale, so no combination of the two can produce an unfair
  game. And a unit test simulates 75 s of a player wandering a populated world
  and asserts that **every damage event has that source's telegraph before it**.
  A rule nobody checks is a comment.
- **`alert` is an event, and that is the honest version of fairness rule 2.** The
  roadmap's "no untelegraphed attack from outside the player's view" wants an
  audio cue, and audio is M8. What ships instead: an enemy always emits `alert`
  before it can wind up, an aggro mark draws over its head, and a test asserts
  `alert.tick <= telegraph.tick`. The FOV-aware variant stays M7. Stated rather
  than quietly upgraded.
- **The punch is generous on purpose: 2.4 m and a ~98° arc.** On a phone the
  player aims with a thumb and a stick, and a swing that needs pixel-accurate
  facing reads as broken rather than as demanding. The avatar also turns to face
  the camera's yaw while swinging — without that the body punches the last
  direction it walked while the hit resolves against where you are looking.
- **Beacons heal on arrival, not continuously.** The first version topped you up
  while you stood there, which made the spawn point an invulnerability field and
  made the death test unwinnable. A shrine you cannot be hurt next to is not a
  checkpoint.
- **Death is a frame-loop beat, not a sim timer.** A respawn is covered by a
  fade, and a fade holds the sim still — so a sim-driven timer could never reach
  zero inside its own fade. The Perpendicularity's realm shift already worked
  this way; death now does too, and `respawnPlayer()` is exported so it is still
  unit-testable.
- **Combat numbers are sliders, and two of them have floors the panel cannot
  cross.** `Enemy wind-up` cannot go below 0.4 s and `Enemies alive at once`
  cannot go above 6, because those are the contract's numbers, not taste. A
  slider that could break them would let the owner build an unfair game by
  accident. `?enemies=0` turns encounters off.
- **Q/E held-key look was dead code, and CI found it.** `input.look()` has read
  `keys` for KeyQ/KeyE since early on, but `onKeyDown` never registered them, so
  holding Q turned nothing and no one noticed — desktop look has always been the
  mouse, and nothing advertised the keys. My punch e2e relied on them to aim and
  the player died waiting for a turn that could never come. `onKeyDown` now
  registers them, and the e2e test asserts the door works before walking through
  it.
- **`combat` is a top-level snapshot key, not a corner of `ui`.** `ui` is a
  whitelist and a field added there without a matching line in
  `src/core/snapshot.js` disappears without a sound — that trap has already cost
  two CI runs. `combat.roster` (who is where) exists so a test can walk up to a
  *specific* enemy instead of hoping one wanders past.

**Project interpretation, flagged as the roadmap requires:** `crag-lurker` and
`storm-warden` are invented names and invented silhouettes. Roshar's real
creatures are WP-3.3, which the owner designs; these two exist so the framework
has something honest to run on and so the contract has a testable subject. The
warden's `fightable: false` is the anglerfish rule the brief demands — at least
one thing per world cannot be fought, only avoided — and it hunts at 2.6 m/s
against a 7.9 m/s walk, so the answer to it is always your feet.

**Not done, deliberately:** the FOV-aware approach rules and
disengage-when-faced (M7's Inquisitor, and the real content of WP-3.5); audio
tells (M8); damage numbers, loot and levels (refused permanently by the scope
fence); and any claim that the encounter *feels* fair, which is the owner's
playtest and not an agent's to make.

## M3 — WP-3.4 lands as one implementation (Agent 1, 2026-10-17)

- **One NPC system, not two.** Two agents built WP-3.4 in parallel (PR #13, an
  unfinished content/UI slice, and PR #15, the complete framework). This PR
  carries PR #15's implementation — its seams are the ones the contract asked
  for — and both old PRs are closed as superseded. Two dialogue systems cannot
  ship; the second one is deleted rather than merged behind a flag.
- **The spawn field is `npcId`.** The #12 sketch said `dialogueId`; the shipped
  entity calls the *dialogue file* `npcId` (`{ id, kind: 'npc', npcId, name,
  title, palette, position, rotationY, interactRadius, static }`). Frozen here so
  the next consumer does not guess.
- **A dialog pauses the sim.** I had proposed "keep the clock running, zero the
  movement input"; the shipped rule is a full pause (`steps = 0` while the card
  is open). Accepted because WP-3.2 adds enemies: a conversation that lets the
  world move can kill a player mid-sentence. The fixed-step clock is not
  advanced or banked, so nothing drifts when the card closes.
- **The Talk prompt moves up on a phone.** At the desktop position (centred,
  80 px off the bottom) it overlapped the jump button's corner on a 412 px
  screen — the owner's first playtest question, answered in CSS before asking:
  below 640 px the prompt sits 196 px up and drops the "F on desktop" hint,
  which a phone cannot use. Pinned by a bounding-box test in `npc.spec.js`.
- **Process, so it does not repeat:** WP-3.4 edited `src/core/`, `src/render/`,
  `src/main.js` and `src/ui/` — Agent 1's files — while #12 was still open. The
  work was accepted and integrated rather than redone, but the next cross-lane
  change should wait for the handoff or arrive as an agreed change. Parallel
  edits to `main.js` are how an all-green gate becomes a coin flip.

## M3 — WP-3.4 NPC dialog framework (Agent 2, 2026-10-16)


- **NPCs are entities in world state, not renderer-only objects.** The roadmap
  says "one source of truth" — an NPC has kind `npc`, a stable id, a position,
  a rotation and an `interactRadius` placed from the map's `npcs` list by
  `placeNpcs()` in core/world-state.js. Adding them to the entity list means
  determinism (seeded runs), entity-hash integrity and the cognitive-realm
  manifestation (they are living → they draw as flames on Roshar) all come
  from the same code path that already handles rocks and landmarks.
- **Dialogue lives in JSON, one file per NPC, statically imported.** Static
  hosting forbids runtime fetches; Vite inlines `*.json?with { type: 'json' }`
  imports at build time so no extra request is made. Files go in
  `src/content/npcs/<id>.json`; `validateDialogue()` runs as a unit test so a
  typo in the copy (a missing node, >4 choices, an unreachable branch) fails
  the build instead of leaving a dead button in the UI.
- **NPCs are not collision obstacles.** You walk *up to* an NPC to talk, not
  around them. Adding them to `buildObstacles()` would make the talk radius
  end before you could reach the figure, and the roadmap does not require
  NPCs to block movement. The player capsule can step within ~0.35 m and the
  default `interactRadius` is 3 m, so there is room to stand beside them.
- **The interact affordance is a single DOM button at the bottom of the
  screen, visible only when an NPC is within range.** Tapping it (phone) or
  pressing <kbd>F</kbd> (desktop) opens the dialog. The same button serves
  both devices — one tap target, no keyboard-only mechanic. While the dialog
  is open the sim is paused (same as during a realm fade), so the player
  cannot walk off a cliff while reading.
- **Two NPCs ship with WP-3.4: "Kurin" (a Horneater guide) on Roshar at
  (-5, -8), and a "Wanderer" on the blank-basin test range at (4.5, -8).**
  Kurin's name is a project invention (no canon Horneater character is
  claimed); both dialogues flag the test range as placeholder and Roshar as
  the peaks above the pool, consistent with the design page. The budget is
  ≤2 per map (ROADMAP), which is exactly what is shipped.
- **NPC figures share the player's box-and-pixel rig** (same ten boxes, same
  8×8 head, same `characterSkin()` art function) but with their own palette
  from the JSON file. Reusing the art pipeline means the same unit tests
  that police the player's pixels (opaque, in-palette, exactly two eyes)
  apply unchanged, and no new geometry is invented. Short hair + custom
  clothes is deliberate — we did not add a second body, only recolour the
  existing one.
- **Nameplates are CanvasTexture sprites** (a name over the head, billboarded
  by three.js SpriteMaterial) rather than geometry. Cheap (one small canvas
  per NPC — ≤2 per map), always-readable, and invisible behind the dialog
  box. They are skipped when `document` is absent so the headless scene-graph
  unit tests keep running under Node.
- **ESLint's ecmaVersion is raised to 2025** to parse JSON import attributes
  (`with { type: 'json' }`), which Node 22 and Vite 7 both support natively.
  Without the attribute Node's ESM loader refuses the import; without
  raising ecmaVersion ESLint refuses to parse it.
- **`dialog` is its own top-level snapshot key**, not nested under `ui`. The
  `ui` block is a whitelist (a trap that already cost two CI runs when
  `fade`/`fades` were added to one side and not the other), so giving
  dialog its own line in SNAPSHOT_KEYS makes the key-set test police it the
  same way it polices every other field.

## M0 — foundation (2026-10-14)

- **Vite 7.3.7 + three.js 0.186.1, both pinned exactly, in `package.json` and
  `package-lock.json`.** What is tested is what ships; no caret ranges.
- **Plain JavaScript with JSDoc types, no TypeScript build step.** The engine is
  the only dependency worth a compile step; types buy little here and cost a
  second build pipeline the owner would have to trust.
- **`base: './'` in Vite.** One build has to work from a subfolder, from
  `file://`-adjacent local serving and from Pages without configuration.
- **`.nojekyll` lives in `public/`.** It then ships automatically inside `dist/`
  and `scripts/check-dist.mjs` fails the build if it ever goes missing.
- **CI (`.github/workflows/ci.yml`) runs on every branch and PR; Pages
  (`.github/workflows/pages.yml`) only deploys from `main`.** CI is the reviewer
  (§10): green suite, then merge.
- **GitHub actions pinned to exact release tags (`@v7.0.1`, not `@v7`).** Same
  reasoning as dependencies; readable for a non-coder owner, unlike SHA pinning.
- **Screenshots are CI artifacts, not committed files.** Keeps the repo small and
  guarantees every screenshot comes from the build that actually ran.
- **The M0 world is a non-canonical "M0 Test Range" (`blank-basin`).**
  `ROADMAP.md` has no Canon anchors section yet, so nothing here invents lore;
  the placeholder is labelled `status: 'placeholder'` and asserted as such by
  tests.
- **`cognitiveSkin` exists as per-map data from day one, with `unassigned`
  values.** Freezing the shape early avoids smuggling realm appearance into
  global code later; `tests/unit/maps.test.js` fails any map that asks for glass
  beads outside the Rosharan system.
- **Three palette variants (`ashen-basin`, `mist-sea`, `cold-ridge`) instead of
  one.** A palette is a taste call: the owner picks from live variants on their
  own hardware rather than from a description (§10).
- **The blank world has one landmark silhouette (the Grey Needle) and seeded
  low-poly rock scatter.** Art direction needs something for fog to fall off;
  "landmark readable through fog" is one of the three playtest questions.
- **Fog is `FogExp2`, density 0.003 default, palette horizon colour == fog
  colour.** A mismatched horizon seams, which looks like a bug at any distance.
- **Sky is a camera-following dome with a custom ShaderMaterial and a sun disc,
  rendered with `depthTest: false` and `renderOrder: -1`.** Cheapest way to get a
  per-world gradient plus a light-direction cue; the dome radius (2000 m) stays
  inside the camera far plane.
- **Sub-LSB dither in the sky shader.** Dark gradient skies band badly on 8-bit
  displays; one line of noise removes it.
- **Ground is one displaced plane, converted to non-indexed geometry with
  per-triangle flat colours.** Intentional low-poly faceting (§6) with an
  ordinary `MeshLambertMaterial` — no custom shading, nothing to break.
- **No shadows in M0.** Nothing casts them yet; shadow cameras over a 2.4 km
  plane cost more than they explain. Revisit when the player exists (M1).
- **Custom capsule-vs-heightfield collision planned for M1; no physics engine.**
  Fully testable headlessly and it respects the scale fence.
- **Fixed 60 Hz sim tick with a 5-step spiral-of-death guard that drops (and
  counts) backlog.** Reproducible runs from a seed, and a slow device simulates
  slower instead of faster.
- **Seeded mulberry32 + integer-only value noise, no transcendentals in world
  generation.** `Math.sin`/`pow` are not bit-identical across engines; the world
  must rebuild identically on the owner's phone.
- **Seeds can be words (`?seed=emberdark`) or numbers.** Makes a seed something
  the owner can say out loud and paste back.
- **One settings schema drives the tuning panel, the URL and localStorage.**
  Three consumers, one definition — the panel can never drift from the URL.
- **`?debug=1` and `?dev=1` are separate flags.** `dev` shows on-screen dev
  buttons (phone has no backquote key); `debug` opens the overlay. Forcing the
  overlay on for every dev visit would spoil screenshots.
- **Later-milestone sliders (walk, jump, gravity, swap window) render disabled
  from M0.** The panel's shape is visible before the features exist; nothing can
  silently do nothing.
- **The dev observer camera exists in M0, look-only (no translation).** It is the
  scripted-input target the smoke test drives and the touch-look path M1 reuses;
  the M1 player controller replaces it.
- **`window.__debug()` + `window.__worldhopper` are the test contract**, and
  `document.documentElement.dataset.ready = 'true'` after two rendered frames.
  The smoke test waits on that instead of sleeping.
- **The debug overlay refreshes at 4 Hz.** A DOM write per frame would itself be
  a frame-loop cost, which the overlay exists to detect.
- **`entityHash` in the debug snapshot.** Proves a seeded rebuild is identical
  without pixel-diffing screenshots.
- **Logic never imports three.js** (`src/core/**`), and the renderer never owns
  state (`src/render/**` reads it). This is what lets the sim be tested in Node
  with no browser (§4).
- **The tiny boot note ("loading the basin…") is hidden by CSS when the game
  marks itself ready.** No spinner framework for one line of text.
- **Runtime errors surface as an on-page banner.** The owner cannot read a
  console; a broken build should say so in plain words on screen.
- **An original SVG favicon is shipped in `public/`.** Browsers request
  `/favicon.svg`; a 404 shows up as a console error and would falsely fail the
  "zero console errors" gate.
- **`NOTICE.md` carries the fan-work text, `LICENSE` is MIT for original work
  only, and the same notice appears in the in-game credits.** §9 requires it in
  both README and credits; both are asserted by the smoke test.

## M0 — follow-up: the debug snapshot is a shared, tested contract (2026-10-14)

- **`src/core/snapshot.js` owns the snapshot shape** (`buildSnapshot`,
  `SNAPSHOT_KEYS`). It was inlined in `main.js` and the debug overlay read two
  fields the snapshot no longer produced (`gl`, `scaleFence`), which threw inside
  the render loop on the first frame — a blank page that no headless probe could
  see, because the crash was in the browser. One builder, one key list.
- **A unit test pushes a real snapshot through the real overlay against a 20-line
  DOM stub.** A missing field now fails locally in milliseconds, not in CI. This
  is the cheap half of "assert game state via a debug hook" (§8).
- **`gl` info is read once, at renderer construction.** It is displayed by the
  overlay every refresh; `gl.getParameter` has no business in a frame loop.
- **CI publishes its own evidence to a rolling `ci-artifacts` branch**
  (`scripts/ci-report.mjs` + a `git push --force` of the Playwright JSON summary
  and the screenshots). Reason: the agent's sandbox can read the repository but
  *not* Actions logs and artifacts, so a red build was previously just the word
  "failed". The branch is ignored by the CI trigger to avoid a loop, and it is
  not the default branch, so no build output is committed to `main` (§3).
- **`[hidden] { display: none !important; }` is a global rule.** `.credits`
  (`display: grid`) and `.dock__dev` (`display: flex`) overrode the UA rule for
  `hidden`, so the credits overlay stayed on screen — full-viewport, swallowing
  every pointer event — and the phone dev buttons showed without `?dev=1`. State
  assertions said "hidden"; the screen said otherwise, which is why the smoke
  test now also asserts visibility of each panel.
- **Global key handlers ignore events aimed at form controls.** The arrow keys
  drove the camera *and* got `preventDefault()`ed, so a focused tuning slider
  never received them.
- **Input counters (`window.__worldhopper.input()`) are part of the debug
  surface.** A dead drag now reports which stage failed — pointerdown never
  landed, moves never arrived, or events arrived with zero deltas.
- **Lights are tuned for readable mid-tones, not physical plausibility.** three
  multiplies Lambert diffuse by 1/π, so sun 1.15 / ambient 0.6 rendered the
  ground nearly black even though every value was "sensible". Defaults are now
  sun 2.4 / ambient 1.3 with the sun lifted off the horizon — a starting point
  the owner can move with the sliders in one second.
- **Per-variant `sun.intensity` was removed.** Sun and ambient strength are the
  owner's sliders; a second source of truth would have fought the panel.
- **The landmark moved from 640 m to 430 m and fog thinned to 0.0021 (variant A).**
  At 0.003 the needle was 97% fog by the time it reached the camera: the map's
  identity was invisible. Screenshot check (world-ashen-basin) now shows a
  readable silhouette against the haze; the *taste* of how much haze stays the
  owner's call via the fog slider and the three variants.
- **Sun disc is crisper and the halo tighter (`pow(sd, 900) * 0.45`).** The old
  wide bloom read as a lens smudge rather than a light source you can orient by
  — and light direction is the only orientation cue in a fog-heavy frame.
- **Sky gradient band exponent 0.68 (was 0.55).** More gradient across the dome
  makes the horizon read as a horizon, not a flat wash.
- **The sun was moved to the player's right-rear, and the terrain given real
  relief (±7 m at 0.006 frequency, was ±2.6 m at 0.0035).** With the light in
  front of the opening view, every form rendered as a black slab and the ground
  was a table: fog had nothing to roll over and the needle had no lit facets.
  Side-lighting is what makes a flat-shaded low-poly silhouette read at all.
- **The ground colour ramp window is derived from the map's terrain amplitude.**
  It was a hard-coded 3.2 m window inherited from the first (much flatter)
  terrain, so every facet sampled the same end of the ramp and the palette
  variation vanished. Same class of bug as the drifting e2e default: a copied
  constant instead of a derived one.
- **Ground plane 1600 m / 144 segments (~11 m facets) instead of 2400 m / 96
  (~25 m).** At eye height, 25 m triangles read as abstract slabs, not terrain.
  The resolution cap and a new "facets must be ≤ 12 m" rule live in
  `src/core/config.js` and are asserted per map, so the next map cannot quietly
  regress into slabs.
- **Below-horizon sky colour (`sky.haze`) must equal the fog colour.** The ground
  plane has a far edge; matching the backdrop to the fog lets that edge dissolve
  instead of ending on a seam, whatever density the owner picks. Asserted in
  `tests/unit/maps.test.js` alongside the existing horizon rule.
- **Sliders persist on release, not during the drag.** `input` updates the world
  live (quiet), `change` writes localStorage + the URL. Replacing the URL on
  every pixel would churn history, and *rebuilding* it dropped the `?debug`/`?dev`
  flags the session started with — those are now always re-added.
- **The seed row shows nothing in the value column** (the number is in the field
  itself), instead of rendering an empty-backed `NaN`.
- **No control may print `NaN`.** The palette row's readout ran an enum through
  the numeric formatter; `formatSettingValue` now handles enums and empty values
  and is asserted for every setting in the schema.
- **Ground colouring moved to `src/core/terrain-color.js` as pure, tested maths.**
  The first version hashed *quantised* world coordinates, so its noise repeated
  on a grid aligned with the mesh, and a hard accent threshold turned that grid
  into seams you could see in a screenshot. Colour now comes from a smooth
  world-space field (fbm, ~50 m patches) plus ±4.5% per-facet jitter indexed by
  facet — never by position — with a soft accent threshold. Tests assert
  determinism, palette containment, ramp direction, neighbour smoothness, jitter
  spread and NaN-immunity, because this is exactly the class of bug that only
  shows up in an image.

## M1 — the player (2026-10-14)

- **Collision is a vertical capsule against the heightfield plus cylinder
  obstacles — still no physics engine.** Six ring samples under the capsule find
  the ground; rocks and the landmark plinth become cylinders derived from the
  same entities the renderer draws, so a rock can never be visible in one place
  and solid in another. Every rule is asserted in `tests/unit/player.test.js`.
- **`src/core/terrain.js` split out of `world-state.js`** so the player sim can
  sample terrain without importing the whole world (and without an import cycle).
- **Jump height is the slider, gravity is the spring rate:** jump velocity is
  `sqrt(2 * gravity * jumpHeight)`, so the owner can make gravity floaty without
  changing how high the player jumps. Verified to ±8% for 0.8/1.5/3 m.
- **Coyote time (0.12 s) and a jump buffer (0.15 s).** Two small graces that stop
  a jump press near an edge from being silently dropped; both are unit-tested.
- **The sim normalises movement input itself.** A caller passing (1,1) used to
  walk 1.41x faster; diagonals are now unit-length in `stepPlayer`, not just in
  the keyboard path.
- **Touch is the primary input path, and the stick appears where the thumb
  lands.** Left 45% is the movement zone, right 55% is look-drag, and the jump
  button is a real DOM button (88 px) so it is reachable and testable. Desktop
  keeps W/A/S/D + space + drag-look; both produce the same intent object, so the
  simulation never knows which is in use.
- **Arrow keys now walk instead of looking.** Arrows are movement keys on every
  device the owner uses; looking is a drag, or Q/E for keyboard-only sessions.
- **Touch controls are enabled by `navigator.maxTouchPoints`, `(pointer: coarse)`
  or `(hover: none)`, and also switch on the first touch that arrives.** A
  hybrid laptop that gets touched starts showing the stick immediately.
- **On touch hardware the dev dock moves to the top-right**, out of the way of
  the thumb and the jump button.
- **View bob is a slider (default 0.035 m) and freezes at 0 in the air.** It is
  the only camera motion in M1, so it is the easiest thing to switch off if it
  turns out to bother the owner.
- **The camera is derived, never stored:** `eye = feet + eyeHeight + bob`. The
  sky follows the player's feet so the bob cannot make the skyline jitter.
- **The headless tests drive sim time directly (`window.__worldhopper.step(seconds)`)
  instead of sleeping.** CI's software renderer runs at ~6 fps, where the
  fixed-step clock can only simulate ~50% of wall-clock time, so seven M1 tests
  failed on *speed* rather than on logic. Real input events, deterministic time:
  input still comes from real key presses and real touch events, then the sim is
  advanced by hand. The frame loop can be frozen with `pause(true)` for screenshots.
- **`clockTime` is in the snapshot, and `simTime <= clockTime` is asserted.** The
  sim is allowed to fall behind the clock (long frames are clamped by design),
  never to run ahead of it — that invariant is the real guarantee, and it is now
  tested instead of assumed.
- **The debug overlay shows the player and the input mode**, not just the camera;
  "which mode does the game think I'm in" is otherwise invisible.
- **`step()` records its time in the fixed-step clock, and the e2e suite freezes
  the frame loop (`pause(true)`) wherever input→time must be exact.** Two flakes
  came from the same root cause: the frame loop was still simulating between two
  `evaluate()` calls, so a "camera follows the player" comparison drifted 2 cm
  and a tapped jump had already been consumed-and-landed before the assertion
  ran. With the loop frozen, real input events still arrive; only time is under
  the test's control. The clock-invariant test deliberately stays unfrozen,
  because the frame loop is exactly what it is testing.
- **Two e2e expectations were wrong, not the game:** releasing a movement key
  does not stop the player dead (the acceleration slider decides), and a jump is
  the *same height* under any gravity because gravity is used as the spring rate
  — so the test now asserts the apex, and that heavier gravity shortens the
  flight instead of lowering the jump.
- **The HUD is built before the input layer, and input receives its elements
  explicitly.** `createInput` used to query the DOM for `.touch-jump` and the
  stick, and it ran before the HUD existed — so on a real phone the jump button
  did nothing at all and the stick ring never appeared. The headless test caught
  the dead button; the new visibility assertion catches the missing ring.
- **Desktop look is standard mouse capture (Pointer Lock); touch is untouched.**
  Click the world to capture, the camera then follows mouse movement with no
  button held, Esc releases it. A crosshair appears while captured (the system
  cursor is hidden, so nothing else says which way is forward) and the hint line
  says how to release. This is what "desktop controls" means to a player.
- **Capture is a small explicit state machine** (`unsupported → unlocked →
  pending → locked | denied`) exposed through `window.__worldhopper.capture()`.
  A browser or an embedded frame can refuse the lock, so the state is *reported*
  rather than assumed: the overlay and the tests can both see it.
- **Drag-to-look stays live as the fallback.** It is what a finger uses, and it
  is what a mouse uses when the lock is refused (an iframe without the
  `pointer-lock` permission, for instance). A browser permission must never be
  the difference between playable and not.
- **Two sensitivity sliders instead of one:** *Look sensitivity (drag)* and
  *Mouse look (captured)*. They are different devices — a finger travels across
  the glass and a captured mouse reports raw movement — so they get different
  base factors (0.0042 and 0.0026 rad/px) and can be tuned apart. Sensitivity is
  applied by the input layer, which is the only place that knows which device a
  delta came from; the sim just clamps and wraps.
- **Opening the tuning panel or the credits releases the mouse.** A captured
  cursor cannot click a slider, so the panel hands it back (and the tests assert
  the slider can be focused immediately afterwards).
- **Raw mouse input where the browser supports it** (`requestPointerLock({
  unadjustedMovement: true })`), falling back to a plain request, so the camera
  does not inherit the operating system's pointer acceleration when the browser
  can avoid it.
- **Capture is a preference, not a rule** (`?capture=off`, or the *Mouse
  capture* control in the panel). Some players hate having their cursor taken;
  dragging is a perfectly good way to look, and the switch makes the fallback
  path testable in a browser that *does* support pointer lock.
- **A refusal is only believed after a grace period** (250 ms). Requesting raw
  mouse input and falling back to a plain request produces two failure signals
  for one outcome, and neither says which attempt it belonged to; a lock that
  lands later cancels the pending refusal, so `capture()` never reports "denied"
  for a mouse that is captured.
- **Raw movement is preferred, cursor movement is the substitute.** A locked
  pointer normally reports movement deltas and freezes the cursor position; a
  browser or driver that reports neither would silently freeze the camera, so a
  zero-delta event with a moved cursor is used instead. Real browsers keep the
  raw path (deltas are non-zero), so this only ever replaces a dead camera.
- **The tuning panel and the credits release the mouse when they open** — a
  captured cursor cannot click a slider — and the tests assert the control is
  focusable straight afterwards.

## M1.5 — third person, and the blocky look (owner, 2026-10-15)

- **The game is third person.** The camera is a boom behind the character,
  derived from the player every frame (`src/core/camera.js`), never a second copy
  of the world. First person stays available as `?view=first` / the **Camera**
  control, because it costs nothing to keep and some places will want it.
- **The camera gives way, never clips.** The boom is marched outward and stops
  at the first sample that would be inside the ground or a rock, and a final
  guard lifts it above the terrain wherever it lands. It re-aims at the player
  after that lift, so the character stays centred.
- **Third person narrows the vertical look range** (`-1.1 … +0.6 rad`): looking
  straight up would swing the boom down through the floor. The sim owns that
  rule, not the renderer — the camera can never be the thing that decides how
  far you may look.
- **A very short boom hides the body** (below 1.0 m): otherwise the camera sits
  inside the character's head, which looks like a rendering fault.
- **The walk cycle is the sim's, the bob is the camera's.** `stridePhase`
  advances whenever the player walks, whatever the view-bob slider says, because
  the avatar's limbs are driven by it. View bob only moves the camera.
  (Zero-bob playtesters should still see their character walk.)
- **Characters are blocky — boxes, flat colours, no rigs.** Player now;
  enemies at M3 and NPCs at M5 follow the same recipe (`src/render/player-view.js`
  is the reference implementation: a handful of `BoxGeometry` meshes, pivots at
  shoulders and hips, animation by rotating boxes). §7 rules out skeletons and
  IK; a box per limb is both the style *and* the simplest thing that can be
  tested.
- **The owner's playtested numbers are the defaults** (seed, palette, fog, sun,
  ambient, fov, both look sensitivities, walk, jump, gravity, accel, bob), pinned
  by a unit test so a later edit cannot quietly reset the feel they approved.

## M1.6 — the animation cap, the pixel skins, generic clothes (owner, 2026-10-15)

- **The stride rate is capped, and speed widens the swing instead.** At the
  owner's 7.9 m/s over a 1.6 m stride, an uncapped walk cycle swings the legs
  4.9 times a second — "too quick / jittery" (their words). The cap is a live
  slider (`Animation speed cap`, 2 cycles/second by default, `?striderate=`);
  past the speed where it bites (strideLength × cap ≈ 3.2 m/s) extra speed goes
  into how *far* the limbs swing, not how fast. The sim owns both numbers, so
  the rule is unit-tested rather than eyeballed.
- **Easing is per second, not per frame.** The avatar's pose blending used a
  per-frame factor, which meant a 120 Hz phone animated its arms faster than a
  60 Hz one. It is `1 - exp(-rate·dt)` now, and a test walks both frame rates to
  the same pose.
- **Characters are textured with real pixels, not a filter.** New
  `src/core/pixel-art.js` authors the skin as data (8×8 face, 8×12 shirt, 4×12
  limbs), and the renderer turns it into `DataTexture`s with
  `NearestFilter` magnification and mipmapped minification — hard-edged pixels
  up close, no shimmer at distance. The art is data so a unit test can assert
  "exactly two eyes, in the upper half", "the trousers have a belt row", or
  "no pixel outside the palette"; a typo in the art fails the build instead of
  appearing as a magenta square on the owner's phone.
- **Textures are stored bottom-up**, so nothing depends on `flipY` — an
  upside-down face is a bug that only shows up on someone else's device.
- **The head is the only thing textured per face** (one face, hair on the other
  five); sleeves, legs and boots read fine with one texture on every face
  because their patterns are horizontal bands. A face on the back of the head is
  the classic give-away.
- **Generic clothes, by request.** The M1.5 "field scholar" (coat trim, back
  pack, belt box) is gone: a plain shirt, plain trousers, boots, and the detail
  that remains is in the texture (collar, buttons, hem, belt, cuffs, sole).
  Ten boxes instead of seventeen.

## M1.7 — the face, the girl, sprint (owner, 2026-10-15)

- **The character turns to face the way it walks.** The camera is a boom behind
  the player, so the face the owner asked for was never on screen: "because of
  camera position I cannot see the face". The body now yaws towards its
  direction of travel (`atan2(-vx, -vz)`), it keeps its facing when standing
  still (no snapping back), and the turn eases at 14/s so a strafe is a turn,
  not a flick. The pure function is exported (`nextFacing`) and unit-tested for
  direction, frame-rate independence and NaN.
- **The face is Minecraft-style, drawn in the 8×8 head texture**: fringe, two
  eyes (white + pupil, mirrored), a nose, a mouth, jaw, hair on the other five
  faces. Pixel positions are asserted by name, because "the eyes are one pixel
  too far out" is invisible in code and obvious on a phone.
- **One boolean, one girl.** The alternate character is
  `settings.girlPlayer` (`?girl=1`, **Girl player character** in the panel, and
  `girl`/`boy` are accepted spellings). The boy is the default, so nothing
  changes for a saved config. She is the *same* geometry with slimmer arms,
  long hair (two extra boxes, two extra textures) and her own palette — the
  trousers, boots, skin and face pixels are shared, so the two read as one game.
- **Sprint is a speed multiplier with the animation cap intact.**
  `settings.sprint` (1–3, default 2.2 since the owner set it) multiplies the
  *walk speed* only while
  there is movement input — holding shift standing still is not a sprint. The
  M1.6 stride cap still applies, so a sprint widens the swing instead of
  blurring it (this is why sprint was not implemented as "walk faster").
- **Sprint input is per device, as asked.** Desktop *holds* shift (either
  shift, never `preventDefault`ed so browser shortcuts still work); the phone
  gets a **toggle** button at the bottom-left, because the thumb that would hold
  it is the thumb on the stick. The button is only shown for coarse pointers,
  and a hidden toggle is forced off so nothing sprints invisibly.
- **The panel grew a checkbox** for the new `bool` settings kind — the first
  boolean is the girl, and switches must be switches, not sliders.

## M1.8 — hair as texture, sprint at 2.20 (owner, 2026-10-15)

- **The girl's long hair is painted, not modelled.** The owner: "the girl's hair
  looks weird, make it a texture only thing. Not actual 3d hair." The four hair
  boxes (back sheet, fall, two face-framing locks) are gone. The hair now lives
  in the textures she already had: down both sides of her head front, over the
  whole side of the head, round the back, and over the shoulders and upper back
  of her shirt with a ragged edge. Her skin is back to **fourteen textures, the
  same set as the boy's**, and **ten boxes, the same count as the boy's** — the
  only thing the renderer does differently for her is a narrower pair of arms.
  Two tests hold that line: the texture *names* must match, and the box and
  texture counts must be identical after a live swap.
- **Sprint default is 2.20×** (was 1.5). The owner's number, and the sim is
  what makes it safe: the stride rate is still capped, so a 2.2× sprint widens
  the swing instead of blurring it, and the multiplier is applied to the walk
  speed only while there is movement input.
- **A NaN multiplier can no longer poison the player.** A setting can arrive
  from a hand-typed URL, and `Math.max(1, NaN)` is `NaN` — a NaN speed is a
  NaN position, which never recovers. Both the sprint multiplier and the stride
  rate now fall back to their defaults when they are not finite numbers, and a
  unit test sprints with `sprint: NaN` and asserts the player still moves
  sanely.
- **Boxes are named** (`girl-left-arm`, `boy-head`, …). The girl-differs test
  needs to ask the *body* how wide its arms are; counting children and guessing
  which box is an arm is the kind of test that passes for the wrong reason.

## M2 — the Cognitive Realm (owner, 2026-10-15: "Now M2 I think. Right?")

- **The realm is a lens, never a second world.** `state.realm` is a two-value
  flag and the sim never reads it: switching realms cannot move an entity,
  change the tick, or perturb the player's walk. Two tests hold that line — a
  unit test simulates the same seed in both realms to the same entity hash, and
  the browser test checks tick, entity hash and player position across a shift.
  This is the architecture rule from §2 turned into a test instead of a promise.
- **Orthographic, high-angle, and the pitch is fixed.** The lens is the same
  scene through an `OrthographicCamera`: the yaw follows the player (so the map
  reads the same way you are walking), the look pitch is deliberately ignored
  (a diagram you can tilt is not a diagram), and the visible height is a setting
  (`Cognitive lens height (m)`, `?realmzoom=`, 16–140 m, default 46). Both
  cameras live in the renderer and the frame loop drives whichever is active, so
  there is one scene, one set of coordinates, one source of truth.
- **One key, one button — and no gesture.** <kbd>F</kbd> on a desktop; a round
  **realm** button above jump on a phone (taps are safe near the stick; a swipe
  is not). The switch is an *edge*: it is consumed once per press, so a
  double-shift cannot fall out of one key press. A badge at the bottom of the
  HUD says which realm you are in, because that is the one thing the screen must
  never leave ambiguous.
- **The look is per-world data, and the first authored world is not here yet.**
  `cognitiveSkin` (beads / flames / water / land / light) already exists per map,
  with the canon guard that glass beads require `system: 'rosharan'`. The M0/M1
  test range is deliberately non-canonical (`system: 'unassigned'`), so M2 ships
  the *machinery* and leaves the appearance to the map that asks for it — no
  canon invented to make a screenshot look better.
- **Input bindings are data, on purpose (owner's PS).** The owner wants to
  *swap* binding sets per magic kit later ("like windrunner and mist born"), with
  today's controls as the permanent default set. So the realm shift is a named
  action (`consumeRealm`) rather than a raw key check inside game code, hotkeys
  stay in one table, and no game logic reads a key directly. The swap UI and the
  kit binding tables are M6 work (the brief's `MagicKit` contract); the ground is
  being kept ready for them now.

## M2 — the Perpendicularity is the realm gate (owner, 2026-10-15)

- **The realm shift is a place, not a binding.** The owner: "make a
  Perpendicularity by spawn with a fade to black transition. Remove the realm
  swap button and key binding." So the F key and the phone's *realm* button are
  gone: the shift happens when you **walk into the pool**, which is what canon
  says a Perpendicularity is (a gate between realms — ROADMAP.md Canon anchors).
  The old binding was not deleted and replaced with a new one on purpose; the
  only input that shifts realms is walking.
- **The pool is map data, drawn as furniture.** `map.perpendicularity` holds its
  id, position, radius and `open` flag; the renderer builds a disc whose
  vertices sample `terrainHeight`, so a pool follows a slope like liquid instead
  of floating over it or fighting the ground it lies on (3 cm proud, the fence's
  coplanar rule). Its colour is per palette variant, like fog and sky. `open` is
  already honoured by the gate — M4's "find it, then open it" is a puzzle about
  turning that flag on, not a rewrite.
- **The trigger is an edge, and arrivals are quiet.** `gateStep` fires once per
  *visit*: standing in the pool does not shift you every frame, and arriving in
  the pool — which is where a shift leaves you — does not fire straight back. A
  transition in flight blocks the gate entirely, so a double fire cannot cancel
  itself out behind a black screen.
- **The world holds still behind the fade.** While the fade is active the sim
  does not step. A transition is a beat: nothing may happen to the player that
  they cannot see happening. It also means the fade can never be a place where a
  player walks off a cliff in the dark.
- **The fade is a beat with a length, and the length is a setting.**
  `Realm transition (ms)` (0–2000, default 420) is a live slider and mirrored in
  the URL (`?fadems=`) — feel numbers are the owner's, per the working
  agreements. A `prefers-reduced-motion: reduce` session caps it at 120 ms: it is
  the one piece of this UI that has to respect that preference (M8 lists the
  option; honouring it costs three lines).
- **A realm can still be set without walking, but only off the player's path.**
  `?realm=cognitive` starts a session in the lens and `__worldhopper.realm(id)`
  sets it for the harness. Both exist for screenshots and tests; neither is
  reachable by playing, which is the point of removing the binding.
- **Named actions, ready for kits.** The shift is not a key check inside game
  logic: the gate is a core function, the input layer owns keys, and hotkeys live
  in one table. When kits bring their own binding tables (owner's PS, M6), the
  Perpendicularity is unaffected — it is geometry, not a binding.

## M2 process — what an all-green run has to mean (agent, 2026-10-16)

The Perpendicularity slice hid four bugs, and the expensive ones were not in the
pool: two of them meant the game did not start at all, and CI could not say so.
`ready` is only set once the frame loop has run cleanly, so anything thrown
while the game starts leaves every headless test waiting out its own 30-second
timeout. The symptom was "the smoke test is slow", and the first run of the
slice was cancelled at the job's 25-minute cap with nothing published at all —
because a cancelled job skips every `if: always()` step after it.

Three changes, so that failure mode cannot come back:

- **A stalled run publishes its evidence.** Playwright stops itself at 11
  minutes and the smoke step has its own 14-minute guard, so an overrun ends
  with a report, screenshots and per-test timings instead of a cancelled job.
  The CI report also lists the eight slowest tests on every run, green or red:
  "the step ran out of clock" is invisible from outside otherwise.
- **A failure mode that affects everything stops the run.** `maxFailures: 6` in
  CI. Eighty identical 30-second timeouts say nothing that six did not.
- **A lint step, correctness only.** `eslint.config.mjs`: `no-undef`,
  `no-unused-vars`, duplicate keys, unreachable code — no formatting, no style,
  nothing that could be silenced for tidiness. It runs before the browser is
  ever launched, and it caught a live bug in the very commit that added it.
  Both dead-game bugs were a name that did not exist, which is precisely what a
  parser answers in milliseconds and a headless suite cannot answer at all.

Two smaller consequences worth keeping:

- **The debug snapshot is a whitelist, and a dropped field reads as
  `undefined`.** That cost a run in slice 1 (`realm`) and another here
  (`fade`/`fades`). There is now a test that compares the keys the game hands
  the snapshot against the keys it returns, so the next field added on one side
  cannot vanish on the other.
- **Harness walks are wall clock, sim distances are not.** A screenshot walk
  that stops "2.7 m short of the pool" in the sim is not 2.7 m short in the
  browser: key dispatch latency lands on top, and the walk crossed into the
  realm shift — which would have filed pictures of the lens under the physical
  world's name. The screenshot specs now assert the realm *before* taking each
  picture, so a walk that goes wrong fails instead of quietly mislabelling the
  owner's evidence.

## M2 — the skins: Roshar is the first world, and what it looks like (agent, 2026-10-16)

The owner: *"make the skins"*. Until now the Cognitive Realm was a **camera** and
nothing else — the same world, seen from a diagram angle. That is exactly what the
roadmap's M2 checklist called out ("the abstraction pass (beads, flames,
connection lines) is **not**") and what its exit question is about ("is the realm
legible and beautiful? Does the inversion read?").

**Decisions, and what each one is reversible by:**

- **Roshar is authored as a world, at `src/worlds/roshar/`** (the roadmap's
  "planets live at `src/worlds/<name>/`"), with a design page at
  `design/planets/roshar.md`. The skin needed a world to belong to; the roadmap
  said as much ("Roshar's own skin is not authored yet, because the first
  authored world is not in the repo"). This is *not* the world work package —
  the terrain kit is still the M0 basin, and the file says so at the top rather
  than pretending otherwise.
- **The patch is the peaks above the pool.** Roshar's Perpendicularity is
  canonically the pool at the Horneater Peaks, so putting the first gate there
  means the gate is the canon one. *Reversible:* it is a name and a blurb.
- **The test range stays the default map, and `?map=` picks the world.** The
  owner's pinned playtest config (`palette=cold-ridge` and the rest) belongs to
  the map they tuned it on; making Roshar the default would silently re-point
  their settings. **This is a question for the owner in the PR** — flipping it is
  one line plus the palette list.
- **The cognitive look is *not* per palette variant.** A palette variant is the
  physical world's weather; the subastral is not weather. So the bead sea is the
  same sea under every physical palette, which also means the skin's colours are
  world data rather than variant data.
- **The canon guard uses the map's `system`, never the skin's own copy.** A skin
  that claims `rosharan` on a Scadrian map is refused twice over (a mismatch
  violation and the bead violation); a skin that is a copy of itself is not a
  guard. Proven by unit tests, including the negative cases.
- **A skin that is not fully authored draws nothing.** "Unassigned" is a state,
  not a fallback style: the test range behaves exactly as it did in M2 slice 1.
- **The beads are a rendering of the same world, never a second one.** Beads sit
  on the terrain height field, a soul sits where its object is, the flame sits
  where the player is. The simulation never learns that any of this exists, and
  the entity hash is asserted identical across a shift (as in slice 1). A bead's
  size is a hash of its lattice *cell*, not of the frame, so the sea does not
  crawl when the camera moves — pinned by a determinism test.
- **What is not done, deliberately:** connection lines (they belong with M4's
  "reveal a route across the bead sea", which is the interaction that must be
  solvable only in the realm); Scadrial's skin (WP-7.3, Agent 3); Roshar's real
  terrain, gravity, crem and highstorms (M5, with the owner).

**A seam worth recording for Phase B:** with two agents about to touch the repo,
`OWNERSHIP.md` now maps every directory to a lane, and the second agent's brief
(`AGENT-2-START.md`) points at it. `CONTRACTS.md` waits for WP-3.1/3.2, which
define the last shared schema.

## M2 — the game opens on Roshar (agent, 2026-10-16)

The owner's whole message was *"Nothing changed from last time."* They were right,
and the reason was a decision I had made in the skins PR and left open as a
question: **the default world was still the M0 test range.** The skins shipped,
the tests were green, and a player who opened the game — or a phone playtester who
would never type a URL parameter — landed on the one map that has *no* cognitive
realm to look at, because it has no canon to draw one from. Everything worked and
nothing was visible. That is a delivery failure, not a build failure.

**Decision: `DEFAULT_MAP_ID` is `roshar`.** The test range is `?map=blank-basin`.

- **The owner's tuned feel is untouched.** Every number they pasted back (seed,
  fog, sun, ambient, fov, look, capture, walk, jump, gravity, accel, bob) is
  map-agnostic and unchanged, and the pin test still asserts all of them.
- **The palette default became per-world data.** `cold-ridge` is a *test-range*
  palette; the name means nothing on Roshar. So a map now declares
  `defaultPalette`, `setPaletteOptions(mapId)` points the setting at the loaded
  map's list **and** its default at boot, and the pin test got *stricter* rather
  than looser: it asserts every world opens on the palette it declares, that the
  declaration exists on that map, and that `cold-ridge` is still the test range's
  default — the owner's pick, where they picked it.
- **Roshar opens on `storm-shore`** (the warm one). `highstorm-light` is the
  colder alternative and is a playtest question, not a settled taste call.
- **What this cost in tests is the interesting part:** seven unit tests and two
  e2e assertions failed, and every one of them was a test that said "the default
  map" when it meant "the test range". They now name their world (`TEST_RANGE`),
  which is what they should have done all along — a test that depends on the
  shape of a specific map should say which map it is.
- **A test was added for the class of mistake, not just the instance:** *"the
  world the game opens on is a world with a realm to look at"* — the opening map
  must not be a placeholder, must have a `cognitiveSkin`, and must declare a
  default palette that exists on it. The next person to change `DEFAULT_MAP_ID`
  gets told what they are signing up for.
- **Reverting is one line** (`DEFAULT_MAP_ID`), plus the PR note.
