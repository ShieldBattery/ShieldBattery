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
download the SDK for C++.

From the download, copy these two files into a `discord-sdk` folder at the root of your checkout:

- `discord_social_sdk/bin/release/discord_partner_sdk.dll`
- `discord_social_sdk/License-Notices.txt`

## Development

Without the SDK, the app works as usual with Rich Presence off, and logs that the SDK didn't load.
With it, a dev build publishes as ShieldBattery-Local while the Discord desktop app runs on the same
computer. Dev builds don't register the command Discord uses to start the app for a join, so joining
from Discord only works while the app is already running.

## Release builds

`pnpm run dist` and `pnpm run diststaging` refuse to build without both files in `discord-sdk`, so
no release goes out without Rich Presence. The build ships them through `extraResources` into the
installed app's `resources/discord-sdk` folder, and the app shows `License-Notices.txt` on its open
source licenses page.

## Updating the SDK

Replace the two files with the new version's. danimoth declares the SDK's C API by hand for the
version it was written against, so check its README before moving to a new major or minor version.
