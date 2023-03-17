#### 8.8.0 (March 17, 2023)

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

#### 8.7.0 (October 27, 2022)

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

#### 8.6.0 (October 3, 2022)

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

#### 8.5.0 (June 25, 2022)

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

#### 8.4.1 (June 13, 2022)

- **Bug fixes.** We've fixed an issue that prevented the client from running on Windows 7, as well
  as issues with non-working shortcut keys and janky scrolling.
- **Better rankings for ties.** Users that are tied for points will now be ranked by their MMR,
  rather than randomly sorted.
- **Labeled searching.** The matchmaking search status in the navigation area will now display which
  matchmaking type you are queued for.

#### 8.4.0 (June 4, 2022)

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

#### 8.3.0 (May 12, 2022)

- **Main race in ladder rankings.** The ladder rankings now display a player's main race, detected
  based on all the games they have played during the season.
- **Rankings search.** Tired of scrolling to the bottom of the rankings to find all of your
  not-so-talented friends? Fear not, you can now simply type their name into our snazzy new search
  box and filter the rankings down to just the matching accounts!
- **Improved shortcut keys.** We've added a shortcut for opening the client settings (Alt + S), as
  well as starting a new whisper (Alt + W). There are also hotkeys for moving between tabs in any
  interface that has them (Ctrl + 1-9).

#### 8.2.0 (February 5, 2022)

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
  (<a href="https://youtu.be/SRGyrxANxVo?t=2657" target="_blank" rel="nofollow noreferrer noopener">for one example</a>).
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

#### 8.1.0 (December 31, 2021)

- **Better settings.** We've completely reworked how settings are transmitted to the game client,
  preventing some possible problems but also, more importantly, **allowing settings you change
  ingame to be transmitted back to ShieldBattery**. In addition, we've added built-in support for
  a few more settings: announcer DLC packs and turn-rate and FPS displays.
- **When are these rankings even from?** The ladder pages will now show the last time the rankings
  were refreshed, so you never have to wonder just how old they might be.
- **Less error-prone email verification.** Our verification emails now provide links that specify
  the account they're for, and will tell you if you need to swap accounts to complete verification.
- **Fixes for exploits.** We've fixed a number of exploits. Notably, disconnecting from the
  internet at the end of a game will no longer prevent you from receiving a loss, and all games
  affected by this bug will now be resolved properly and have points awarded/removed.
- **Improved login error messages.** The login screen will now display better error messages when
  things go wrong, instead of throwing a bunch of technical jargon at you.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is
- **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
  fixed in a future update.

#### 8.0.1 (December 17, 2021)

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

#### 8.0.0 (December 15, 2021)

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
  If you're arriving at the page by completinga ranked game, there's also a snazzy new button to
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
  corrections to game result calculation in games with alliances, improved latency when performing a ton of actions in the standalone client (sending chat messages, for instance), and added sounds
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
