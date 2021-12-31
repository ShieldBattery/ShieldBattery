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

#### 7.0.19 (July 27, 2021)

- **Support for SC:R 1.23.8.9713.** We've fixed launching multiplayer games on the latest version
  of StarCraft: Remastered. Our improved fix for flying SCVs will still be used in place of
  Blizzard's during gameplay. We also have compatibility code for older replays, so replays
  containing the SCV exploit will continue to play back correctly when viewed through our client.
- **Time travel.** You'll now be able to see the history of chat channels from before you joined
  them. Please only use this power for good, we take no responsibility for users preventing their
  own conception.
- **UI fixes for profiles.** User avatars should now display in the proper color, map thumbnails
  will load a bit more smoothly, and the match history should look a bit nicer if you only have a
  couple games played.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Observer mode missing.** We're still getting our lobby code to work with the newer ingame
  observer things, this will return shortly!
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is.

#### 7.0.18 (July 10, 2021)

- **Profiles are here!** User profiles are now available, accessible from the user menu in chat
  channels as well as the ladder rankings. Check out a user's recent match history, their stats
  with various races, and more! More personalization and statistics coming soon!
- **Start minimized.** When ShieldBattery is set to launch on system startup, you can now make it
  start minimized as well.
- **Clickable names.** Usernames in the various chat experiences (channels, whispers, lobbies) are
  now clickable and will bring up a menu so that you can easily access extra functionality.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Observer mode missing.** We're still getting our lobby code to work with the newer ingame
  observer things, this will return shortly!
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is.

#### 7.0.16 (June 27, 2021)

- **You're grounded.** Fixed an exploit that allowed SCVs and Drones to fly over obstacles if their
  order queue size was exceeded in a specific way. This also fixes some existing mineral hack
  exploits.
- **Launch at startup.** Added an option to launch the ShieldBattery client at system startup
  (defaults to on). You can change this in the 'App' tab of the settings.
- **Ladder table fixes.** Fixed some issues with the ladder rankings table when users had
  particularly long names.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Observer mode missing.** We're still getting our lobby code to work with the newer ingame
  observer things, this will return shortly!
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is.
- **Replays sometimes crash on startup.** With newer versions of SC:R (9651+), replays occasionally
  crash as soon as they load. This is a transient issue, and not specific to any particular replay,
  so relaunching the same replay should work.

#### 7.0.15 (June 8, 2021)

- **Support for new SC:R version.** We're now compatible with 1.23.8.9588. If you'd like to play on
  this version and actually have autoscrolling chat, we've got you covered!
- **More visible notifications.** Notifications now pop up in the client when they're first
  delivered, so you can actually notice they've arrived. More notifications for useful things, as
  well as OS-level notifications are coming soon!
- **More interactive buttons.** Buttons should appear a bit more dynamic and fun in this release.
- **Ya blue it.** We've moved to a blue-ier color scheme in this release, to bring out a more "cool
  sci-fi" vibe and less "trendy office app". We're sure you'll feel right at home.
- **More visible hotkeys.** Activity buttons on the main screen now underline the character that
  matches their hotkey, for easier discoverability. Just add alt!

#### 7.0.12 (May 14, 2021)

- **No more idling.** The ladder rankings now display when a user last played a game, so you can
  get a better idea of who you're likely to catch in the queue, and who's just sitting at the top
  hoping not to lose their rank.
- **Chat improvements.** We've fixed a bunch of bugs related to scrolling and loading more messages
  in chat and whispers, and added a message when days change between messages (no more getting
  confused replying to that whisper from a week ago!)
- **Load time improvements.** The game now loads a bit less unnecessary data, which should bring
  the game start time down on slower systems.
- **Beefier fonts.** We've fixed some issues with font rendering, so a number of components should
  have thicker fonts as intended.
- **More efficient menus.** We know SC players love efficiency, so we've changed our small overlays
  (menus, profile popups, etc.) to allow you to click things behind them while they're open. This
  should make it a bit less annoying to navigate things with a lot of menus.
- **Crash fix.** We've fixed a rare crash that could occur with some hardware/software
  configurations on Nvidia graphics cards.

#### 7.0.10 (April 16, 2021)

- **Can you hear me now?** Application sounds are now 150% louder, as they were a bit quiet relative
  to other application's volumes. You may want to double-check your settings to ensure they sound
  how you'd like.
- **Replay filenames.** Auto-saved replays from ShieldBattery now contain the correct map name
  instead of just 'map'.
- **Calm down, minerals.** Minerals and gas geysers should no longer vibrate in replays. Sorry, they
  were just a bit excited.
- **Au revoir.** We made a change to ensure the game never tries to talk to the Bonjour service,
  which may have been stalling some users' game initialization in rare cases.
- **Blink. blink.** The application will now flash its taskbar entry when someone joins your lobby.
- **Longer load times.** We've doubled the allowable game load times (to 60 seconds) since some
  users were hitting this timeout when they would have loaded successfully. We have some plans to
  improve this system to not require such long timeouts, but these players should no longer be
  hindered by it for the time being.
