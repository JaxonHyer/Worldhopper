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

1. **Land** on a planet (short canned landing moment).
2. **Explore in 3D.** Walk, climb, observe, scan; the journal fills.
   The world has dangers: encounters are avoided, evaded, or fought.
3. **Shift to the Cognitive Realm** — same world, abstracted
   (orthographic view; appearance defined per world — beads and flames
   on Roshar, the Expanse of the Vapors on Scadrial, and so on).
4. **Solve something only solvable there** — reveal a route, unblock a
   passage, calm something, learn where the Perpendicularity is.
5. **Shift back.** The world changed because of what you did.
6. **Attune as needed.** Swap magic kits from the menu; bindings and
   HUD change with the kit.
7. **Open the Perpendicularity → hop to the next world.**

Underneath: **damage → death → respawn at the last beacon**, with no
item loss and no penalty beyond position (health is a consequence
layer, never a progression grind). The realm switch and the kit swap
are both *verbs* — instant, frequent, tactical.

---

## Design pillars

1. **One planet, one rule.** Each world teaches and tests exactly one
   mechanic. If a planet needs two rules, it is two planets.
2. **Pocket scale.** The whole system fits in ~8 km. Small is a feature.
3. **Fog is the art director.** Mood, draw distance, and mystery in one
   tool — and the Cosmere is foggy by canon (mist, ash, storms, bead-sea).
4. **Cardboard charm, not realism.** Creatures and NPCs are blocky
   box-mobs at *Minecraft detail tier or below*, animated procedurally.
   Nothing realistic, nothing rigged, nothing that needs lip sync.
   Ambient fauna remain **spren**: glowing abstract forms.
5. **The journal is the progression.** Discovery, not loot. No levels,
   no gear tiers, no damage numbers.
6. **A system is a chapter, not a content dump.** Multiple pocket
   systems are encouraged; the **total budget of hand-authored scenes**
   stays closed (≤6 for v1).
7. **Encounters are seasoning, not the meal.** Danger comes in pockets;
   escape is always possible; at least one enemy per world cannot be
   fought at all — only avoided.
8. **Readable beats clever.** Every threat is telegraphed. AI
   "intelligence" is a set of small, legible rules — never an
   open-ended claim.
9. **Each kit is a character.** A magic system is character-sized
   content. Kits ship one at a time, each with its world. Parity
   between kits is never promised.

---

## Scope fence

| In | Out (permanent) |
|---|---|
| 2–3 star systems, **≤6 hand-authored scenes for v1**, one idea each | Infinite/procedural worlds |
| Walking, looking, scanning, realm-shifting | Combat **progression** (levels, gear tiers, damage numbers, loot) |
| Health, damage, death, beacon respawn | Permadeath, item loss, corpse runs |
| Blocky enemies (≤3 archetypes/world, ≤6 active), dialog NPCs | Realistic organic creatures; rigged/skeletal/facial animation; voices |
| Magic kits via attunement menu (one complete kit at v1) | Kit parity promises; more than a handful of kits |
| One flagship "hunter" AI (the Inquisitor, M7) | "Genius AI" as an open-ended goal |
| Journal / discovery log | Crafting, mining, resource trees |
| A tiny pocket solar system (per map) | Realistic orbital distances |
| Canned landing/travel moments | Seamless atmospheric flight |
| Single-player, offline-capable | Multiplayer, accounts, servers, analytics |
| Feel tuned by sliders + playtest | Feel "tuned" by agent guesswork |

**Why the Out column is absolute:** each item is either a scale
explosion, a feel sink with no automated test, or a content-volume
problem no solo/agent pipeline can fill with quality. These are not
"later" items. They are the deleted 20% that would have eaten 80% of
the schedule.

---

## Canon anchors (verified — do not contradict)

Lore facts the build depends on. The dev agent treats this section as
source of truth and does not invent around it. Where canon is silent,
the project interpretation is stated explicitly.

**The realm**

