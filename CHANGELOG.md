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

#### 7.1.5 (November 15, 2021)

- **EUD maps fixed.** We've fixed the last of the non-working EUD maps (and found and fixed a bug
  that was breaking some other Use Map Settings bugs as well).

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is
- **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
  fixed in a future update.

#### 7.1.4 (November 14, 2021)

- **Game results.** We've added the first version of a game results page, viewable after you
  complete a game and from a user's profile page. We plan to add a lot more features to these, but
  for now you can at least check out who won and lost.
- **Improved chat.** There's a number of new features in our messaging system (affecting chat,
  whispers, and lobbies). You can now mention users by throwing an _@_ in front of their username
  (autocompletion for this coming soon!). Any messages which mention you will be highlighted for
  optimal noticeability. In addition, links to external sites will now show a warning, and channel
  join messages will be persisted to the permanent history so you can always tell when someone
  joined.
- **Fixes for EUD maps.** A number of EUD maps should load properly now, instead of crashing
  immediately. There's still a few that cause issues, but we're working on it and will release an
  update once they are fixed as well!
- **New system tray icons.** We've recolored and reworked our system tray icons for better
  visibility. We also added a snazzy new icon specific for "urgent" messages, so you can know when
  someone has mentioned you in a channel or lobby.
- **Codified policies.** We've documented our privacy policy, terms of service, and acceptable use
  policy, and linked these on the site. These don't represent a real change to the things we were
  doing, but should give you a more concrete idea of how you can expect your data to be collected
  and treated.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is
- **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
  fixed in a future update.
- **Some EUD maps behave incorrectly.** EUD maps load into the game properly, but then do not follow
  their "normal" behavior. This will be fixed in a future update.

#### 7.1.3 (September 30, 2021)

- **Map downloads fixed.** We've fixed an issue with downloading maps from our CDN that was
  preventing games from loading.
- **Improved map preview.** The map preview dialog now shows the map image without borders and
  does a better job sizing itself for optimal strategic planning.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is
- **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
  fixed in a future update.

#### 7.1.2 (September 2, 2021)

- **Matchmaking fixes.** Fixed a bug that allowed clients to potentially accept matches multiple
  times, leading to a crash.
- **New error screen.** Added a new screen for local errors and crashes to make them easier to
  report.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is
- **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
  fixed in a future update.

#### 7.1.0 (August 30, 2021)

- **Map haters welcome.** We've rolled out a new map selection system to completely replace our
  existing one. The last one was based on selecting maps you preferred to see, and increasing the
  chance that you would see them (but all maps were still in play). This turned out to be a pretty
  convoluted thing to explain and understand, leading people to often think it was bugged, or just
  be unhappy with the results. We've moved to a more standard 3 veto system. So long as the entire
  pool hasn't been vetoed by the players in the game, you'll be guaranteed to not see any of the
  maps you've vetoed. As part of this change, your existing map selections have been wiped clean,
  and you'll find a new UI for performing selections in the matchmaking overlay.
- **Faster matchmaking.** We've increased the rate at which matchmaking ranges expand, and added
  basic population estimation into the algorithm to let you always find a match in a reasonable
  time. The previous versions of matchmaking greatly prioritized accurate matches, and didn't make
  many concessions during low population times. This often resulted in cases where two players were
  queued and had ratings that weren't extremely far off, but were still outside each other's max
  ranges. In the interest of delivering games more often, the system will relax these range
  restrictions if the population around your rating is unlikely to produce a match in a short time.
- **No more unintentional GGs.** Very few people probably realize this, but SC:R added a system that
  watches for various behavior it considers problematic (dragging the window for more than 10
  seconds straight being the prime example), and forces anyone found doing it to send a 'GG'
  message and quit the game. Presumably this caused problems with lag at the time this code was
  written, but it doesn't any more, and so in the interest of not having people quit the game
  accidentally, we've turned that "feature" off on ShieldBattery.
- **Fog of War, now with less blue.** We've made some visual tweaks to the unexplored Fog of War.
  The previous version had a slight amount of blue added to it, to try and increase contrast with
  the explored fog. This had the side effect of making some colors in the game appear warmer than
  intended (and was especially prominent on some displays), so we've removed that extra color.
  Unexplored fog will now be a flat gray color (just a darker version of the explored fog).

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is
- **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
  fixed in a future update.

#### 7.0.20 (August 13, 2021)

- **Observer mode has returned.** We now support in-game observers using SC:R's built-in feature
  and UI. There is still a limit of 8 total players per game, so on larger maps you may have to
  convert some of the player slots into observer slots if you need more (check the menu next to
  the slot!). This feature is also available only on Melee mode for the time being, although this
  restriction will likely be lifted in the future.
- **Clickable links.** Links in chat (in the app, not ingame) are now clickable and will open a
  new window. Support for embedding links to other ShieldBattery pages (like profiles and lobbies)
  is coming soon.
- **Bug fixes.** We've fixed an issue with some UMS maps (namely ones for observer mode) generating
  replays that were unplayable. We've also fixed some issues with email verification, and made
  the web version of the app load slightly faster.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is
- **Observer chat is broken.** Observers are unable to send messages ingame currently. This will be
  fixed in a future update.
