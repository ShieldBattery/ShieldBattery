import { AutoSizeImage } from '../dom/auto-size-image'
import { makePublicAssetUrl } from '../network/server-url'

export interface StaticNewsFeedEntry {
  date: number
  title: string
  summary: string
  contents: string
}

const LARGE_IMAGE_WIDTH = 1600
const SMALL_IMAGE_WIDTH = 800

const NEWS_IMAGE_PATH = '/images/static-news/'
const NEWS_IMAGES: ReadonlyArray<string> = [
  'ashworld0',
  'badlands0',
  'space0',
  'ice0',
  'jungle0',
  'space1',
]

export const STATIC_NEWS_ENTRIES: ReadonlyArray<StaticNewsFeedEntry> = [
  {
    date: 1639569600000,
    title: 'Version 8.0.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **2v2 matchmaking.** Team matchmaking is finally here! Our matchmaker can now handle matching up
        teams of 2, either with parties or creating teams from solo players. Ratings are calculated
        similar to 1v1, with each player in the team getting their own rating value. Our ladder page has
        also been updated to let you see the latest rankings for the 2v2 mode.
      - **It's a party!** You can now invite up to 7 other people to join your party by right-clicking
        their name in chat. Parties get their own private chat area, and are able to queue up together for
        team matchmaking. In the future, parties will allow you to watch replays together and easily
        create private custom lobbies.
      - **Profile improvements.** The popup displayed when you click someone's name in chat has been
        improved to show a bunch more info at a glance: account creation date, win/loss record, ranks and
        more! We also split the useful user actions into a separate menu which you can find by
        right-clicking someone's name.
      - **Game results page.** Game results pages now subscribe to live updates, so you'll always see the
        latest version with up-to-date results, even if you left the game early. The page also properly
        divides players into teams when necessary, and shows MMR changes for each player in ranked modes.
        If you're arriving at the page by completing a ranked game, there's also a snazzy new button to
        search for another match right from the page.
      - **Better message notifications.** Whisper, lobby, and party messages will all qualify as "urgent"
        now, displaying the red icon and flashing the window's taskbar entry. We've also added a sound for
        these cases (as well as when someone mentions you) to make things more noticeable. Settings for
        controlling when these sounds should play are coming in the near future, although you can control
        the volume of these sounds in the App settings today.
      - **Auto-updater improvements.** The auto-updater should now download updates faster for users not
        near our main server.
      - **Bug fixes and polish.** We put tons of bug fixes and polish into this release, including but not
        limited to: a fix for game crashes caused by checking or unchecking the Vsync setting checkbox,
        corrections to game result calculation in games with alliances, improved latency when performing a
        ton of actions in the standalone client (sending chat messages, for instance), and added sounds
        for performing certain actions (like entering the matchmaking queue).

      ##### Known Issues

      - **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
        launched from their launcher once every 30 days to keep premium features enabled. We'll at the
        very least add a warning for this case in the future (or better yet, automate re-authing), but
        for now, try to launch the game from the Blizzard launcher at least once a month.
      - **Off-center screen starting position.** For some users, generally in positions on the right side
        of the screen, the starting screen position may be slightly off-center from where it usually is
      - **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
        fixed in a future update.
    `,
  },
  {
    date: 1639742400000,
    title: 'Version 8.0.1 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Fixed ally chat.** Ally chat should now be working in ranked 2v2 games. And if you never
        realized it was broken, well, it was! Your ally wasn't ignoring you! Probably.
      - **UI tweaks.** We've tweaked a bunch of interfaces to smooth over some things people were
        confused about: party queues, race selection, readying up for a found match, and more! Special
        thanks to everyone who has streamed themselves using ShieldBattery, it's been very helpful to see
        what you're finding hard to use!
      - **Bug fixes.** We've fixed a bunch of small and rare bugs, but for some people these are probably
        very important:
        - Fixed a rare crash when launching the standalone application
        - Fixed a crash on initializing the game if your Windows username contained non-latin characters

      ##### Known Issues

      - **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
        launched from their launcher once every 30 days to keep premium features enabled. We'll at the
        very least add a warning for this case in the future (or better yet, automate re-authing), but
        for now, try to launch the game from the Blizzard launcher at least once a month.
      - **Off-center screen starting position.** For some users, generally in positions on the right side
        of the screen, the starting screen position may be slightly off-center from where it usually is
      - **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
        fixed in a future update.
    `,
  },
  {
    date: 1644062400000,
    title: 'Version 8.2.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Improved netcode.** We've made a first pass at improving the netcode ingame. With this update,
        dynamic turn-rate will no longer be used for games (both matchmaking and custom lobbies). Instead,
        we're now using a system we call "auto-static turn-rate". When a match is starting, our servers
        will collect latency estimates from all players and pick a turn-rate that should work without lag.
        There are also a number of improvements under the hood to reduce latency and the negative effects
        of packet loss. Ingame, we've replaced the turn-rate indicator with an effective latency number:
        this number is the average time between sending an order (e.g. "move") and it being executed (e.g.
        "the units move towards that location").
      - **Fixed observer desyncs.** We've identified and fixed the main cause of desyncs in observer
        clients that have plagued SC:R events for years
        ([for one example](https://youtu.be/SRGyrxANxVo?t=2657)).
        If you find other cases of desyncs happening while observing games on ShieldBattery, please let us
        know!
      - **Shift-click to mention.** Added the ability to shift-click usernames on the chat screens to
        mention them in the message field. No more trying to figure out all the right characters in
        xXMLG_C0oLgUyXx's name.
      - **Auto-updater improvements.** Made the auto-update more resilient to application errors so that
        persistent errors won't require a complete reinstall. The update dialog will also display its
        download progress so you have an idea of how long things are going to take.
      - **Various UI improvements.** We've shortened the giant blue bar at the top of the screen to make
        more room for actual content (sorry if you liked it!). We also made usernames on the profile
        screen selectable, added improved tooltips to a few parts of the app, and improved the performance
        and visual clarity of file lists, such as the replay and map browser.
      - **Game result submission fixes.** We've fixed a rare bug that prevented some people from
        submitting results at the end of the game.
    `,
  },
  {
    date: 1652356800000,
    title: 'Version 8.3.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Main race in ladder rankings.** The ladder rankings now display a player's main race, detected
        based on all the games they have played during the season.
      - **Rankings search.** Tired of scrolling to the bottom of the rankings to find all of your
        not-so-talented friends? Fear not, you can now simply type their name into our snazzy new search
        box and filter the rankings down to just the matching accounts!
      - **Improved shortcut keys.** We've added a shortcut for opening the client settings (Alt + S), as
        well as starting a new whisper (Alt + W). There are also hotkeys for moving between tabs in any
        interface that has them (Ctrl + 1-9).
    `,
  },
  {
    date: 1654344000000,
    title: 'Version 8.4.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Seasons.** Rankings will now be reset periodically (exact schedule still TBD), with the first
        reset occurring shortly after this update. Thank you to everyone that participated in our beta
        season, and we'll see you in Season 1!
      - **New ranked system.** We've deployed a new ranked system based on Glicko 2, with tons of
        improvements from things we learned during our beta season. Our main goals are to encourage
        player activity throughout the season, to provide accurate and close matches even during the
        beginning of a season, and to make rankings feel earned. Players now have a _rating_ (MMR), used
        for finding balanced matches, and _points_ (RP), which are won or lost based on your performance
        and skill level. Points are reset to 0 each season and used for determining ladder rankings, while
        rating is carried across seasons. There is also a bonus pool that all players collect at a rate of
        400 points per week: this pool will be used to offset point losses, or double point gains (so it's
        in your best interest to play throughout the whole season so you receive all the bonus points!).
        We look forward to your continued feedback on this system!
    `,
  },
  {
    date: 1655121600000,
    title: 'Version 8.4.1 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Bug fixes.** We've fixed an issue that prevented the client from running on Windows 7, as well
        as issues with non-working shortcut keys and janky scrolling.
      - **Better rankings for ties.** Users that are tied for points will now be ranked by their MMR,
        rather than randomly sorted.
      - **Labeled searching.** The matchmaking search status in the navigation area will now display which
        matchmaking type you are queued for.
    `,
  },
  {
    date: 1656158400000,
    title: 'Version 8.5.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Ranked divisions.** We've added divisions to all ranked modes based on MMR, along with brand new
        icons for each. All divisions below the top one are split into 3 tiers. The top division,
        Champion, is reserved for the top 10 players by rank, provided they are above the minimum rating.
        You'll see these new divisions in all the places we show ranks: leaderboards, profiles, and user
        overlays.
      - **Placement matches.** Ranked modes will now assign users a rating after 5 placement matches,
        rather than immediately. This helps reduce confusion early on as you can bounce around different
        divisions very rapidly in your early games. Since we preserve MMR across seasons, placement
        matches will only need to be completed once per matchmaking type for the lifetime of an account.
      - **Updated colors for Protoss and Zerg.** We found the previous colors got a bit confusing with our
        positive/negative colors. Since we didn't want anyone to think we're playing favorites, Protoss is
        now yellow and Zerg is now purple.
      - **Tweaked ranked points target.** We've moved the ranked points target lower (from 4 times MMR to
        2 times MMR). This should help players arrive at the level that they begin losing points in fewer
        games, which should reduce confusion about the system.
      - **Refreshed Find Match screen.** The Find Match screen now shows information about your current
        ranked division and bonus pool size.
    `,
  },
  {
    date: 1664798400000,
    title: 'Version 8.6.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Friends and enemies.** We've built out a new friends list and added a way to block other user's
        chat messages. Friendships are mutual, so you'll have to get someone else to accept you before
        you'll be able to track them in your list. Blocking will only work in the application currently,
        we'll add further tools to manage ingame chat in the future.
      - **New game servers.** There's now better global server coverage for games with new servers in
        Montreal, Seattle, Chicago, Dallas, Miami, and Santiago. These are in addition to the many servers
        we already had, and should help improve latency and performance for anyone in those areas.
      - **More info for local replays.** The replay browser can now show info about game type, players,
        and more for local replays, so you can easily find the replay you're looking for. For replays of
        games played on ShieldBattery, it will also retrieve information about the map the game was played
        on.
      - **Rank change dialog.** After each ranked game completes, we now show a snazzy dialog to visualize
        your rank change, as well as let you queue up for another match or watch the replay.
      - **Adjusted rank progression.** The top rank (Champion) now has requirements similar to the ranks
        below it, and has had its max player cap removed. All players over 2400 rating will now be in the
        Champion division.
      - **Smurf detection.** Players queueing for matchmaking will now be checked against existing
        accounts, and anyone determined to be smurfing will have their rating adjusted accordingly. This
        should result in more accurate matches for and against players that swap to new accounts.
      - **And some small stuff:**
        - Fixed a bug that caused the starting screen position to occasionally be off-center when spawning
          on the right side of the map.
        - Message contents are now saved as you navigate throughout the app, so viewing someone's profile
          will no longer clear out that huge essay you were in the process of writing to your party
          members about their deficiencies in defending zergling pressure.
        - Players in observer slots are now once again bannable in lobbies.
        - Fixed selection circles not being visible when using the Carbot skin.
        - Removed the custom title from the StarCraft window. This _may_ require updating settings in your
          streaming programs if you are using window or game capture.
        - Disabled SC:R's global PrintScreen hotkeys, which were interfering with all PrintScreen presses
          as long as the game was running.
        - Fixed an issue with the Accept Match dialog sometimes staying up permanently if a match had
          failed to start.
    `,
  },
  {
    date: 1666872000000,
    title: 'Version 8.7.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Support for WINE.** Although not officially supported, the app is now able to run under WINE on
        Linux and launch games. If you'd like more details about how to get it working, check out the
        #development channel in our Discord.
      - **New season with tweaks to the rating system.** Alongside this update comes a new season and new
        map pools for 1v1 and 2v2. We've taken a look at how the rating system performed for Season 1, and
        made some adjustments:
        - Bonus pool reduced to **200** points per week (from **400**). We thought the bonus pool gain
          was too significant of a factor, especially late in the season, so this change should help to
          rein that in.
        - Point target increased to **MMR x 4** (from **MMR x 2**). This should help players spread out
          more within a division, and keep active players on the leaderboard more in order by division
          (so Champion players at the top, followed by Diamond, followed by Platinum, etc.).
        - Added an initial period of rapid point gain for wins for each player at the start of the season.
          This should bring players up to a point total appropriate for their division quickly, while
          still providing the benefits that come from using the point system (better anti-smurfing, more
          accurate matches at the beginning of seasons, etc.).
    `,
  },
  {
    date: 1679054400000,
    title: 'Version 8.8.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Unified lobbies**. The Create and Join Lobby actions in the sidebar have been combined into a
        single view. Click the shiny new Lobbies button to find the lobby list and access lobby creation,
        or continue to use the old hotkeys (Alt+C and Alt+J) for quicker access.
      - **Leagues.** We've been hard at work building a brand new way to compete, which we're calling
        Leagues. Leagues are limited-time events that require players to sign up to participate. Once
        signed up, any ladder games you play in the league's matchmaking type will also count towards
        the league's standings. Leagues are a great option for events that want to run ladder-based
        qualifiers. Stay tuned for some more announcements here! And if you're interested in running
        your own league, please reach out to us on our Discord.
      - **Public profiles and more.** We've made a number of pages that previously required login open to
        the public: user profiles, ladder standings, game results, and leagues.
      - **Copy link buttons.** As part of making some of these pages public, we've also made it easier to
        get links to them from within the app. Look for the link button near the top of the league or
        game results pages, and click it! These links work outside of the app, and are also convenient for
        sending to chat or whispers in the app.
    `,
  },
  {
    date: 1688126400000,
    title: 'Version 9.0.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Multi-language support.** We've added an initial version of supporting multiple languages within
        the app/website. Currently we have translations for: Chinese, Korean, Russian, and Spanish. Most
        of these translations are machine-generated and there are likely mistakes and problems! If you'd
        like to help contribute better translations, we've set up an easy process, just check out the
        [translation guide](https://github.com/ShieldBattery/ShieldBattery/blob/master/docs/TRANSLATION_GUIDE.md)
        on our GitHub! Please also let us know if you encounter any issues with non-English languages.
      - **Multiple chat channels.** We've turned on the ability for users to create and join new chat
        channels. If you wanted a channel for your tournament or clan, you're in luck! Just click the
        header in the navigation panel to find and create new channels.
      - **New observer/replay UI.** The built-in SC:R observer UI has been replaced with a custom new
        implementation. The SC:R version had a number of problems when loading through ShieldBattery, most
        notably just failing to load at all a lot of the time. The new UI should be snappier, always load,
        and allow us to build more cool features going forward. There are definitely some things missing
        at the moment, so please let us know if there's anything that's really important to you in this UI
        so we can focus on what matters.
      - **Revamped settings.** We've rebuilt our settings dialog into a full-screen experience to allow
        for better organization and give us space to add new settings for upcoming features. Alongside
        this, applicable settings will also be editable on the web version.
    `,
  },
  {
    date: 1690286400000,
    title: 'Version 9.1.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Open replay files.** ShieldBattery can now be registered to open replay (.rep) files for faster
        replay viewing. Replay files can also be dragged into the client for easy access.
      - **Updated translations.** Thank you to our contributors! If you'd like to help, please check out our
        [translation guide](https://github.com/ShieldBattery/ShieldBattery/blob/master/docs/TRANSLATION_GUIDE.md).
      - **Various bug fixes:**
        - Fixed race displayed on game results when a player chose random
        - Fixed an issue with the language selector not displaying an initial selection
        - The player search on the ladder page now works again
        - Fixed an issue with chat channels sometimes ending up in the wrong order
        - The "start minimized" option when launching the app on startup will now work properly
        - Fixed Korean language selection not working if it was manually chosen.
    `,
  },
  {
    date: 1691668800000,
    title: 'Version 9.2.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Improved ping estimation**. Ping estimation used for game server selection and ingame latency
        selection should now be more accurate. This means you're more likely to get a good server for you
        and every opponent, and will see less lag ingame.
      - **Added support for more vetoes in map pools**. We now support veto counts other than 3, which
        means we can have larger (or smaller!) map pools. Stay tuned for map pools making use of this
        feature.
      - **Bug fixes.**
        - Opening a replay in Explorer with ShieldBattery now works correctly if the app was not already
          running.
        - It is now possible to open a replay with ShieldBattery while logged out.
        - The app will now be brought into focus when a replay is opened.
        - The app controls should properly reflect the maximized state on launch now.
        - Fixed ban reasons not showing to users properly.
        - Fixed an issue causing race selection to immediately queue for matchmaking.
    `,
  },
  {
    date: 1693915200000,
    title: 'Version 9.3.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Replay/Observer UI improvements.** We've added hotkeys for showing/hiding various parts of the
        UI, so you can tailor your observing experience to just what you'd like to see. The hotkeys are:
        - **A**: Toggle all panels
        - **F**: Toggle production panel
        - **E**: Toggle player list
        - **W**: Toggle bottom UI
      - **New account settings page.** Account settings has now moved into the normal Settings area,
        instead of being under the user menu. The new page also presents a few settings that are not yet
        available, but will be soon! Stay tuned.
      - **Advanced lobby settings.** Lobbies now have two new advanced settings that can be configured:
        turn rate and unit limits. In general we recommend users leave these at the defaults, but if you
        have specific needs for particular maps and game modes, they're there now! Current settings for
        these will also be displayed while in a lobby.
      - **Bug fixes and small enhancements:**
        - Show morphing Zerg buildings correctly in replay/observer production view
        - Show minimap dialog buttons for changing player vision in replay/observer UI
        - Changed observer UI font and adjusted colors for better readability
        - Fixed a number of issues with submitted game results that caused incorrect or unresolvable
          games.
        - Made game results submit earlier in the game ending process so that game results can be
          resolved faster.
    `,
  },
  {
    date: 1705147200000,
    title: 'Version 9.4.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - Added a basic match history to user profiles (better filtering capabilities coming soon!)
      - Greatly improved Chinese translations. If you would like to help contribute translations for a
        non-English language, please reach out to us in our Discord!
      - Chat channels are more customizable, with the option to upload banners, badges, and set a channel
        description and topic
      - Improved StarCraft installation finder to use the Battle.net Launcher's settings. This will be
        the default for new users, but existing users can re-run the detection in Settings -> StarCraft.
      - Reversed the sort order of replays (auto-saved replays should be sorted newest first now). An
        improved UI with better sorting, searching, and filtering capabilities is coming soon.
      - Added in-client bug reporting. You can report bugs via the user menu in the bottom-left, which
        will automatically upload log files to our servers to help us diagnose the issue.
      - Improved lobby error screens
      - Fixed language detection to choose better default languages
      - Various bug fixes
    `,
  },
  {
    date: 1717761600000,
    title: 'Version 9.5.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - Fix a rare issue that made some users unable to download map files and silently fail to launch
        the game
      - Allow mouse scroll to zoom when above replay/observer UI elements
      - Fix hive and lair icons being swapped in replay/observer UI
      - Show supply numbers as red when over the max supply in replay/observer UI
      - Fixed an issue where some auto-saved replays contained a blank map name
    `,
  },
  {
    date: 1717848000000,
    title: 'Version 9.5.1 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - Fixed a bug that caused some users to be unable to play games or have slow network routes when
        one of the relay servers responded too slowly
    `,
  },
  {
    date: 1730116800000,
    title: 'Version 9.6.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Added a ladder and matchmaking for 1v1 Fastest.** In this mode, users choose which maps they would
        like to play from the map pool, and will only be matched against users with at least one of the
        same maps selected.
      - **Adjusted ranked divisions to be based on Ranked Points instead of Matchmaking Rating.** We've
        found that many people were confused by the previous system and how rankings work, so we made some
        changes. Everyone will begin the season in Bronze 1 and be able to rank up by winning games. Over
        the course of the season it will become harder to achieve and keep higher ranks. Matchmaking
        Rating is still used for matchmaking, and higher MMR players can achieve higher Ranked Point
        totals at a faster rate.
      - **Added a 7-day freeze for the bonus pool at the end of a ranked season.**
      - **Added a right-click menu to whispers in the navigation bar**
      - **Added user information to the whisper UI**
      - **Fixed issues with lobbies getting stuck when users leave during the countdown**
      - **Fixed an issue with unblocking users**
    `,
  },
  {
    date: 1730721600000,
    title: 'Version 9.7.0 released',
    summary: 'Check out the new features and changes.',
    contents: `
      - **Fixed an issue with users that never played games showing up in the ladder standings**
      - **Fixed an issue with certain lobby names not working correctly**
      - **Added a setting for the starting fog of war in non-UMS games**. This defaults to "Transparent",
        which was the previous behavior. The added settings are "Show Resources", which hides terrain but
        shows minerals and gas on the minimap, and "Legacy" which hides everything unexplored.
      - **Fixed the replay UI rapidly changing size in certain configurations**
    `,
  },
  {
    date: 1753243200776,
    title: 'Update 10.0.0',
    summary: 'A big redesign, pre-match drafts, and more!',
    contents: `
      This update is one our largest yet, containing over 6 months of work from 6 different
      contributors. We're excited to finally get this out there and hope you enjoy the new features
      and changes!

      Before we dive into what's new, I wanted to take a moment to mention how you can support
      further development of ShieldBattery. If you're enjoying the app and want to see it succeed
      and grow, please consider donating to the project if you're able. Our current monthly
      donations don't even cover half of our hosting costs, and we would love to do more, but that's
      tough without funding! So if you have some spare cash, we have a few different ways of
      accepting support:

      - [GitHub Sponsors](https://github.com/sponsors/ShieldBattery)
      - [Patreon](https://patreon.com/tec27)
      - [Ko-fi](https://ko-fi.com/tec27)

      Now, onto the changes!

      ## Brood War changes

      These tend to be rare, but we noticed a few things since our
      last release that seemed worth fixing.

      - **Fixed the mouse cursor being mis-sized when hovering over units with hardware cursor on.**

        This has been around since SC:R was released and it can really throw off your clicks when
        the mouse cursor is resizing all the time. So, now it'll stay the right size!

      - **Fixed a rare issue that caused workers to get stuck inside gas buildings permanently.**

        This was one we hadn't seen before, but relates to workers trying to mine gas while stacked.
        Anyway, it won't happen on ShieldBattery any more, so I guess you'll never see it now.
        Thanks to SgT.FaT for reporting this to us and sending us a replay!

      - **Increased the maximum FPS limit from 300 to 1000.**

        If you're trying to eek out every last nanosecond of reduced latency (or just have a 360hz
        monitor), SC:R's 300 FPS limit was a bit of a bummer. So, if you so desire, you can bump
        that limit up higher now in ShieldBattery's Video settings.

      ---

      ## General app

      - **Revamped design.**

        As you've probably noticed, the app looks way different now! We've spent a lot of time
        reworking the design to better support the kinds of features we're looking to add in the
        near future, and to make things work better on smaller screens. The app also allows you to
        do more while logged out or offline now (more work to come on that!).

      - **Greatly improved translations.**

        We went through all of our existing translations to check them for accuracy and consistency,
        and it turns out, a lot of them were neither accurate nor consistent! They should be a lot
        better in this version, but if you'd like to help us improve them further, we're always
        looking for more contributors!

      - **Signups are now app-only.**

        To help us better prevent abuse, signing up for an account will now require using the app.
        After you've signed up, you're free to log in on the web version, but you can also just do
        a lot more while logged out now!

      - **Map downloads.**

        There's now an option to download maps from the 3-dot menu on their thumbnails, so you can
        stop rummaging around in our application cache.

      - **News posts.**

        You're reading one right now! We hope to expand on this feature in the near future so we can
        keep you up-to-date with things going on. We've also added the ability to display urgent
        messages on the homepage in case we need to make a quick announcement, like if the server
        needs to restart for maintenance.

      - **Live games and active leagues.**

        We've added a list of games that are currently being played, as well as a list of active
        and upcoming leagues, to the homepage. We hope to one day have easy 1-click spectating of
        these games from here, but for now you'll just have to use your imagination.

      ---

      ## Game integration
      - **New loading screen.**

        We've moved the loading screen completely ingame, and placed a
        countdown at the very end of it to let you prepare to split your workers at blinding speed.
        This should be a much smoother experience in general, but it also required a lot of changes
        to the game launching code, so if you see any new problems, please let us know!

      - **Window position memory.**

        The game will now remember its last position and size in
        windowed mode. If you're a fullscreen user that likes playing on your non-primary monitor,
        stay tuned for a future update that will make the game remember that too!

      - **Exclusive fullscreen fixed.**

        Exclusive fullscreen should be once again… well, exclusive!

      - **Added /mute command.**

        You can now use \`/mute\` ingame to mute a player by name (and
        \`/unmute\` to undo this). While muted, you won't see any of their messages in chat. This
        will only apply for the duration of that game. If you decide you want to play in complete
        silence, you can also use \`/muteall\` to mute all the players in the game at once (and
        \`/unmuteall\` to undo this). We will be integrating blocks ingame in the near future if
        you want to permanently ignore someone.

      - **Better handling of Windows compatibility settings.**

        We've adjusted how we handle the Windows compatibility settings for the game executable, to
        better ensure the game doesn't launch with any weird settings. This should fix issues with
        launching the game when it is set to require administrator privileges.

      ---

      ## Matchmaking/Ranked

      - **Party mode shelved.**

        Womp womp. We know many people will be disappointed with this
        change, but we've found that party mode was not necessarily doing what we wanted it to in
        matchmaking. It was leading to a lot of unbalanced matches, and made the matchmaker very
        complicated to maintain and expand on (which makes it harder to add new matchmaking types!).
        We may add parties back in the future, but for now we want to try out a different approach…

      - **Pre-match drafts.**

        This is the different approach! For team modes, all players will enter
        a short draft phase just before the match starts, allowing each player to select a race in
        turn. You will be able to chat with your teammates during this phase, but not the enemy
        team, and see what your teammate has selected before they lock in. You won't know exactly
        who you're playing against, but you will know the map you're playing on. Our hope is that
        this brings a lot of the benefits of playing in a custom lobby while still letting the
        matchmaker find balanced games.

      - **Punishments.**

        A number of not-so-nice people have been abusing our goodwill lately and
        dodging matches they don't want to play just before they start. Since this negatively
        affects all the other players when it happens, we've added a feature to temporarily ban
        players who do this from using matchmaking. The first dodge is a warning, and bans will ramp
        up after that. If you behave for long enough, you'll reset back to the warning level.

      - **Relive the glory.**

        Ranks from past seasons will now be shown on user profiles, in case your lame friends didn't
        believe you actually hit Diamond 2 once. Just click on the Seasons tab!

      ---

      ## Lobby
      - **Blame game.**

        In the event the game fails to start, lobbies will now let you know who was to blame so you
        know exactly who to direct your ire at.

      ---

      ## Social
      - **Mention auto-complete.**

        After typing an \`@\` in chat, a smart popup will appear with a list of possible users to
        mention, so you can stop struggling to type out IiIllLLiI1 by hand.

      - **Collapsible sidebar.**

        You can now unpin the chat sidebar if you'd prefer it to go away after you use it, or
        collapse it to hide it entirely. If you're not a big talker, well, now you don't have to
        waste the space on it.

      - **You're no longer trapped in #ShieldBattery.**

        As much as we like having you there, you're now free to leave.

      - **More punishments.**

        We've added chat restrictions for users that don't get along well with others. Chat
        restrictions apply to all chat surfaces (channels, lobbies, drafts, and whispers) and
        apply ingame.

      ---

      Thank you for reading, and we hope you enjoy the latest version of ShieldBattery!

      — tec27 and the ShieldBattery team
    `,
  },
  {
    date: 1754369985085,
    title: 'Update 10.1.0',
    summary: 'Bug fixes, new cursor size features, monitor choice for fullscreen modes, and more!',
    contents: `
      Welcome back to another update! This one is a *bit* smaller than the last one, but still
      contains a bunch of things we think you'll enjoy. Let's dive in!

      ## Bug fixes

      Most of our bug fixes made it into the minor releases between 10.0.0 and now, but this update
      should still fix a few issues we've seen:

      - A complete overhaul of the matchmaking acceptance code to make things more reliable.

      - Fixes for the game freezing when resizing or changing between windowed/fullscreen mode
        during loading and countdown.

      - Fixed a potential issue with draft mode that causes races to prematurely lock.

      - Fixed issues with the chat sidebar when you had many channels/whispers open. It should now
        keep things sized properly and scroll as expected.

      ## New features

      - Added settings related to cursor size (check the Game -> Input settings). If you enjoy
        having one cursor smaller than all of the other ones for no good reason, you can enable
        legacy cursor sizing. If you just think all the cursors are too big or too small, you can
        now also adjust their size to your liking. Both of these options only apply with Hardware
        Cursor enabled (but you probably want that on anyway).

      - Added a setting to choose which monitor the game launches on when using fullscreen modes.
        This setting won't be remembered if you adjust it mid-game, so make sure you choose the
        correct monitor before you start gaming.

      - Added new actions when you right click in the chat view with text highlighted: Copy and
        Search with Google.

      ## Miscellaneous

      - We've reset the saved positioning of the app, so you may have noticed it was larger or
        smaller than you're used to.

      - We've added more detailed logging about CASC errors. If you're one of the people seeing
        these errors, please file another bug report the next time you see one.

      - We've modified the shape of chat and league badges to better differentiate them from user
        avatars.

      That's all for this update! As always, we hope you enjoy the new changes. If you'd like to
      support further development of ShieldBattery, please check out the donation links at the
      top of the home page!

    `,
  },
  {
    date: 1755591122914,
    title: 'Update 10.2.0',
    summary: 'The Anti-smurfing smurfing update.',
    contents: `
      For this update, we've focused on reducing the amount of smurfing on ShieldBattery. While we
      already had measures in place to ensure that MMR transfers between accounts of the same user,
      there have still been a number of users with 10s or even 100s of accounts, and this isn't
      great for the overall environment of the server.

      So, with that in mind, we are now imposing a **limit of 5 accounts per user**. If you already
      have more than 5 accounts, you will be unable to create more, but we will not currently be
      removing any existing accounts. We may revisit that decision in the future, but we will
      provide a good amount of notice before any action is taken.

      Since we don't want you to be stuck with a name you don't like if you already have the maximum
      number of accounts, we've also added **display** and **login name changes**. Display names
      may be changed once every 60 days, and login names may be changed once every 30 days. Changing
      the capitalization of your display name (e.g. CoolGuy -> COOLGUY) is always allowed,
      regardless of your name change cooldown.

      ## TL;DR:

      - 5 accounts per user
      - Display names can be changed once every 60 days. Capitalization changes are always allowed.
      - Login names can be changed once every 30 days

      Check the account settings page within ShieldBattery to change your names!

      We hope you enjoy the new features and changes. If you'd like to support further development
      of ShieldBattery, please check out the donation links at the top of the home page!
    `,
  },
]

export const newsDateFormatter = new Intl.DateTimeFormat(navigator.language, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export function StaticNewsImage({ index, className }: { index: number; className?: string }) {
  const imageIndex = NEWS_IMAGES[index % NEWS_IMAGES.length]
  const imagePath = makePublicAssetUrl(`${NEWS_IMAGE_PATH}${imageIndex}.jpg`)
  const smallImagePath = makePublicAssetUrl(`${NEWS_IMAGE_PATH}${imageIndex}_0.5x.jpg`)

  return (
    <AutoSizeImage
      className={className}
      alt=''
      aria-hidden={true}
      draggable={false}
      srcSet={`${smallImagePath} ${SMALL_IMAGE_WIDTH}w, ${imagePath} ${LARGE_IMAGE_WIDTH}w`}
      loading='lazy'
    />
  )
}
