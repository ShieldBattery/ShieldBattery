# Local bot play: designer brief

September 21, 2026. This is a handoff for exploring ShieldBattery desktop app mockups,
not a description of a shipped feature. It summarizes the agreed product direction
and distinguishes it from proposed interactions and unresolved decisions.

The goal is to help newer and less competitive players build confidence and find a
way into the StarCraft scene. Let them practice against opponents of a meaningful
human-comparable skill level, with no queue and no pressure to play actual humans.
Players can choose a specific bot for a one-off game or build their own practice
matchmaking pool and let the app pick the matchup.

Download a bot once, then keep playing against it locally even without internet
access. People developing bots should also be able to use their own local builds.

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

## Two ways to play

Both are part of the intended local-play experience:

- **One-off game:** choose any compatible bot directly and configure the match.
  A player's rank must not restrict which bots they can choose.
- **Practice matchmaking** (working name): choose a map pool and a set of potential
  opponents, then let ShieldBattery pick a map, bot, and valid bot race and start a
  local 1v1. Opponent identity is hidden by default. This offers the rhythm and
  uncertainty of matchmaking without waiting in a queue or playing a human.

The bot's human-comparable rating helps the player choose opponents in either flow;
it is not a gate or a requirement to match only opponents near their own rating.
The randomized flow selects one bot per game. Multiple-bot games remain available
through the separate custom setup direction.

### One-off journey

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

### Build your own practice matchmaking

The intended flow is:

1. **Choose a map pool.** Pick individual maps or use the current ShieldBattery map
   pool. Allow saving a custom map pool as a named preset and loading it later.
2. **Choose potential opponents.** Select a set of bots from the available collection
   or supported local builds. Show enough skill/race information to build a useful
   practice pool. The set can include opponents of any strength.
3. **Choose identity visibility.** Anonymization is on by default. The player can
   instead choose to know which bot was selected.
4. **Play.** One action selects a compatible map, one selected opponent, and a race
   that opponent supports, then starts the game. There is preparation time, but no
   matchmaking queue or wait for another player.
5. **Play again.** Retain the pool/settings and draw another matchup without rebuilding
   the setup. Keep a way to switch to direct one-off selection.

Keep the human's own race/settings available as part of setup; randomizing the bot
must not silently change them. Selecting a concrete supported race for a multi-race
bot does not require that bot to support StarCraft's Random race setting.

The normal action should read like **Play** or **Start practice**, not **Join queue**.
Show real launch preparation rather than a simulated search or fabricated wait.
Exact names and layout are for design exploration.

**Pool readiness:** validate the selected map/opponent combinations before drawing.
Explain missing downloads, runtimes, or compatibility restrictions without spoiling
which opponent will be chosen. Never select a known-invalid map/bot/race combination,
silently add an unselected opponent, or silently replace a saved bot release. If no
valid matchup exists, explain how to fix the pool. If only part of a pool can be used,
show that explicitly and let the player resolve it or accept the reduced pool before
starting. The random weighting and repeat-avoidance policy are still open; the UI
should not promise equal odds until that policy is defined.

**Presets and the current map pool:** a saved custom pool must be reusable across
sessions and usable offline when its maps are installed. Using the current
ShieldBattery pool needs a clearly identified pool (including which matchmaking
format, if relevant). A cached official pool can support offline practice, but label
it as the last downloaded pool rather than claiming it is current. Explain changes
and missing maps when refreshing an official pool. Whether an official-pool selection
follows updates or saves a snapshot, and whether presets also save opponents and
anonymity settings, are open decisions. Named custom map-pool presets are required.

### Anonymous opponents and replay identity

Anonymization hides which selected bot was drawn during the live match; the user
still knows the candidate set they chose. Use an anonymous opponent name in-game.
Do not leak the drawn identity through loading/launch screens, status messages, or
other normal live UI. Avoid presenting a selected bot's identifying portrait, author,
or exact rating before an anonymous match. This is practice presentation, not a
promise that a player cannot infer a bot from its strategy or chosen pool.

When anonymization is off, show the chosen bot normally. In either mode, the saved
replay must retain the bot's real identifier, and enough version/race context to
identify the opponent when reviewing the game. The anonymous display name must not
replace that recorded identity or create a fresh learning history on every match.
The replay viewing/list experience may reveal the real opponent; concealment applies
to live play. Whether the post-game result screen automatically reveals the bot or
waits for a **Reveal opponent** action is open for design exploration.

Error recovery and replay saving must preserve the same identity contract. Detailed
diagnostics can contain real identifiers, but keep them behind an explicit action
rather than showing them in routine anonymous-mode status text. Bot-provided chat
and overlays also need an engineering check for identity leaks. Normal in-game race
visibility/fog rules still apply; anonymity is about the bot's identity.

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
| Strength                  | SB division/rating where calibrated, with provisional and unrated states           |
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

