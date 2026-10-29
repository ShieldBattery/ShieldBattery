# The Discord Social SDK

The desktop app shows players' lobbies and games as Discord Rich Presence through the Discord
Social SDK. The SDK's binding is [`@shieldbattery/danimoth`](https://github.com/ShieldBattery/danimoth),
which loads the SDK's library (`discord_partner_sdk.dll`) at runtime from a `discord-sdk` folder
beside the app. The library itself never goes in this repo or in any package: Discord's terms cover
shipping it inside the app, nothing more. `.gitignore` keeps the `discord-sdk` folder out of git.

## Getting the SDK

The private [ShieldBattery/discord-social-sdk](https://github.com/ShieldBattery/discord-social-sdk)
repo holds the two files the app ships, in a release for each SDK version. It has to stay private,
since Discord's terms don't allow sharing the SDK any other way. With the
[GitHub CLI](https://cli.github.com/) logged in as someone who has access to that repo, run:

```
pnpm run fetch-discord-sdk
```

It downloads the version `tools/check-discord-sdk.cjs` pins into a `discord-sdk` folder at the root
of your checkout, and checks the files against the pinned hashes.

## Development

Without the SDK, the app works as usual with Rich Presence off, and logs that the SDK didn't load.
With it, a dev build publishes as ShieldBattery-Local while the Discord desktop app runs on the same
computer. Dev builds don't register the command Discord uses to start the app for a join, so joining
from Discord only works while the app is already running.

## Release builds

Builds from `prod.yml` and `staging.yml` (`pnpm run dist`, `diststaging`, `pack` and `packstaging`)
refuse to run unless both files in `discord-sdk` are the ones from the SDK version the repo pins, so
no release goes out without Rich Presence or with an SDK it wasn't tested against.
`tools/check-discord-sdk.cjs` holds that version and each file's SHA-256. It runs as
electron-builder's `beforePack` hook, and first thing in `build:release`, which all four run, so
they fail before building anything else.

The build ships the files through `extraResources` into the installed app's `resources/discord-sdk`
folder, and the app shows `License-Notices.txt` on its open source licenses page. The library keeps
Discord's own signature: the sign hook leaves alone any file that already carries a valid one.

## Rich Presence images

The activity's large image is the map's image from the CDN, given as a URL. The small image is the
race the player picked, or an eye while they observe. Map images are served from the local file
store in development, which Discord can't reach, so dev builds show only the small image. A replay
has no map image, so its activity shows only the replay icon.

The race, observer and replay icons are art assets, uploaded under Rich Presence → Art Assets to
each of the three Discord applications with the keys `race_p`, `race_t`, `race_z`, `race_r`,
`observer` and `replay` (the file names in `docs/discord-assets`). The observer icon is Material
Symbols' `visibility`, filled, and the replay icon is drawn in `replay.svg`, both in `#bfd9ff` on the
race icons' `#18273e`. The app refers to them by key, so a changed icon only needs uploading again
under the same key.

## Updating the SDK

The SDK is a download from the Discord Developer Portal, for members of the team that owns the
ShieldBattery applications (ShieldBattery, ShieldBattery-Staging and ShieldBattery-Local; each
release channel publishes as its own). Open one of them, go to the Social SDK's Downloads page, and
download the SDK for C++.

Create a release of ShieldBattery/discord-social-sdk tagged `v<version>`, with these two files from
the download attached under their own names:

- `discord_social_sdk/bin/release/discord_partner_sdk.dll`
- `discord_social_sdk/License-Notices.txt`

```
gh release create v<version> --repo ShieldBattery/discord-social-sdk --title "Discord Social SDK <version>" discord_partner_sdk.dll License-Notices.txt
```

Then update the version and the two hashes in `tools/check-discord-sdk.cjs` (`sha256sum` or
PowerShell's `Get-FileHash` prints them), and run `pnpm run fetch-discord-sdk`. A release there is
never replaced: each version gets its own, so older commits can still fetch the version they pin.
danimoth declares the SDK's C API by hand for the version it was written against, so check its
README before moving to a new major or minor version.