- **Ping pong.** We've revamped our system for dealing with game servers, allowing us to add and
  remove servers on the fly, as well as improving the consistent and reliability of clients
  calculating their ping to the various regions. This should improve ingame latency a bit (more
  work on that front coming soon!).

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Observer mode missing.** We're still getting our lobby code to work with the newer ingame
  observer things, this will return shortly!
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is.

#### 7.0.9 (April 9th, 2021)

- **Faster auto-update.** Our updates are now served from our global CDN and support downloading
  just the parts of the app that have actually been updated. Basically, these should download a lot
  faster now.
- **Smoother fullscreen.** We've tweaked how the game handles fullscreen mode to work better with
  multiple monitors and removed some legacy code it was still using. If you're on Windows 10 and
  have been using Fullscreen (Windowed) mode, we highly recommend checking out normal Fullscreen
  now: it should work nearly the same as far as program switching goes, but with improved
  performance and input latency. This change has some potential to cause problems for users on
  older graphics card, so if you see any weirdness, please let us know!
- **Browse maps in less clicks.** Our map browser now lets you view details about a particular map
  by clicking on its tile, rather than needing to go through menus. In addition, there should be
  less things jumping around as the map images load in (we'll try to work some click accuracy
  training back into the client in some other way 😏).

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Observer mode missing.** We're still getting our lobby code to work with the newer ingame
  observer things, this will return shortly!
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is.
- **Vibrating mineral patches.** You're not going crazy, I promise. Those mineral patches really are
  vibrating. This is an unintentional side-effect of our fog of war change for some users, we're
  working on it!

#### 7.0.6 (April 2nd, 2021)

- **Skins!** Our settings dialog now has options for selecting the various types of skins in the
  game (both console + building/unit ones). We have no way of verifying what you have or haven't
  purchased so they're all shown, but if you select one you don't have access to, you'll get normal
  graphics. (Same known issues apply as with HD graphics here: you must launch SC:R with the
  Blizzard launcher every 30 days to refresh your purchase information.)
- **Links and stuff.** We've added a menu containing links to our various other web presences
  (Discord, GitHub, Patreon, etc.). Access it by clicking on the ShieldBattery logo in the top left
  of the client.
- **No more feedback.** Society has progressed past the need for feedback. We've removed the link
  to the feedback form in the app. ShieldBattery is already perfect! Just kidding, we just prefer
  that you direct your feedback and bug reports to our Discord so we can more easily collect
  additional information when necessary (check out the link to it in our snazzy new menu if you're
  not already there!)
- **Various fixes and polish.** The standalone client should no longer put links underneath the
  window controls where you can't click them, our map browser tabs are a bit less redundant,
  standalone web clients will go to the login page by default if logged out, and probably more
  small things!

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Observer mode missing.** We're still getting our lobby code to work with the newer ingame
  observer things, this will return shortly!
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is.
- **Vibrating mineral patches.** You're not going crazy, I promise. Those mineral patches really are
  vibrating. This is an unintentional side-effect of our fog of war change for some users, we're
  working on it!

#### 7.0.5 (March 26th, 2021)

- **You're bad.** Or maybe you're good, now you can find out on our new ranked leaderboard! Find
  the Ladder button or hit Alt+D on your keyboard to bring it up and check out how you stack up
  against the rest of the server. More information like main races, game history, and in depth
  user profiles coming soon.
- **More counting!** We now have a snazzy counter for the number of games played on our
  <a href="https://shieldbattery.net/splash" target="_blank">home page</a>. If you've ever wanted the privilege of making a counter go up just from clicking a few buttons, come play a few games!
- **But also less counting!** We've turned off the counter showing how many people are currently
  queued for matchmaking. We found it made people less likely to queue and overall gave them
  incorrect expectations for how long finding a match would take. We're working on some better ways
  to give people realistic expectations here, and should have some more to share soon.
- **Notifications.** We've added support for in-client notifications. At the moment there aren't
  very many of these, but you'll notice a new button in the bottom right to access them. The
  settings button is still there as well, just a little smaller than before (please don't talk
  about it, wouldn't want to embarrass the button).
- **Another round of UI polish.** Our client got another round of UI polish changing the look of...
  just about everything really. Tweaks to text styles, larger click targets, adjustments to chat
  layout and more!
- **Rare launch bugs squashed.** We fixed some more issues that we saw happen to a few users on
  game launch. If you were having trouble before, try again, it might be better now! If not, we'll
  keep working at it.
- **Like small windows?** Well, now you can use them, I guess? The client should behave more
  reasonably at small sizes now, no more losing important buttons outside the visible area.
- **Pesky high ranked players.** We've made some more tweaks to how our matchmaker finds potential
  opponents for high ranked players to try and keep queue times a bit more reasonable.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Observer mode missing.** We're still getting our lobby code to work with the newer ingame
  observer things, this will return shortly!
- **Off-center screen starting position.** For some users, generally in positions on the right side
  of the screen, the starting screen position may be slightly off-center from where it usually is.
- **Vibrating mineral patches.** You're not going crazy, I promise. Those mineral patches really are
  vibrating. This is an unintentional side-effect of our fog of war change for some users, we're
  working on it!
