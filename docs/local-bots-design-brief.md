# Local bot play: designer brief

September 21, 2026. This is a handoff for exploring ShieldBattery desktop app mockups,
not a description of a shipped feature. It summarizes the agreed product direction
and distinguishes it from proposed interactions and unresolved decisions.

The goal is to let someone choose interesting StarCraft AI opponents and play against
them locally, with as little setup as possible. Download a bot once, then keep playing
against it even without internet access. People developing bots should also be able
to use their own local builds.

## Scope and priorities

**Current product direction:** local games with one human and one or more BWAPI bots,
a curated downloadable collection, and a bring-your-own-bot path. The human plays in
a normal visible StarCraft: Remastered game. Everything needed to run the opponents
stays in the background: no extra game windows, focus stealing, or bot audio. Leaving
the game shuts down its bot processes automatically.

**Later:** add bots to networked custom-game lobbies. Where those bots run (the lobby
host's PC or our servers) has not been decided. Later still, allow approved bots to
play ranked matchmaking against humans who explicitly opt in. Neither online feature
needs a full mockup in this first pass. Local games do not affect ranked MMR.

The bridge has development demonstrations with ZZZKBot and UAlbertaBot, but there is
not yet a finished local game flow or an approved downloadable collection. Use bot
names/data as illustrative content, not promises of launch availability. In
particular, do not treat tournament ratings as verified ratings of our packages.

## Main journey

The proposed journey is:

1. Enter local bot play from the desktop app.
2. Choose a map and game setup, then add one or more bot opponents.
3. Browse available bots or choose an installed/custom bot. Inspect details if useful.
4. Download any missing bot packages and resolve prerequisites such as Java.
5. Confirm compatible races and settings, then start the game.
6. Play in StarCraft. Return to ShieldBattery when finished, with opponents cleaned up.

Players who already have everything installed should be able to go straight from
setup to play. Downloading and account/server availability must not become mandatory
steps for every game.

**Placement is open.** A "Play locally" entry, a mode within game creation, and a bot
library reachable from setup are possibilities. We have not committed to a new
navigation section, a modal picker, or a standalone store. Explore placement within
the existing app, keeping the shortest path to a repeat game clear. The local flow
must remain reachable when the app cannot contact ShieldBattery services; the exact
signed-out/offline entry treatment needs design and engineering alignment.

## Selecting opponents

Aim for a collection with meaningful variety: races, play styles, and strengths.
The picker should help answer "Who would be fun/useful to play against?" and "Can I
play against this bot right now?"

The information hierarchy below is a proposal for the mockup, not a fixed card layout.

| Information               | Suggested treatment                                                                |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Bot name                  | Primary identity; distinguish a bot from a human and StarCraft's built-in computer |
| Supported races           | Prominent race icons/text; these constrain selection                               |
| Play style                | Short description or a few meaningful tags, when known                             |
| Strength                  | A readable indication, with an honest unknown/uncalibrated state                   |
| Availability              | Installed/ready, needs download, or needs setup                                    |
| Author                    | Visible attribution, with full details available                                   |
| Game-format compatibility | Relevant to the current setup; details on request                                  |

Suggested browsing tools: search by name, filter by race, and quickly show installed
bots. Skill and play-style filters are useful only once the data can support them.
Only approved downloadable releases belong in the public collection; internal
source-review and licensing queues are not user-facing catalog states. Avoid a
generic "verified" badge that could conflate distribution approval, compatibility,
and future ladder eligibility.

These controls should scale to a substantial collection without making the initial
small catalog look empty or complicated.

**Strength is not settled.** We have bot-versus-bot tournament Elo, which is not
ShieldBattery human MMR. Do not display it as a predicted human rank or invent
calibrated "easy/medium/hard" labels. Explore qualitative labels or relative bot
strength with an explanation; until evidence exists, "Not yet calibrated" is a valid
state. Raw tournament ratings can live in details with their source, observation
date, and version caveat. Saved learning and our patches may also affect strength.
There is no agreed universal difficulty slider for an individual bot.

## Game setup and compatibility

Use familiar map/player-slot/race concepts. Each bot slot should make its identity
and selected race obvious and allow the player to replace or remove it. How much
version information belongs in the slot versus details is a design choice.

- Supported races are a hard restriction. A one-race bot cannot be assigned another
  race. Only offer Random when the selected package explicitly supports it.
- Format support needs nuance: tested, experimental, untested, and known incompatible
  are different states. Untested team/free-for-all play can carry guidance rather
  than a blanket prohibition. Known incompatibilities, including opponent-count or
  map restrictions, must prevent an invalid start with a clear explanation.
- Several bots is part of the short-term goal. Do not assume every bot handles teams
  or several opponents. Bot-count limits and performance guidance await testing;
  do not promise a specific maximum or imply hidden bots consume no resources.
- Starting requires a local map, a usable StarCraft installation, installed bot
  packages, and any required runtimes. Explain the particular missing prerequisite
  and provide the next action without clearing the rest of the setup.

**Open:** whether the first exposed setup includes teams/free-for-all, repeated copies
of the same bot, or built-in computer opponents alongside BWAPI bots. These are
separate from the agreed goal of supporting multiple local bots. Bot-versus-bot
spectating is also a possible follow-up, not a confirmed first-release requirement.

## Downloads, installed bots, and offline use

Keep "available in the catalog" distinct from "installed on this PC." An installed
bot is not necessarily ready if its runtime or other prerequisites are missing.
An available update does not make a working installed version unplayable.

| State                      | Interaction the design should cover                          |
| -------------------------- | ------------------------------------------------------------ |
| Available, not installed   | Download action and useful size information                  |
| Downloading/installing     | Progress; proposed cancel action; keep the game setup intact |
| Checking the download      | Brief preparation/verification state before Ready            |
| Installed and ready        | Select for the game immediately                              |
| Installed, missing runtime | Explain what is missing and offer setup actions              |
| Download/install failed    | Explain failure, retry, and allow choosing another bot       |
| Update available           | Explicit update action; existing version remains selectable  |
| In use by a game           | Prevent removal/reset of resources currently in use          |

Show cached catalog entries and installed bots immediately. Refresh in the background
when online, with a manual refresh option. A failed refresh should leave the last
usable list in place; it must not block playing an installed bot.

Offline, emphasize what the player can use. Cached but uninstalled entries may remain
visible with "Download requires internet." If there is no cached catalog, show the
installed/custom collection and explain that browsing more bots needs connectivity.
Offline play also needs downloaded maps and installed runtimes; an offline badge on
a bot alone must not promise that the whole game setup is ready.

Updates are explicit and must not silently change an existing game setup's selected
version. If an update fails, retain the previous usable install. Removing a bot from
the public catalog must not silently delete it or its learning from the user's PC.
Advanced version management can be tucked away; a version browser is not established
as a primary screen requirement.

## Bot details and attribution

Details should help someone choose a bot, understand a limitation, or manage an
installation. They may be a panel, page, or dialog. Include:

- Description, supported races, play style, strength context, and tested formats.
- Author(s), upstream project, selected package version, and relevant requirements.
- Whether it learns between games, with access to the saved-data controls below.
- Contextual actions: download, select, update, remove, or resolve missing setup.
- Accessible full licenses/notices and exact source/change links for that release.
- A clear modification notice when ShieldBattery or another downstream maintainer
  changed the bot, with a short summary; preserve credit to the original authors.

Installed license texts and modification summaries must be readable offline. Details
must describe the selected installed version, even if a newer catalog version exists.
The display must distinguish bot changes from changes only to a bundled dependency.
The release process separately handles the source-delivery and notice obligations;
placing a license name in the UI is not the whole compliance process.

## Learning and saved data

Some bots learn from previous matches; others only save results, or have no persistent
state. The UI should describe the actual behavior instead of giving every bot an
identical "learning" setting.

Keep learning across compatible bot updates. A version change should not silently
make an experienced opponent start fresh. If a new version cannot use the old data,
explain that and offer a fresh history while preserving the old one, or let the user
keep playing the old version. A failed data migration must preserve prior history.

Offer **Reset learning** for adaptive bots, or **Clear saved results** when that is
what is actually stored. Explain the effect and confirm before deletion. Reset means
returning to the bot's packaged baseline, which may contain initial training data;
it does not promise identical decisions in every match. Reset is separate from
uninstalling a bot. Removing an executable should preserve learned data by default;
any action deleting saved data must be explicit.

The default experience should not require users to understand internal "profile IDs."
One persistent history per local owner and bot is the working starting point. Multiple
named histories or a one-match fresh-state option are optional design explorations.
How simultaneous copies of a learning bot behave needs resolution; do not promise
shared learning without a defined policy. Reset must be unavailable while that
history is being used, with an explanation rather than a silent failure.

## Java and custom bots

For Java bots, detect a compatible installed runtime. If one is missing or unsuitable,
explain the required version and offer an appropriate installer link, then a way to
check again. An advanced option can select an existing Java installation for that
bot. Avoid making ordinary users reason about Java paths or machine-wide settings.
Downloading/bundling a managed Java runtime is not yet decided.

**Bring your own bot** is for bot developers and people with a supported local build.
Provide an import/select-local-build entry separate enough that it does not clutter
the normal curated flow. The precise supported import format is an engineering
contract still to be finalized; do not imply every BWAPI DLL/EXE/JAR can run unchanged.

Show the local bot's identity, supported configuration, readiness, and any actionable
validation/startup error. Make local provenance apparent without presenting it as a
reviewed catalog release. Developers should be able to replace or refresh their build
between games and see useful logs, without publishing it or registering an online
bot account. Diagnostics belong behind a details action rather than in normal setup.

## Starting, finishing, and failure

Launch can take time, especially with several bots. Show a meaningful preparing state
and allow cancellation. Preserve setup on failure so a retry does not require choosing
the map and opponents again. If one bot fails to start, identify it and offer retry,
replacement, or removal where the remaining setup is valid.

Only the human's game should appear. On normal game exit, cancellation, or app failure,
background bot workers must stop. Cleanup should be automatic; users should never
have to find hidden StarCraft processes in Task Manager.

A mid-game bot crash must have an explicit outcome; never silently substitute the
built-in AI. The choice between ending the match and continuing with the failed bot
marked as defeated is unresolved, especially for several-bot games. Show a concise
explanation and make diagnostics available after returning to the app.

A proposed return flow preserves the setup and offers **Play again** and **Change
opponents**. Replays/results are local, with no ranked MMR impact. The presentation of
local results/history and whether it uses an existing screen are open design choices.

## Mockups requested

Prioritize a connected flow over a large collection of unrelated screens:

1. Entry into local play and setup with one opponent, plus a multiple-bot variation.
2. Bot picker/library showing a useful mix of installed, downloadable, and unavailable
   choices, and a bot detail view with attribution and modification disclosure.
3. Download-to-ready flow, including missing Java and a recoverable download failure.
4. Offline return visit with installed bots, plus the first-use/no-catalog empty state.
5. Bot management showing an available update, retained learning, and reset confirmation.
6. Custom-bot import/refresh with a readable compatibility error and access to logs.
7. Launch preparation/cancellation, a bot startup failure, and return from a completed
   game with a quick route to play again.

One polished happy path with variations for these states is sufficient; no need to
fully style every error as a separate screen. Use the existing ShieldBattery visual
language. Status and compatibility must be understandable without relying on color
alone, and the picker/setup should remain usable with keyboard navigation.

The main design questions are placement, how to communicate strength honestly, how
library management connects to match setup, and how to present offline readiness
without making the user wade through implementation details. Leave room for bots in
future online lobbies, but avoid exposing hosting, ladder eligibility, or tournament
administration controls in this local-play flow.

## Background references

- [Local bot product/engineering plan](local-bwapi-bots-plan.md)
- [Catalog and offline installation contract](https://github.com/ShieldBattery/robotics-facility/blob/main/docs/catalog-and-offline.md)
- [Saved-state policy](https://github.com/ShieldBattery/robotics-facility/blob/main/docs/source-review-and-state.md)
- [Licensing and modification disclosure](https://github.com/ShieldBattery/robotics-facility/blob/main/docs/licensing-and-attribution.md)

These provide engineering context. Infrastructure, catalog signing, storage providers,
process architecture, and build tooling are intentionally outside the normal user flow.
