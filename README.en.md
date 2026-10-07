# wipe-cause

English · [Português](README.md)

A tool to find out **why the try wiped** in World of Warcraft. It reads `WoWCombatLog.txt` straight from your machine and, with your Warcraft Logs account, fills in the night with whatever your log missed — no server of its own.

## First steps

The first time, the app opens on **Settings** with a step-by-step guide (afterwards it lives in *Settings → How it works*):

1. **WoW logs folder** — found automatically on most PCs (`World of Warcraft\_retail_\Logs`).
2. **In game** — in *Options → Network*, turn on *Advanced Combat Logging*; before the first pull, `/combatlog` (or the Warcraft Logs uploader, which turns it on by itself).
3. **Sign in with Warcraft Logs** (recommended) — with your account the app sees your guild's logs, completes what your log missed, turns live mode on by itself and shows everyone's parse. No key or client to create.
4. **Optional** — turn live on when WoW opens (with the app closed, the game opens Wipe Cause minimized in the tray, already live; a light watcher with no window starts with Windows), Warcraft Recorder videos, Discord and AI.

## How it works

1. **New analysis** shows one line per night: the logs on your PC and the guild's Warcraft Logs reports, together. **Analyze** uses your PC's log (fast, no download).
2. Bosses and pulls that **aren't in your log** but are on Warcraft Logs (you left early, joined late, were away) show a download icon. **Complete** downloads only what's missing — it takes a few minutes, so you decide; after the first download, reopening is fast. Dungeons (M+) are left out.
3. Pick a pull and see:
   - the wipe's **trigger** (the mechanic failure that set off the deaths) and the boss mechanic mistakes;
   - every death: spike or slow death, missing healing, active debuffs (with stacks and description), killing blow, defensives/potion/healthstone;
   - **interrupts**: casts that went through, who kicked, who tried and missed, who could have and didn't;
   - damage done/taken per player.

Wipes shorter than 30s are ignored.

## Languages

The app is in Portuguese (Brazil) and English: the language comes from the system the first time and can be switched in **Settings** (in the page title), instantly and without losing what's open. The analysis, rule tips, rotation, share cards, Discord messages, AI dossier and tray menu follow the chosen language. Ability, boss and mechanic names stay in English in both, as they come from the game.

For contributors: every new text goes in both languages in the same change.

- **Interface:** texts live in dictionaries (`*.i18n.ts`, with `defineMessages(pt, en)`); English is typed against Portuguese, so a missing phrase doesn't compile. One test fails if Portuguese shows up outside the dictionaries, and another if a dictionary's English side has Portuguese in it.
- **Boss rules and rotations (YAML):** tips, messages, titles and notes are `{ pt: "...", en: "..." }`; names stay in English. The `wipe-core` test checks both.
- **Release notes:** a `## Português` section and a `## English` section (the app shows the one for the chosen language).

## Tuning the boss rules

Every raid has its own strategy, so boss rules can be tuned without touching files:

- **Adjust this boss's rules** (Mechanics tab): turn each mechanic on/off, change its severity, how many hits per player are tolerated, at how many stacks to warn, the maximum time until a dispel, who can be blamed and the tip and message texts. Only what differs from the default is saved, so your tuning keeps working when the app updates its rules. There's "Back to the default" per mechanic and "Restore the default" for everything.
- **Progression focus (★)**: the mechanics holding progression back go into the verdict even when minor, come first and weigh 1.5× in the score.
- **Create rule** (Boss abilities tab): for something the rules don't catch, pick in plain language what that ability means ("taking this is a mistake", "must be interrupted", "stack that kills"…); the ID comes from the log and the preview shows what it would flag in the pull.
- **Mark mistake**: for what the log can't prove (positioning, baits, assignments), mark in the pull who failed and what — or "this death was the player's fault" in the death details. It goes into the verdict, the score and the AI context.
- **Export / Import**: send a boss's tuning to the officers so everyone uses the same setup.