**Human-comparable strength is a product goal.** We want bots to have skill ratings
in ShieldBattery's human rating system so a newer player can choose an appropriate
challenge. Explore the familiar ranked division indicator as the primary shorthand,
with rating details where useful. Explain that it describes the bot's estimated
playing strength, not a ranked match or a change to the player's own MMR. When a
player's rating is available, comparison can help, but choosing opponents must also
work without a player rating or an online lookup.

The measurement/calibration method is not decided, and no calibrated bot ratings
exist yet. Do not directly convert bot-versus-bot tournament Elo into human MMR.
Design rated, provisional/estimated, and not-yet-rated states, keeping uncertainty
clear without burying the useful comparison. An unrated bot remains selectable.
Mockup division/rating values must be labeled as illustrative until measured.

Ratings should describe the relevant bot release and race; do not imply all races
of a multi-race bot are equally strong. How maps, source patches, and persistent
learning affect calibration needs definition. Raw tournament ratings can remain
secondary detail with their source, date, and version caveat.
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
the map and opponents again. If one bot fails to start, offer retry, replacement,
or removal where the remaining setup is valid. Identify it in direct-selection mode;
in anonymous practice, keep the drawn identity hidden in routine failure messages
and make pool-level recovery or an explicit reveal/details action available.

Only the human's game should appear. On normal game exit, cancellation, or app failure,
background bot workers must stop. Cleanup should be automatic; users should never
have to find hidden StarCraft processes in Task Manager.

A mid-game bot crash must have an explicit outcome; never silently substitute the
built-in AI. The choice between ending the match and continuing with the failed bot
marked as defeated is unresolved, especially for several-bot games. Show a concise
explanation and make diagnostics available after returning to the app.

A proposed return flow preserves the setup and offers **Play again** and **Change
opponents**. For practice matchmaking, **Play again** draws a new matchup from the
retained pools; a direct rematch is a separate possible action. Preserve the anonymity
choice, with post-game identity reveal behavior to be designed. Replays/results are
local, with no ranked MMR impact; replays retain the bot's real identifier. The
presentation of local results/history and whether it uses an existing screen are
open design choices.

## Mockups requested

Prioritize a connected flow over a large collection of unrelated screens:

1. Entry into local play with clear paths for practice matchmaking and one-off games.
2. Practice setup: custom/current ShieldBattery map pool, named map-pool presets,
   multiple candidate opponents, anonymity on by default, and a single Play action.
3. Bot selection with human-comparable division/rating indicators and provisional or
   unrated variations; retain direct selection of any compatible bot.
4. Anonymous launch and in-game opponent name, an identified-opponent variation,
   and replay browsing with the real identity. Explore post-game reveal and playing
   another randomly selected matchup.
5. A one-off setup with one opponent, plus a multiple-bot variation; bot details with
   attribution, modification disclosure, and installation actions.
6. Pool readiness/download flow, including missing Java, incompatible combinations,
   a recoverable download failure, and a pool with no playable matchup.
7. Offline return visit with installed bots and saved map presets, a cached official
   map pool, and the first-use/no-catalog empty state.
8. Bot management showing an available update, retained learning, and reset confirmation.
9. Custom-bot import/refresh with a readable compatibility error and access to logs.
10. Launch preparation/cancellation, a bot startup failure, and return from a completed
    game with a quick route to play again.

Prioritize a polished practice-matchmaking happy path plus the direct-selection
alternative, with variations for these states; no need to fully style every error
as a separate screen. Use the existing ShieldBattery visual language. Status and compatibility must be understandable without relying on color
alone, and the picker/setup should remain usable with keyboard navigation.

The main design questions are placement, human-comparable skill presentation,
map-pool/preset management, anonymity and post-game reveal, and how library management
connects to both ways of playing. Keep offline readiness understandable without making
the user wade through implementation details. Leave room for bots in future online
lobbies, but avoid exposing hosting, ladder eligibility, or tournament
administration controls in this local-play flow.

## Background references

- [Local bot product/engineering plan](local-bwapi-bots-plan.md)
- [Catalog and offline installation contract](https://github.com/ShieldBattery/robotics-facility/blob/main/docs/catalog-and-offline.md)
- [Saved-state policy](https://github.com/ShieldBattery/robotics-facility/blob/main/docs/source-review-and-state.md)
- [Licensing and modification disclosure](https://github.com/ShieldBattery/robotics-facility/blob/main/docs/licensing-and-attribution.md)

These provide engineering context. Infrastructure, catalog signing, storage providers,
process architecture, and build tooling are intentionally outside the normal user flow.