- **Shadesmar is the Rosharan subastral's name** — the cognitive ocean
  of glass beads represents *Roshar's* land (each bead = the soul of a
  non-living object); living things appear as **flames**; bodies of
  water invert to **solid obsidian/stone**; the sky is **black with a
  single frail white sun** that never moves or sets — **there is no day
  or night cycle** in the Cognitive Realm.
- **Other worlds' subastrals look different.** Scadrial's ("the
  Expanse of the Vapors") is mist: objects appear as misty figures,
  metal **glows**, land is misty fluid, water is solid dark smoky
  stone with mist-emitting plants.
- **Between populated subastrals lies the emberdark** — the dark,
  starless cognitive "space" between worlds. Canon is deliberately
  thin here (RAFO). **Project interpretation (locked):** system-to-
  system travel is staged in the emberdark; it is dark, sparse, and
  the only place the game has no landmarks.
- Canon supports travel-by-foot between worlds: cognition warps space,
  so the distance between worlds is heavily contracted in the realm.
  **Perpendicularities** (formed by long Shard presence) are the gates
  between realms/worlds — Roshar's is the pool at the Horneater Peaks.

**→ Architectural consequence:** the cognitive realm's *appearance is
per-world data* (`cognitiveSkin`), not one global style. The lens is
code written once; each world supplies its own manifestation. **Beads
exist only over the Rosharan system. Never put beads on Scadrial.**

**The Rosharan system (v1's setting)**

- Sun; then telluric planets **Ashyn** (1st — "Tranquiline Halls" in
  myth; mostly barren with fertile patches; no Shard), **Roshar**
  (2nd — one supercontinent, gravity ~0.7 g), **Braize** (3rd — cold,
  outside the habitable zone; inhabited by **self-aware Splinters**;
  "Damnation" in myth).
- Beyond an asteroid belt: **ten gas giants named after Vorin
  numerals** — chart scenery only, never visitable.
- Roshar's three moons: **Salas** (violet, smallest), **Nomon** (pale
  blue), **Mishim** (green). A fourth moon shattered long ago;
  fragments lie under the Shattered Plains (a material above aluminum
  that hides things even from Shards — available as a late-game puzzle
  hook).
- Braize's Splinters are the canon license for abstract glowing
  entities — reuse the spren rig for them.

**Per-world cognitiveSkin table**

| World | Objects | Living | Water | Land | Light |
|---|---|---|---|---|---|
| Roshar | dark glass beads | flames | solid obsidian | bead sea | frail fixed white sun |
| Scadrial | misty figures | glow; metal glows | solid dark stone | misty fluid | pale gloom |
| Ashyn / Braize / others | *design pass with owner at their milestone* | | | | |

---

### Systems & maps (multiple solar systems)

Each star system — and each world within it — is a **separate map**
(own scene, own pocket-scale coordinates, own seed). The scale fence
applies *per map*, so precision and depth problems stay deleted no
matter how many maps exist. Two systems never share one continuous
coordinate space at realistic distances — travel between them is a
scene swap behind a transition.

- **Cross-system travel happens in the emberdark** (see Canon anchors).
  The crossing is ceremonial, canned, and doubles as the loading
  screen — your cheapest realm is the interstellar highway.
- **Other systems in the sky are painted** (skybox, not geometry).
- **A star chart is the map screen** — systems unlocked, journal
  links, where the next Perpendicularity leads.
- **Systems are budgeted.** Default shape: 1 anchor world + 1–2
  satellites, each carrying its own idea.

---

## Encounters, enemies & NPCs

**Enemy tier: "Minecraft or below."** Box-part rigs (body, head, 1–4
limbs), flat colors, **procedural animation only** — walk bob, lurch,
attack lunge, recoil, hit-flash. No skeletal rigs, no inverse
kinematics, no facial animation, no textures beyond flat/simple.
Jank is the aesthetic; readability is the requirement.

**Budgets:** ≤3 enemy archetypes per world (2 is better), ≤6 active
enemies at once, encounters placed in pockets — not carpets of
spawns. Every archetype gets: one silhouette, one sound, one tell.

**The fairness contract (binding):**

1. Every damage source telegraphs before it lands: ≥0.4 s wind-up with
   audio + visual cue. No exceptions.
2. **No untelegraphed attack from outside the player's view.** If the
   attacker is off-screen, its approach cue must have played.
3. Hit → knockback + ~1 s invulnerability window + red vignette. No
   hit-stun chains, no permastun.
4. Every enemy has aggro and leash ranges; disengaging always works.
5. At least one enemy per world **cannot be fought at all** — only
   avoided (the anglerfish principle: dread without a health bar).

**Dialog NPCs:** ≤2 per map, blocky Minecraft-tier, nameplate, text
box with 2–4 choices. Dialogue is **data** (JSON files) — the owner
edits copy without code. No voice, no lip sync, no animation beyond
an idle bob.

**The Inquisitor (M7, Scadrial) — the flagship hunter.** The owner's
"genius" ambusher, translated into implementable, testable rules:

- FOV-aware approach: compute the player's view cone each tick; prefer
  approach vectors **outside** it; if inside it, hold, flank, or break
  line of sight (raycast gate).
- Stalk at range; strike when the player is distracted (recently
  damaged, mid-encounter with another enemy, in a menu).
- Attack only with a full wind-up + audio cue; if the player turns to
  face it during wind-up, disengage (this single rule *is* the
  "genius" feeling).
- Uses Allomancy itself (steel/iron) to reposition — the mirror fight:
  it plays by the player's rules.
- **Acceptance = assertions + owner feel test.** Headless tests assert
  approach-angle distribution (approaches outside view cone), that
  cues fire before damage, and that disengage triggers when facing
  it. Whether the ambush is *thrilling or maddening* is the owner's
  call, adjusted via tuning sliders (wind-up length, stalk speed,
  aggro radius, attack cooldown).

**The tuning panel grows:** combat numbers (wind-up, damage, cooldown,
knockback, aggro radius, enemy speed) join the feel sliders. Combat
timing is the deepest feel sink in the project — it is tuned by the
owner, never guessed by an agent.

---

## Health & death

- **Hearts:** 3–5, tunable. No damage numbers. Damage cooldown ~1 s,
  knockback, red vignette.
- **Healing:** at **beacons** (checkpoint shrines placed at memorable
  spots) or via kit-specific resources (Stormlight).
- **Death:** fade to black → respawn at last beacon. **No item loss,
  no penalty beyond position.** Deaths should be rare, readable
  events, not a cost of doing business.
- Health is a **consequence layer**, never a progression system.

---

## Magic & attunement

**Fiction (project interpretation, flagged as such):** the player is
a worldhopper who carries **unkeyed Invested relics** ("attunement
relics") allowing one system's powers at a time. This is a game
invention; canon does not have free swapping. It exists so the kit
menu can exist.

**The `MagicKit` contract** (each kit defines, in one file):

- its **verbs** (activate/cancel, target rules),
- its **resource** (Stormlight drain/refill, metal reserves, Breath,
  ...) and HUD element for it,
- its **binding table** (keyboard + touch) — **showing the same kit
  actions on different keys per kit is the point**,
- its **VFX palette** and audio cue,
- its **rules** (costs, cooldowns, interactions with the realm shift).

**Swap UX:** the attunement menu lists kits and their bindings; swap
is near-instant with a brief vulnerable "attunement" window (tunable
via slider — the owner decides whether swapping mid-fight is safe).
HUD legend relabels to the current kit's bindings.

**Scope rule (honest):** a kit is **character-sized content**. v1
ships **one complete kit** — the Radiant kit on Roshar — and it should
start with **1–2 abilities chosen for exploration** (candidate:
Adhesion for puzzles + Gravitation-lite for traversal; a full
combat suite comes later). The second kit (Allomancy) ships with
Scadrial at M7, because **each kit arrives with its world**. Parity
between kits is never promised; the debug kit (no powers, just a
swap target for tests) exists from M6 to test the framework.

**Kit ladder (sketch, later milestones):**

| Kit | World / System | Notes |
|---|---|---|
| Surgebinding (Radiant) | Roshar | first kit; scope set with owner (M6) |
| Allomancy | Scadrial | metals as reserves; ships with Scadrial (M7) |
| Awakening | Nalthis | Breath + color as resource |
| AonDor | Sel | location-programmed magic; probably a whole milestone |
| Sand mastery | Taldain | dayside/nightside duality |
| Painting | Komashi (UTol system) | banish nightmares — the most game-ready modern rule |
| Aviar | First of the Sun (Drominad) | companion-based |
| *rules-horror* | Threnody | the "Simple Rules" are a ready-made survival-horror kit |
| — | Yolen | **last, forever**: Dragonsteel unpublished; nothing to build faithfully |

---

## Crew plan — multiple agents, one repo

The owner runs several agent sessions against the same GitHub
repository. The coordination layer is **git + GitHub Actions + the
Issues board** — not chat memory. Any session can be closed and
restarted; the repo is the state.

| Phase | Milestones | Crew | Why the crew grows here |
|---|---|---|---|
| **A — Solo** | M0–M2 | Agent 1 | The spine (movement, realm switch, shared world state) must be one continuous thought. |
| **B — Duo** | M3–M5 | Agents 1–2 | First true seam appears: world systems (health, enemies, gates) vs. content/UI (NPCs, journal, dialog). |
| **C — Squad** | M6–M8 | Agents 1–5 | Content phase: kits, worlds, and lanes parallelize — each world is an isolated directory, each kit is one package. |

**Rules of engagement (binding from Phase B onward):**

1. **One work package = one branch = one agent = one PR**
   (`wp/<id>-<slug>`).
2. **The Issues board is the single source of truth and the owner's
   cockpit.** Agents work only assigned packages (`agent:N` labels).
3. **File ownership.** `OWNERSHIP.md` maps every directory to an
   agent. One writer per file at a time. Need a change elsewhere? Open
   an issue, tag the lane owner, keep moving.
4. **Contracts are frozen.** `CONTRACTS.md` defines shared schemas
   (world state, `PlanetConfig`, `cognitiveSkin`, `MagicKit`, journal
   entries, enemy state machine). Changes only via a `contract`-labeled
   PR by Agent 1, logged in `DECISIONS.md`.
5. **CI is the reviewer.** The owner reads no code. Merge requires a
   green headless suite + the PR body stating how the change was
   verified, with a screenshot where visible.
6. **Small and fast.** Merge within a day; rebase daily. A merge
   conflict is a boundary bug: escalate to Agent 1, don't brute-force.
7. **Serialize the shared.** Engine/state changes and **feel tuning**
   go through one agent at a time (feel tuning = owner + one agent).
8. **Blocked → switch; idle → test.** Never idle-wait; never invent
   scope to fill time.
9. **Questions batched** (`needs:answer` issues, answered at milestone
   gates). **Playtests batched** (max 2 questions per agent per
   milestone).
10. **Parallelism multiplies throughput, never scope.** The scale
    fence and the scene ledger are unchanged by crew size.

**Roles in Phase C:** Agent 1 = integration lead / engine warden / AI
systems (the Inquisitor is systemic). Agents 2–4 = content lanes
(worlds and kits, assigned per milestone). Agent 5 = cross-cutting
systems (star chart, journal, dialog framework) and verification.

**Honest expectation:** five agents on well-split work ≈ **2–3×** a
solo agent, not 5×. Badly split work goes *negative*. If seams close,
drop back a phase.

---

## Milestones

### M0 — Skeleton live on Pages ✅
**Crew: Agent 1 (solo).**
- [x] Repo: Vite + pinned Three.js, `.nojekyll`, `base: './'`
- [x] GitHub Actions → GitHub Pages deploy, green
- [x] Blank world: sky gradient, ground plane, fog
- [x] Debug overlay (FPS, distance-from-origin, seed) + empty tuning panel
- [x] Headless smoke test in CI (no console errors, screenshot)
- [x] "Unofficial fan work" notice in README + credits

**Exit:** the owner opens the live URL on phone and desktop and sees
the right mood. — **signed off** (PR #1, merged `93d9147`).

### M1 — Roshar on foot
**Crew: Agent 1 (solo).**
- [x] Walking: custom collision, fixed-timestep sim, seeded RNG — **third person is
      the default view**, the owner's call after playing M1 (`?view=first` keeps the eye view)
- [x] Touch controls (stick + look-drag) alongside keyboard/mouse — plus a jump
      button, a sprint toggle and mouse capture on desktop
- [ ] Terrain: plateau/chasm kit; **one landmark silhouette** readable through fog
      — the landmark is in ("the Grey Needle"); the *terrain kit* is still the M0
      rolling basin, and this map is still a non-canon test range
- [ ] Ambient spren (motes, ribbons)
- [x] Tuning panel v1: move speed, jump, gravity, look sensitivity, fog density
- [x] Feel settings persist (URL/localStorage)

**Owner notes delivered on top of this milestone** (their requests, all accepted):
third person · a blocky, pixel-textured player with a Minecraft-style face that
turns to face the way it walks · generic clothes · an alternate girl character
behind one boolean (`girlPlayer`) · a sprint control (hold Shift on desktop, a
toggle button bottom-left on a phone) · a walk-animation cap so the legs do not
buzz at 7.9 m/s.

**Exit:** walking around Roshar's patch is pleasant. *(Owner playtest:
movement feel; landmark readability.)* — **signed off** (PRs #2–#6).

### M2 — The Cognitive Realm (Shadesmar) — **in progress**
**Crew: Agent 1 (solo).**
- [x] Realm shift — **through the Perpendicularity, not a key binding** (owner,
      2026-10-15: "make a Perpendicularity by spawn with a fade to black
      transition. Remove the realm swap button and key binding."). The pool sits
      14 m from the spawn, the shift is edge-triggered (walk out and back in to
      shift again), and the transition length is a feel slider
      (`Realm transition (ms)`, `?fadems=`)
- [ ] `cognitiveSkin` config introduced — the config, the per-map contract and
      the canon guard (beads are Rosharan-only) are **in**; Roshar's own skin is
      not authored yet, because the first authored world is not in the repo
- [ ] Orthographic camera + abstraction pass — the orthographic, high-angle lens
      is **in** (fixed diagram pitch, zoom as a setting, never under the terrain);
      the abstraction pass (beads, flames, connection lines) is **not**
- [ ] One interaction only solvable there (reveal a route across the bead sea)
- [ ] Shifting back shows the world changed (state, not illusion)
- [ ] **Contracts frozen** (`CONTRACTS.md`, `OWNERSHIP.md`) so Phase B can be
      briefed from files alone

**Exit:** the switch feels like a tool you think with. *(Owner
playtest: is the realm legible and beautiful? Does the inversion read?)*
— the switch itself was accepted on 2026-10-15 ("the realm-swap was perfect").

### M3 — Encounters, health & NPCs
**Crew: Agents 1–2** — the crew grows here.
- [ ] WP-3.1 Health/damage/death/beacon respawn + combat sliders — **Agent 1**
- [ ] WP-3.2 Enemy framework: blocky rigs, procedural animation, state machine (idle/alert/hunt/attack/disengage) — **Agent 1**
- [ ] WP-3.3 First archetypes (2, Roshar-flavored, owner design pass) — **Agent 2**
- [ ] WP-3.4 Dialog NPC framework + 1–2 NPCs (JSON dialogue data) — **Agent 2**
- [ ] WP-3.5 Fairness-contract tests (telegraph-before-damage assertions) — **Agent 2**

**Exit:** one encounter that is tense, readable, and escapable.
*(Owner playtest: fair or annoying? Is the telegraph clear on a
phone?)*

### M4 — Perpendicularity & the vertical slice
**Crew: Agents 1–2.**
- [ ] WP-4.1 Perpendicularity gate: find (via realm clues) → open — **Agent 1**
      *(the pool itself — geometry, walk-in trigger, fade to black — shipped early
      in M2 at the owner's request; what remains here is the puzzle: it starts
      closed, and only realm clues tell you where and how to open it.)*
- [ ] WP-4.2 Journal UI, scanning, save schema — **Agent 2**
- [ ] WP-4.3 Hop to world #2 (stub) — **Agent 1**
- [ ] WP-4.4 Full-run regression suite — **Agent 2**
- [ ] **Vertical slice complete** (whole crew)

**Exit — the honest demo:** a stranger can land, walk, scan three
things, survive one encounter, shift realms, solve, open the
Perpendicularity, and hop — ~10 minutes, no crashes, on a phone.

### M5 — The Rosharan system
**Crew: Agents 1–2.**
- [ ] WP-5.1 Ashyn: design pass with owner (mostly barren, fertile
  patches; disease-folklore flavor without mechanics bloat) — **Agent 1**
- [ ] WP-5.2 Braize: cold world, self-aware Splinters (spren rig) — **Agent 2**
- [ ] WP-5.3 System chart v1 (Rosharan system, 10 gas giants as scenery) — **Agent 2**
- [ ] WP-5.4 Scale canary + long-session regression — **Agent 1**

**Exit:** three worlds read as one system, each memorable by its rule.

### M6 — Magic & attunement
**Crew: Agents 1–5** — the crew grows here.
- [ ] WP-6.1 `MagicKit` contract + registry + attunement menu + binding tables + HUD relabel — **Agent 1**
- [ ] WP-6.2 **Radiant kit** (1–2 exploration abilities; scope locked with owner) — **Agent 2**
- [ ] WP-6.3 Resource system (Stormlight drain/refill; beacon interactions) — **Agent 3**
- [ ] WP-6.4 Kit VFX/audio pass; debug kit (no powers, for swap tests) — **Agent 4**
- [ ] WP-6.5 Binding-table snapshot tests + kit state-machine tests — **Agent 5**

**Exit:** the menu swap is instant and clear; bindings visibly change
per kit. *(Owner playtest: is the swap satisfying? Is the vulnerable
window fair?)*

### M7 — The emberdark & Scadrial
**Crew: Agents 1–5.**
- [ ] WP-7.1 Emberdark crossing ceremony (canned; distinct from planet hops) — **Agent 1**
- [ ] WP-7.2 Scadrial world: verticality + metal-lines rule; ash day/mist night; monolith landmark — **Agent 2**
- [ ] WP-7.3 Scadrian `cognitiveSkin`: Expanse of the Vapors — **Agent 3**
- [ ] WP-7.4 **Allomancy kit** (steelpush/ironpull traversal + verbs) — **Agent 4**
- [ ] WP-7.5 **Inquisitor AI**: FOV-aware ambusher, fairness spec, deterministic AI tests — **Agent 1**
- [ ] WP-7.6 Star chart v2 + journal completion + integration — **Agent 5**

**Exit:** the ambush hunt is the scariest, fairest thing in the game.
*(Owner playtest: thrilling or maddening? Tune via sliders.)*

### M8 — Polish & ship
**Crew: Agents 1–5.**
- [ ] WP-8.1 Mobile performance pass (owner's real phone) — **Agent 1**
- [ ] WP-8.2 Journal art pass (in-world look, not a spreadsheet) — **Agent 2**
- [ ] WP-8.3 Accessibility: remap controls, reduced-motion option, readable text — **Agent 3**
- [ ] WP-8.4 Audio pass: ambient beds, kit cues, enemy tells, footfalls — **Agent 4**
- [ ] WP-8.5 Credits, README, final "unofficial fan work" text — **Agent 5**
- [ ] WP-8.6 Final integration + tagged release: **v1.0 demo** — **Agent 1**

---

## Planet template

Planets live at `src/worlds/<name>/`. This template is also the **PR
contract** for a world work package. One page per planet in
`design/planets/<name>.md`:

- **Name & inspiration** (canon world or original)
- **The rule** — the one mechanic this planet teaches and tests
- **Palette** — 3–5 colors + sky gradient + fog color/density
- **Landmark** — the one silhouette visible from most of the surface
- **`cognitiveSkin`** — what objects/living/water/land become; light source
- **Enemies** — ≤3 archetypes; which one cannot be fought
- **NPCs** — 0–2; dialogue file paths
- **Perpendicularity** — where; what opening it requires
- **Sound bed** — 1–2 ambient loops
- **The one question** — the single thing only playtesting can answer

---

## Expansion ladder (all nine systems)

The fiction's horizon and the journal's "known but unvisited" entries.
v1.0 ships on the ≤6-scene ledger (Roshar, Ashyn, Braize, Scadrial +
satellites). Each later system is a **content package, not a project**.

| # | System | Worlds of note | Kits / hooks | Notes |
|---|---|---|---|---|
| 1 | **Rosharan** (build first) | Roshar, Ashyn, Braize | Surgebinding | v1's system; deepest canon = least invention |
| 2 | **Scadrian** | Scadrial | Allomancy | M7; Inquisitors; the Expanse of the Vapors |
| 3 | **Nalthian** | Nalthis | Awakening | Breath + color as resource |
| 4 | **Selish** | Sel | AonDor | location-programmed magic; big kit |
| 5 | **Taldain** | Taldain | Sand mastery | dayside/nightside duality |
| 6 | **Drominad** | First of the Sun | Aviar | island/companion framing |
| 7 | **Threnodite** | Threnody | Simple Rules | survival-horror ruleset, ready-made |
| 8 | **UTol** | Komashi, UTol | Painting (nightmares) | most game-ready modern rule |
| 9 | **Yolish** | Yolen | — | **last, forever**: unpublished source material |

---

## Verification protocol

Every agent provides, per work package and per milestone:

1. **Evidence** — what tests ran, what they assert, screenshots.
2. **A playtest checklist** — max 3 questions, batched at the milestone
   gate (max 2 per agent).
3. **Nothing claimed about feel, motion, or "genius."** Those are the
   owner's calls, always.
4. **PR gate** — green headless suite required to merge; CI is the
   reviewer.

Additions for this scope:

- **AI assertions:** approach-angle distribution (outside view cone),
  cue-before-damage, disengage-when-faced. Rules are testable even
  though "genius" is not.
- **Binding snapshots:** every kit's binding table is snapshot-tested
  so HUD and input never drift apart.
- **Enemy fairness tests:** every damage source must emit its
  telegraph event in headless logs before the damage event.
- **Combat is feel:** all combat numbers live in the tuning panel.

The owner provides: desktop + phone play sessions, answers to the
batched checklist, and tuned slider values pasted back as config.

---

## Known traps

- **Float precision.** Pocket scale deletes it — if it reappears, the
  fence was broken, not the engine.
- **Depth fighting.** Fog + sane camera planes + no coplanar surfaces.
- **Atmosphere transitions.** Seamless flight is a studio-scale shader
  problem with no automated test. Landings are canned on purpose.
- **Content volume.** Generated ≠ curated. Separate *maps* are free;
  separate *content* is not.
- **Screenshot-blindness.** Most of the above look *finished* in a
  still image. The owner playtests motion; the agent never scores it.
- **"Genius AI."** Unfalsifiable goals produce confident, disappointing
  work. Genius here = explicit rules + telegraphs + owner tuning.
- **Combat feel is the deepest sink.** Wind-ups, hit feedback, and
  knockback are pure playtest territory. Sliders first, guesses never.
- **Kit drift.** Bindings, HUD, and costs across kits decay without
  snapshot tests.
- **Merge chaos (many agents).** The contract/ownership rules are what
  make parallelism net-positive. Five agents ≠ 5× (expect 2–3×).

---

## Legal

Unofficial, non-commercial fan work inspired by Brandon Sanderson's
Cosmere. Not endorsed by Dragonsteel. **No monetization of any kind
(ads, donations, tips, paywalls, merch) — ever**, matching both the
author's fan-work policy and GitHub Pages' free-hosting terms. All
assets are original; no official art, text, or standalone symbols are
copied. See `NOTICE` for details.