Saving re-analyzes the open log. Tuning is stored in `rule-tuning/<encounter>.json` in the app's data folder (`wipe-cli analyze <log> --tuning <folder>` applies it too).

## Settings

Everything the app needs lives in **Settings** (bottom of the sidebar), each item with its status (ready, needs setup, off):

- **Essential:** the WoW logs folder (detected automatically on most PCs) and the in-game combat log (`/combatlog` + Advanced Combat Logging — the app warns you if the open log was recorded without it).
- **Analysis:** the default death cutoff for new logs.
- **Optional integrations:** Warcraft Logs (sign in with your account; your own API client is an advanced option), Warcraft Recorder videos folder, Discord webhook and the "Ask the AI" provider.
- **About:** version, updates and the boss rules folder.

When a feature depends on an integration that isn't set up yet, it shows a shortcut to the right section.

**Ignore after N deaths** (top of the screen for the open log; the default, 4, is in Settings): after a few deaths the wipe is already decided. Mechanic mistakes, failures, interrupts and the trigger only count up to the N-th death of each pull; the rest is dimmed. Changing N is instant (0 = count everything).

## Live mode and Discord

With **Live** on (at the top), the app follows the most recent `WoWCombatLog` in the logs folder. Without WoW open on this PC and with a Warcraft Logs account, it follows the guild's live log (someone needs the uploader's *Live Logging* on); with *Turn live on by itself* (Settings → Warcraft Logs), it starts as soon as the guild starts the raid. When a pull ends, it re-analyzes the log in a few seconds, opens the new pull and shows a notification — you can see why you wiped before the next pull.

Closing the window leaves the app in the tray (near the clock) with live mode running; click the icon to bring it back and use **Quit** in the icon's menu to close it for good.

