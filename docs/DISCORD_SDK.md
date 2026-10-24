# The Discord Social SDK

The desktop app shows players' lobbies and games as Discord Rich Presence through the Discord
Social SDK. The SDK's binding is [`@shieldbattery/danimoth`](https://github.com/ShieldBattery/danimoth),
which loads the SDK's library (`discord_partner_sdk.dll`) at runtime from a `discord-sdk` folder
beside the app. The library itself never goes in this repo or in any package: Discord's terms cover
shipping it inside the app, nothing more. `.gitignore` keeps the `discord-sdk` folder out of git.

## Getting the SDK

The SDK is a download from the Discord Developer Portal, for members of the team that owns the
ShieldBattery applications (ShieldBattery, ShieldBattery-Staging and ShieldBattery-Local; each
release channel publishes as its own). Open one of them, go to the Social SDK's Downloads page, and
download the SDK for C++ in the version `tools/check-discord-sdk.cjs` names.

From the download, copy these two files into a `discord-sdk` folder at the root of your checkout:

- `discord_social_sdk/bin/release/discord_partner_sdk.dll`
- `discord_social_sdk/License-Notices.txt`

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
electron-builder's `beforePack` hook, and first thing in `dist` and `diststaging` so they fail
before building anything else.

The build ships the files through `extraResources` into the installed app's `resources/discord-sdk`
folder, and the app shows `License-Notices.txt` on its open source licenses page.

## Rich Presence images

The activity's large image is the map's image from the CDN, given as a URL. The small image is the
race the player picked. Map images are served from the local file store in development, which
Discord can't reach, so dev builds show only the race.

The race icons are art assets, uploaded under Rich Presence → Art Assets to each of the three Discord
applications with the keys `race_p`, `race_t`, `race_z` and `race_r` (the file names in
`docs/discord-assets`). The app refers to them by key, so a changed icon only needs uploading again
under the same key.

## Updating the SDK

Replace the two files with the new version's, and update the version and the two hashes in
`tools/check-discord-sdk.cjs` (`sha256sum` or PowerShell's `Get-FileHash` prints them). danimoth
declares the SDK's C API by hand for the version it was written against, so check its README before
moving to a new major or minor version.
