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

#### 7.0.3 (March 19th, 2021)

- **We learned to count.** The lobby count should be a bit more accurate now and stop telling you
  about lobbies that have already started.
- **Emails, emails, emails.** Email verification should be working again (try your existing emails
  again, but resending emails should also work).

#### 7.0.2 (March 19th, 2021)

- **Some random changes.** Or, well, changes for Random players. Players who have selected Random
  will no longer be able to choose an alternate race. This didn't really work how most people
  expected (it picked the alternate only if your opponent was also playing Random), so we fixed the
  glitch.
- **Stacks on stacks on stacks.** Buildings and resources that are stacked on top of each other
  (for instance, stacked neutral buildings or stacked mineral patches) now display a stack count in
  their unit card.
- **We heard you liked numbers.** The matchmaking and lobby buttons will now display a count of
  active players or lobbies, so you can figure out how badly you want to join. (Really badly, I'm
  sure).
- **More selective matches.** We fixed a bug in the matchmaker that was letting it pick matches that
  only one player was happy with. Now you all have to be happy about every match you're given. I do
  not make the rules. The matchmaker does, but it's been super benevolent so far...
- **Anti-anti-virus.** ShieldBattery will now alert you if someone or something has deleted
  important files (I'm looking at you, anti-virus makers). This can often be remedied by reporting
  it as a false positive or removing the file from quarantine.
- **Bugs bashed.** Fixed a game crash that could occur if you hadn't launched SC:R once after
  installing it. Fixed our chat channels and whispers showing notifications for non-existent
  messages. Improved the performance of chat channels with large numbers of users.

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

#### 7.0.1 (March 13th, 2021)

- **Game loading... or not.** We've fixed a number of issues around players leaving or getting
  disconnected during game loads/countdowns in both matchmaking and lobbies. Previously these could
  leave the server in a pretty weird state and potentially prevent you from joining more matches in
  the future.
- **tec27 has come online. tec27 has gone offline. tec27 has come online.** We've turned online and
  offline messages off in chat for the moment, as they were being pretty obnoxious. In the future
  we might make this a configurable option (although depending on how this feels, this might just
  be how it is! Feedback welcome!).
- **Zombies eradicated.** StarCraft should do a better job of exiting if it failed to launch a game,
  no more creepy zombie clients hanging around in the background.
- **Logs. The text kind, not the wood kind.** Accessing our clients log files for reporting issues
  is now a lot easier! Right-click the icon in your system tray and find that shiny, new
  "Open Logs Folder" action. We've also added a bunch of other diagnostic logging around
  connections and game launching and such, so hopefully we can track down a few more of those
  pesky launch issues. (And if you _are_ having launch issues, sending us your logs in our
  <a href="https://discord.gg/S8dfMx94a4" target="_blank" rel="noopener">Discord</a> would be very
  helpful!)

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

#### 7.0.0 (March 11th, 2021)

- **Wow, it's been a while.** Sorry about that. The hurdles involved in supporting a game that was
  actively being worked on were unexpected and large. But we figured it out! And we're here again!
  And we're ready to bring you the best gosh darn StarCrafting Experience you've ever seen!
- **StarCraft: Resupported.** We now support StarCraft: Remastered installs. In fact, that's all we
  support. RIP 1.16, we'll miss you a bit. As a result, you'll notice that our Settings dialog has
  changed quite a bit, and we directly map to settings you'd find inside SC:R now. The big missing
  feature there is hotkey configuration. For now, you can launch SC:R through Blizzard's launcher
  and any hotkeys you change there will be maintained for ShieldBattery.
- **We're open for business!** No more invite process, this is now an open beta. Tell your friends,
  children, parents, pets... Get em all in here.
- **Matchmaking making matches.** Matchmaking is finally here! For 1v1. Without visible ranks yet.
  More modes (teams!) and visible ranks are coming real soon, but we wanted to roll out a simpler
  version first to work out all the kinks. It'll be available on weekends only for the first
  couple weeks, and we'll play it by ear after that. The client will let you know if it's down (and
  also let you know when it'll be back if it's currently disabled)! We look forward to your feedback on our unique race and map selection systems, so let us have it!
- **DeMapcracy.** Remember that cool new maps backend we mentioned 3 years ago? Honestly I wouldn't
  blame you if you didn't, although I mean, it's like, two versions below this one and you could
  just go look... Okay you don't have to, really it's fine! The important thing is, you can now
  upload all those maps you have sitting in your BW directory. And you can make lobbies for them
  too! Currently these will be in your _private collection_, usable only by you. Features for
  publishing and managing publicly available maps are _Coming Soon™_.
- **Fog of War: Now With Slightly Less Fog.** The starting fog color is now slightly transparent in
  non-UMS settings, so you can see the location of terrain and resources without exploring. We
  believe this will make playing new and unfamiliar maps slightly less intimidating, and just feels _right_. It may be 2021, but we can still teach Brood War some new tricks 😎
- **WHAT'S THAT? I CAN'T HEAR YOU OVER THE COUNTDOWN BEEPS!** We added a volume slider for our
  in-app sounds, just in case you didn't want to blast your whole neighborhood with incessant
  beeping every time you start a game. Weirdo.
- **Donation station.** Much requested: we now have some ways you can contribute to the maintenance
  and hosting costs of all of this. Check out our
  <a href="https://shieldbattery.net/faq" target="_blank">FAQ page</a> for the links.
- **More server locations.** Speaking of donations, thanks to some generous contributors we've
  already been able to expand our game server locations. In addition to the already existing
  EU Central, US East, and US West servers, we now have servers in Korea (Seoul),
  Australia (Sydney), Brazil (São Paulo), and Sweden (Stockholm). Hopefully that brings a few more
  of you into a nice, low-latency experience.

##### Known Issues

- **HD graphics fail to work even when purchased/turned on.** Blizzard requires the game to be
  launched from their launcher once every 30 days to keep premium features enabled. We'll at the
  very least add a warning for this case in the future (or better yet, automate re-authing), but
  for now, try to launch the game from the Blizzard launcher at least once a month.
- **Observer mode missing.** We're still getting our lobby code to work with the newer ingame
  observer things, this will return shortly!

#### 6.1.0 (April 24th, 2017)

- **Support for newer game installs.** We can now handle installs of newer versions of StarCraft
  than 1.16.1! We're of the opinion that 1.18 would be a downgrade for existing ShieldBattery users,
  so we won't actually be using that yet, but we do support transparently converting newer
  installations back to a pristine 1.16.1 copy automatically (without affecting your installation in
  any way). Feel free to point things to your updated copy in the settings, and/or stop having to
  maintain two separate installations just to use our service.
- **When did you join this channel?** Now you can easily see! There is now a line in chat that
  indicates when you connected to the channel, so you can easily see how people change their demeanor
  when you're around.
- **In your face, user.** If you try to launch the app when it's already running the background, the
  original app will actually be brought to the front now.
- **B̈étte̋r character support.** Users with non-latin characters in their Windows usernames should
  have a 1000x better time launching games now. As in they'll actually work again. Whoops.
- **FAQ accuracy.** The FAQ has been updated to be more accurate towards our actual requirements,
  as well as to provide a link to the (Now free! Now working with ShieldBattery!) Brood War download.

#### 6.0.0 (April 3rd, 2017)

- **Maps. Again. But better.** We've been hard at work implementing a new maps backend that can be
  used to upload and play any maps during lobby creation. It's not quite ready for use by everyone,
  but it now backs all of our official maps (you'll probably notice that map thumbnails look nicer
  and are more consistent, and that some maps have different titles between the selection and lobby
  screen). Expect this upload ability to come in a near-future update! Along with this, we've added a
  few more requested maps: Camelot (from ASL), Judgment Day, and Mizu de Chaud.
- **Lobby actions.** Adding computers just wasn't enough, so we finally threw in some more options
  for all you lobby enthusiasts out there. Try not to get _too_ into it as you close slots, or kick
  or ban players from your lobbies, you do need _some_ opposing players to start the game.
- **UMS.** If you've ever wanted to trade freedom of controlling your own settings for the thrill
  of playing a completely different game inside of Brood War, do we have exciting news for you! Use
  Map Settings maps are now supported on ShieldBattery! The maps we provide for now are: BGH 3.0 (a
  version of BGH that randomly assigns teams), Micro Tournament, Mini-Game Party, Monopoly, Poker D
  NovaX2, Random Micro Arena, SoG - Random, TMA Legends, i S k U Bound, Dhoom 2 Bound, and TriX Bound.
  This is all backed by our new maps backend, as well, so you'll soon be able to play whatever UMS
  maps you want. These won't currently display the pre-game briefing screen, but we're working on that
  as well.
- **System tray icon.** Our standalone client has one now, and will go there when you hit the close
  button. If that weren't enough, its icon will also change when you've received a new message (it's
  still pretty unintelligent though, better notifications with nickname highlighting and sounds and
  other such niceties are coming very soon!).
- **Saved window position.** We installed some additional memory modules in our windowed mode
  mainframe, meaning it can now save and restore your Brood War window's position between games!
- **Username and password recovery.** No longer will you have to PM an admin to recover your lost
  or forgotten account info! It's 2017, so we've built this functionality right into the login form.
  Please don't PM admins any more. Please. I mean, unless it's about something more interesting than
  resetting TamponZerg's password for the 15th time.
- **Window titles.** We made our window titles differ from stock Brood War, so that it's easier to
  configure streaming programs to work specifically for ShieldBattery. You may have to adjust your
  streaming configuration, depending on how you had it set up. The window title will also change
  between game initialization and actual gameplay, to help avoid switching scenes before things are
  ready.
- **OpenGL full screen fixes.** Some previous updates introduced a bug that caused the task bar to
  never get hidden in OpenGL full screen mode. It seems some people actually like using the bottom
  part of their screen or something, so we fixed that. We still recommend DirectX for everyone who can
  use it, but if you need to use OpenGL for compatibility reasons, it should work a bit better now.
- **Chat scrolling fixes.** Our auto-scrolling code used to be a bit picky about who it would work
  for, but we gave it a nice, stern talking to. It should be cool with everyone now.
- **Enhanced game launch failures.** If your game is failing to launch (should be incredibly rare!),
  we've implemented some additional logging. If this is happening to you, please reach out to an admin
  so we can collect this data and get some proper fixes in.

#### 5.0.0 (February 15th, 2017)

- **Standalone client.** We've moved to a standalone client model, instead of running everything
  through your browser. This'll mean faster file browsing, better integration for things like finding
  your StarCraft installation (coming soon!), and an easier time for us developers (which means more
  features for you!). You can (and will be able to!) continue to use the browser for chat (and for
  viewing game results and ladder standings and such once those are in), but you'll need to download
  our client to play and watch games and replays. You can go ahead and uninstall our previous
  installation as well.
- **Automatic updating.** You won't have to click links in a dialog like a pleb any more! The client
  will automatically figure out what version you should be on and download it, prompting you to
  restart when it's done. This'll get a lot smoother in the near future, as well!
- **Maps.** You folks like maps, right? We've added Aztec, Demian, Benzen, Bloody Ridge, Neo
  Forbidden Zone, and Theatre of War to the pool. Byzantium was also fixed, and the Fastest Map
  Possible version was replaced with one from UGL.

#### 4.2.0 (December 11th, 2016)

- **Replay browsing and watching.** Not only do replays save automatically, but now you can watch
  them without ever leaving ShieldBattery! Browsing is limited to
  `My Documents\Starcraft\maps\replays`, but any replays you put in there will be watchable.
  Currently this only allows for single player watching, multiplayer watching is coming soon.
- **Signed installers and files.** All of our installers and files are now signed for extra
  assurance that you've received a legitimate copy. This should make some overzealous antiviruses and
  operating systems a bit less angry.
- **Maps, maps, and maps, oh maps!** Athena, Outsider, La Mancha, Icarus, and Overwatch (the ASL
  version) have been added to the available pool.

#### 4.1.0 (September 27th, 2016)

- **Replay auto-saving.** No more manually renaming LastReplay.rep after every game! Oh the
  technology! Replays will be saved to `My Documents\Starcraft\maps\replays\` (on-site replay browsing
  and watching coming soon).
- **Chat typing ez-mode.** Press any normal key on chat screens and you'll be helpfully redirected
  to the chat input. Type over there! Type over here! Just don't type with beer! (Or do; I'm a
  changelog writer, not a cop.)
- **See the lobby list when already in a lobby.** Last update's change around this was easily the
  most unpopular one in the entire history of ShieldBattery so... I'm sorry, I'm so very sorry.
- **Some tiny visual things you probably won't notice.** Loading indicator positioning is better,
  dialogs without actions no longer have bottom scroll dividers (like this one!). Just trust us, stuff
  looks better.
- **More maps.** Primeval Isles, Neo Harmony, New Sniper Ridge, and Polaris Rhapsody are now in the
  available pool.

#### 4.0.0 (September 5th, 2016)

- **Changelogs.** We have them now. You're reading one! Astounding! If you can't get enough of
  these, they'll also be available to re-read in the avatar menu in the upper right.
- **Feedback has moved.** The button, anyway. Look for it in the avatar menu in the upper right.
- **Team melee, Top vs Bottom, FFA, oh my.** Game modes other than Melee are now supported, so you
  can 4v1 an ex-pro on Blue Storm and maybe stand a fighting chance. UMS is still unsupported, but
  will be coming soon.
- **Slot switching.** It works now. Click on a slot to move there! Everyone told us this was
  impossible, but we did it anyway. Take that, naysayers.
- **Mouse sensitivity now goes to 11.** Or well, it has 11 settings. Your previous setting has been
  automatically migrated to the new scale, but you may want to double-check it meets your
  expectations. As before, 0 => desktop mouse speed, 10 => mouse speed at native Brood War resolution.
- **Hotkeys.** There are some. `Alt-C` opens the Create Lobby overlay, `Alt-J` for Join Lobby, and
  `Alt-S` for settings. More of the hotkeys you'd expect to have (as well as that "type anywhere and
  it puts it in the chat box" feature all you spammers want) coming very soon.
- **Lobbies look nicer.** Avatars have been resized, team labels now display when relevant, the
  race picker has been reworked a bit, and things generally look a bit more polished. The leave button
  has been reworked so that people can find it, as well (or for the real pros, you can also do this
  on the navigation entry).
- **Dialogs got a makeover.** Better alignment, improved functionality, and better support for more
  complex dialogs in the future.
- **More loading indicators, less boring text.** Who wants to read text when you're waiting for
  something to happen? Certainly not us, so now there's more snazzy loading indicators throughout the
  site.

#### 3.0.2 (August 23rd, 2016)

- **Adjusted network timings.** The timings reported to Brood War are now more consistent with what
  is advertised by the UDP LAN network mode. You probably won't notice any difference, but rest easy
  knowing how consistent things are.
- **No more logout surprises.** The avatar in the upper right now does a sensible thing, opening a
  menu instead of logging you out immediately.
- **Improved potential dodging speed.** You can now close the Join and Create Game overlays with the
  `Escape` key. No need to reach for the mouse when you decide you actually _don't_ want to get your
  face smashed in by that former WCG qualifier.