The pull notification has a field to note the reason for the wipe right away, the way the raid saw it (it doesn't disappear while you type). The note is saved on the PC, shows at the top of the pull (where you can edit it later), marks the pull in the list, goes on the share card and into the "Ask the AI" context.

In **Settings → Discord**, paste the raid channel's webhook. In live mode, everything arrives as an image (the same card as *Share*): on every wipe, the reason for the wipe; on every kill, the boss summary; and at the end of the raid (live turned off or 30 min with no new pull), the night summary. The pull, the boss summary and the night summary can also be sent right away through *Share* (image or message). The **Discord** button at the top pauses and resumes automatic posting without touching the options (*Share* keeps working).

To test without raiding: `node scripts/simulate-live.mjs <old log> <Logs folder>` writes a few pulls from a real log, bit by bit, into a new `WoWCombatLog`.

## Ask the AI

Every pull has an **Ask the AI** tab: the AI gets a dossier of the pull (the boss mechanics with the rules' tips, verdict, deaths with a short recap, defensives, positions, interrupt assignments, dispels, notes and a summary of the night's other pulls — ~3–5k tokens) and answers only from it. You can read the dossier in **View dossier**.

It works with any provider using OpenAI's chat format, with presets for free options: **Google Gemini** and **Groq** (free plans with no card), **OpenRouter** (`:free` models) and **Ollama** (runs on your PC, free and offline), chosen in **Settings → Ask the AI**. The API key is kept in the Windows Credential Manager. On free plans, the provider may use the questions to train models — the dossier includes player names.

## Share

The pull, the boss, the night, a player's performance and solo mode have **Share**: it builds a card to **copy as an image** and paste on Discord/WhatsApp, **save as PNG, HTML or PDF** or **send the image to Discord** through the configured webhook. Each card has two versions:

- **Summary** (default, and what goes out automatically in live mode): the essentials at a glance. For a pull, the verdict, the top 3 findings, the decisive deaths, who scored below 80 and the failure map with a legend; for a boss, each pull's HP (pull number and % on each bar), the top causes, who scored below 80 and the highlights; for solo, your numbers against the reference and the 3 most costly mistakes.
- **Full**: everything open, wider. Every death in order, the mechanics with who failed them, the interrupts that went through and the player table (pull); pull by pull and the scoreboard (boss and night); the stretches where the reference pulled ahead, cooldowns and extra damage taken (solo); rotation, potions and setup (performance).

## Player score

Each player gets a 0–100 score per pull: it starts at 100 and loses points for mechanic mistakes (by the rule's severity, up to 3 per mechanic; a tank's avoidable damage weighs half, since they often take it on purpose to hold or position the boss), for missing their own turn in the interrupt assignments and for a decisive death (more if they had a defensive left); at the end it weighs the time alive until the first death. A death in a **mass wipe** (more than 5 deaths within 1.5s — explosion, Execution, enrage) doesn't count: it's a consequence of the wipe, and the blame goes to the mechanic and whoever caused it. It shows in the Players tab (hover to see the deductions), as an average on the boss scoreboard and per night in Progress.

## Performance

Each pull's **Performance** tab compares a player with the **top players of the same spec on Warcraft Logs**, with a similar item level (and a similar kill time, if the pull was a kill). In progression there's no kill time: the top's fight is cut at the same time the player stayed alive, so a 2:30 wipe is compared with the first 2:30 of the kill (without the execute and the phases the wipe never saw).

- **Burst windows**: pick the cooldowns to compare (the class's damage ones come checked); each use becomes a chip and shows the casts from 3s before to 20s after on a timeline, side by side with the same use by the top.
- **Cooldowns**: when each one was used, how many times (and how many fit in the time) and whether the 1st use came late or early. It includes the cooldowns on the class list, minor ones too (Colossus Smash, Stormkeeper, Ancestral Guidance, Touch of the Magi…), and the ones the night's usage pattern shows.
- **Rotation**: casts per minute and % of damage per ability, pointing out what fell short or wasn't used.
- **Setup**: combat potion, stat distribution, different talents (with name and icon) and items side by side, with missing enchants and gems.
- **Export**: the player's report becomes a card to copy, save (PNG/HTML) or send to Discord — for people who don't have the app.

To use the tops, create a free client at [warcraftlogs.com/api/clients](https://www.warcraftlogs.com/api/clients/) and paste the client ID and secret in the tab (they're kept in the Windows Credential Manager). Queries only send the boss, spec and report codes; responses are cached. Comparing with your own raid (someone else of the same spec, or yourself on another try) lives in the **In your own raid** tab. If the night's report link is set, the pull also gets links to your fight on Warcraft Logs and WoWAnalyzer.

## Solo mode

At the top, **Guild / Solo** switches the app's focus. In guild mode, the question is why the raid wiped. In solo, it's how **you** can improve. "You" is whoever recorded the log (the combat log marks your own character; if you switch characters midway, each pull is still right). When analyzing from Warcraft Logs, or to pick another character, choose on the screen itself; the app remembers the choice.

- **Pull → You tab**: your metrics, your survival and your mechanic mistakes, in four parts.
  - **For the next pull:** your mistakes sorted by what they cost. An early death, idle time, a wasted proc and a DoT off the target become a damage estimate; mechanics and cooldowns are weighted by severity. Each one comes with the moment (▶ in the video) and the tip.
  - **Where the reference pulled ahead:** your damage every 5s against a reference you choose: one of the spec's tops on Warcraft Logs, someone of your spec in the raid, yourself on another pull or someone of another spec in the same pull (then only damage and damage taken). With no choice, it's the #1 top or the best in the raid who stayed alive at least 60% of your time. The 3 stretches with the biggest difference come with each side's casts and what the reference used more.
  - **Cooldowns:** your uses against the reference's on a timeline, minor cooldowns included.
  - **Mechanics:** only yours (failures in the boss rules, deaths with the killing blow and the defensive that was available) and the damage you took much more than the reference per minute alive, which tends to be avoidable damage.
  - **Rotation:** the reading of the spec's base rotation.
- **Night and boss summary**: your pulls boss by boss, the best of each and the mistakes that repeat.
- **Progress**: a boss across the saved nights: your best output, rotation, deaths and mechanic mistakes per pull.

## Rotation

Each spec can have a **written base rotation** in `rotations/<class>-<spec>.yaml` (key points, priority per hero tree for single target and AoE, opener and checks), built from Wowhead's rotation guide and the patch's SimulationCraft APL. The texts (key points, titles, tips and notes) are in Portuguese and English (`{ pt, en }`), like the boss rules' tips and messages. In the **Performance** tab, the player's log is read against it: efficiency (0–100), clear mistakes and tweaks, with the moment of each (▶ in the video), the opener and cooldown usage.

Check types: `proc` (a buff that must be spent, charge by charge — e.g. Precise Shots, Demonic Core), `requires_buff` (casts that need a buff, in AoE or always — e.g. Trick Shots only for those with the talent, Demonbolt with Demonic Core), `downtime` (time without casting, only while the raid was hitting: intermissions don't count), `cooldown` (uses vs. possible over the time alive; optional talents only count if used), `resource_waste` (capped resource, e.g. Maelstrom, Astral Power, Soul Shards; can count only cast generators, not automatic procs), `dot_uptime` (DoT on the target, e.g. Flame Shock), `aoe_swap` (with N+ targets the cast should be another, e.g. Chain Lightning) and `after_cast` (a cast that must come right before or after another, e.g. Demonic Tyrant with the Dreadstalkers out, Vanish followed by Garrote).

Specs with a rotation: **Marksmanship Hunter**, **Elemental Shaman**, **Balance Druid**, **Demonology Warlock**, **Arcane Mage**, **Havoc Demon Hunter**, **Assassination Rogue**, **Retribution Paladin**, **Arms Warrior**, **Shadow Priest**, **Unholy Death Knight**, **Devourer Demon Hunter**, **Destruction Warlock**, **Devastation Evoker**, **Beast Mastery Hunter** and **Affliction Warlock**.

### Generating a spec's rotation

No handwriting and no AI: `scripts/rotation.mjs` builds the YAML from SimulationCraft's APL and spell data and calibrates it on the Warcraft Logs tops' logs.

1. `node scripts/rotation.mjs tops <spec>`: downloads the 2 best parses of each raid boss (without external buffs), only with the player's events. Uses the `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` environment variables.
2. `node scripts/rotation.mjs calibrate <spec>`: generates the draft and runs it on the tops with the app's own engine.
   - **Priority:** from the APL, per hero tree, for single target and AoE.
   - **Ids:** from what the tops cast.
   - **Numbers:** cooldown, charges and cast time come from the SimC dump (or Wowhead's tooltip).
   - **Inferred checks:**
     - DoT, from `dot.X.refreshable`;
     - proc, from `buff.X.react` on a spell the buff modifies;
     - resource, from the spenders' cost;
     - cooldowns of 20s or more.
   - **Calibration from the tops:**
     - uptime and cooldown usage targets from what the tops do;
     - opener: what 70% of them cast in the first seconds;
     - drops what not even the tops meet (a proc spent by something else, a window buff, a cooldown not used on cooldown, a resource they cap too).
   - **Output:** written to `rotations/`; if a handwritten one already exists, it goes to `samples/rotation/` for comparison.
3. `node scripts/rotation.mjs check <spec>`: shows how the tops do on the current rotation, to validate a handwritten one.

The texts come out as templates ("X wasted: use it before it expires"), in both languages: review the key points before publishing.

## Interrupt assignments and dispels

In the **Interrupts** tab, paste the MRT/NSRT note (or write `Cast: Alice, Bob, Carol`, one line per add): the app checks cast by cast whose turn it was, who kicked, who covered and on which turn the cast went through — and the pull's verdict and Discord start pointing out who let it through. `dispel` rules measure the time until each debuff is dispelled and who was left without one. `phase_duration` rules time a phase where the boss is immune until the raid solves the mechanic (e.g. the Vitriolic Stasis puzzle on Entombed Sentinels): the Mechanics tab shows each one with its duration against the good time and the maximum, and the boss summary shows the phase pull by pull, with the best of the night and the times the raid died in it. Stacking-debuff rules with sources (e.g. Eternal Venom on The Twin Fangs) tell where every stack came from: they only blame whoever took an avoidable stack, and the boss summary shows the night's total per source and how many avoidable stacks each player took. `exclusive_auras` rules point out who picked up two auras that must not be held together (e.g. Mark of Acid and Mark of Blood on Entombed Sentinels, when someone gets near the other boss mid-fight); swapping sides after the intermission doesn't count.

## Positions

With Advanced Combat Logging, each death (before the cutoff) keeps where everyone was: the death details show a mini map, the distance to the boss and who was within 8 yards. Collective mechanic failures (e.g. the purple orb's detonation, Guillotine's Execution) also keep a snapshot of the moment, with whoever carried the orb highlighted.

## Progress

In the sidebar, **Progress** compares every saved night of a boss: best pull per night, the % of wipes where each mechanic was the trigger (to see whether the mistake is going down) and, per player, deaths per pull each night, what kills them most and how many of those deaths had a defensive left.

## Warcraft Logs

With a Warcraft Logs account, your guild's reports (unlisted ones too) show up in **New analysis**, next to the PC's logs; a link that's not on the list can be pasted at the bottom of the screen. Whatever is in a log on your PC comes from it; only what's missing is downloaded from Warcraft Logs (downloaded events stay on disk, to re-analyze without spending the API). Several people uploaded the same night? The reports become a single analysis, with one copy of each pull.

Paste the night's report link in the Warcraft Logs bar (it's saved for that log file). Each pull gets a button that opens the report already filtered to the boss and difficulty, with the try number as WCL shows it ("Wipe 13") — it also counts the short pulls the app ignores. This doesn't use the API or need a login; the API (with your own client) only comes in on the Performance tab.

## Warcraft Recorder

If you record your fights with [Warcraft Recorder](https://warcraftrecorder.com), set the folder where it saves the videos (**Settings → Warcraft Recorder videos**, or the **Videos** button at the top: paste the path or Browse…). It's saved in the app's `settings.json`, because it varies from PC to PC. Without it, the app tries to detect the folder from the Recorder's config (it only reads the path) and matches each video to its pull by boss and start time. The pull gets a **▶ Video** button and every death, trigger and mechanic event gets a **▶** that opens the video 5s before the moment.

**Guild videos (Recorder cloud):** in *Settings → Videos*, sign in with the Warcraft Recorder cloud account. The videos the guild uploads become other points of view of each pull: in the player, switch POV and the video keeps going from the same second.

## Layout

| folder | what |
|---|---|
| `crates/wipe-core` | combat log parser and pull analysis (Rust, no UI dependency) |
| `src-tauri` | desktop app (Tauri) exposing `wipe-core` to the UI |
| `src` | interface (React + TypeScript) |
| `encounters/` | per-boss rules (YAML), generated by the `boss-rules` skill |
| `data/` | editable tables: defensives per class, consumables |

## Development

Requirements: Node 20+, Rust (rustup) and MSVC Build Tools (Windows).

```bash
npm install
npm run tauri dev
```

Run only the analyzer, with no UI:

```bash
cargo run -p wipe-core --bin wipe-cli -- analyze path/to/WoWCombatLog.txt
```

## Versioning

Versions follow semver. Each big feature is closed in a release (`vX.Y.Z`) after it's approved.

## Automatic updates

The installed app looks for a new version when it opens (and every 6h): it reads the `latest.json` of the latest GitHub release, downloads the installer, verifies the signature and reinstalls itself. In the sidebar, "Check for updates" forces the check.

Publishing a version:

1. Bump the version in `Cargo.toml`, `package.json` and `src-tauri/tauri.conf.json`.
2. `npm run release:build` — a build signed with the private key in `~/.tauri/wipe-cause.key` (outside the repo; without it you can't publish updates, keep a backup).
3. `node scripts/release.mjs notes.md` (with `## Português` and `## English` sections) — generates `target/release/upload/` with the installer and `latest.json` and prints the `gh release create` command to publish both.
