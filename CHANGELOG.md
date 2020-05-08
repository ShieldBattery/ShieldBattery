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
