<p align="center">
  <a href="https://github.com/keter45/wipe-cause/releases/latest/download/WipeCause_x64-setup.exe"><img src="https://img.shields.io/github/v/release/keter45/wipe-cause?style=for-the-badge&label=Download%20for%20Windows&logo=windows&logoColor=white&color=d4a54a" alt="Download for Windows" height="40"></a>
  <a href="https://keter45.github.io/wipe-cause/"><img src="https://img.shields.io/badge/Use%20online-no%20install-4cc38a?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Use online, no install" height="40"></a>
</p>

<p align="center">
  <img src="app-icon.svg" width="96" alt="Wipe Cause">
</p>

<h1 align="center">Wipe Cause</h1>

<p align="center">
  <b>Turn the next pull into progress.</b><br>
  See what caused the wipe, replay the mistake and know what to fix before the next pull.<br>
  Raid analysis for your guild. Personal coaching for your character. All from your WoW combat log.
</p>

<p align="center">
  <a href="https://github.com/keter45/wipe-cause/releases/latest"><img src="https://img.shields.io/github/v/release/keter45/wipe-cause?label=version&color=d4a54a" alt="Latest version"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows" alt="Windows 10 and 11">
  <img src="https://img.shields.io/badge/languages-English%20%C2%B7%20portugu%C3%AAs-4cc38a" alt="English and Portuguese">
</p>

<p align="center">
  <a href="https://github.com/keter45/wipe-cause/releases/latest">What's new</a>
  &nbsp;·&nbsp;
  <a href="README.pt-BR.md">Português</a>
</p>

<p align="center">
  <a href="#see-it-in-action">See it in action</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="docs/USAGE.md">User guide</a> ·
  <a href="docs/CONTRIBUTING.md">Contribute</a>
</p>

![Current replay of The Coiled Altar with the arena, ghosts, damage meter, raid frames and timeline](docs/screenshots/en/replay-overview.webp)

<p align="center"><i>Replay the fight, find the mistake and bring the fix to the next pull.</i></p>

## See it in action

### The whole fight, on the map and timeline

Follow players in the arena alongside frontals, areas, orbs and ghosts from boss mechanics. Raid frames show health and debuffs; meters track damage and healing. Select a player on the map or in the frames to investigate what happened to them.

Navigate phases, deaths and failures, or expand the individual mechanic lanes. Click a mark to jump to the event, zoom the timeline and replay the moment at the speed you need.

![Replay timeline with phases, deaths and individual mechanic lanes](docs/screenshots/en/replay-timeline.webp)

### From the mistake to a clip for your raid

Choose the start and end of the moment, adjust the camera and export an **animated WebP** with the whole arena or a player in focus. In Live mode, the app can also send the wipe clip to Discord.

<p align="center">
  <img src="docs/screenshots/en/replay.webp" alt="Ten-second replay clip focused on Kaelis during the ghost mechanic" width="640">
</p>

### Understand deaths. Fix mechanics.

See the killing blow, active debuffs, healing received and defensives left unused. Each mechanic shows who missed it, how often and what to do differently.

<details>
<summary>See the pull diagnosis</summary>

![Pull analysis showing the wipe trigger, mechanic mistakes and the players involved](docs/screenshots/en/pull.webp)

</details>

![Death breakdown with damage, healing, debuffs and player position](docs/screenshots/en/death.webp)

![Mechanic failures with the players involved and advice](docs/screenshots/en/mechanics.webp)

### Make every raid night count

Find your best pull, recurring wipe causes and downtime. Track the mechanics your group is working on, pull by pull, and compare progress across saved nights.

![Boss summary with best pull, top wipe cause and progress across attempts](docs/screenshots/en/boss.webp)

![Group metrics showing mechanic failures across pulls and each player's contribution](docs/screenshots/en/metrics.webp)

### Improve your own play

Switch to **Solo** for a personal review: rotation, cooldowns, survival and your most costly mistakes. Compare with top players of your spec on the same boss. For healers, review healing and cooldown coverage against references from other guilds.

![Solo mode showing a character's performance, survival and priorities for the next pull](docs/screenshots/en/solo.webp)

### Bring the review to Discord

In **Live** mode, see the analysis between pulls and automatically send the wipe card and replay clip to your raid channel. Share pull, boss and night summaries as images, HTML or PDF.

![Shareable pull summary with the wipe cause, decisive deaths and key mistakes](docs/screenshots/en/share.webp)

| Also included | What it helps you do |
| --- | --- |
| **Warcraft Logs** | Bring together local logs and guild reports; download missing pulls. |
| **Warcraft Recorder** | Open the video at the mistake and switch between guild POVs. |
| **Interrupts and dispels** | Review missed kicks, assignments and dispel timing. |
| **Ask the AI** | Ask questions using the pull's deaths, mechanics and notes as context. |
| **English and Portuguese** | Switch the interface, analysis and share cards together. |

## Get started

**[Download for Windows](https://github.com/keter45/wipe-cause/releases/latest/download/WipeCause_x64-setup.exe)** or **[open in your browser](https://keter45.github.io/wipe-cause/)**.

1. In WoW, enable **Advanced Combat Logging** under *Options → Network* and type `/combatlog` before raiding.
2. Open your log in Wipe Cause. The desktop app usually finds the WoW logs folder automatically; in the browser, drop `WoWCombatLog.txt` onto the page.
3. Pick a night, a boss and a pull. Connect Warcraft Logs to bring in your guild's reports.

The desktop app adds live monitoring, Warcraft Recorder videos, automatic Discord posts and automatic updates. **The browser runs the same analysis locally**, with no install.

To link straight to a pull, add the Warcraft Logs report and fight: `https://keter45.github.io/wipe-cause/?report=<code>&fight=<id>` (Warcraft Logs has to be connected; without `fight` it opens the night summary).

<details>
<summary>Windows installation notice</summary>

On first launch, Windows may show “Windows protected your PC” because the app does not yet have a paid signing certificate. Choose **More info → Run anyway** to continue.

</details>

Your combat log is analyzed on your PC. Optional integrations connect to their own services; **Ask the AI** sends the pull context, including player names, to your chosen provider.

Need setup details or want to contribute? Read the **[user guide](docs/USAGE.md)** or **[development guide](docs/CONTRIBUTING.md)**.
