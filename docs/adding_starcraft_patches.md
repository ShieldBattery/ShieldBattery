# Adding New StarCraft Patches

When StarCraft gets updated and we're not ready to support the new version (e.g. because we haven't
updated out offsets/hooks yet, etc.), we have a built-in mechanism to transparently downgrade newer
clients to a version of our choosing. This is done without affecting their installed client, merely
using their installed client as a base for generating the earlier version (effectively, we provide
a reverse patch).

## How it works

We generate diffs using `bsdiff` (which you can find in the `tools` directory at the repo's root).
This generates a file that can be used with `bspatch` to receive a desired file. To distribute diffs
to clients, we have an admin-only service that accepts diff uploads, and stores them in the DB
indexed by:

  - hash of the new binary
  - filename of the new binary (e.g. `starcraft.exe`)

Clients can request a patch file for a particular filename/hash combination through this same API
endpoint, and if we have one, we hand them a URL to download the patch. If we don't, they get a 404.

## Creating/uploading a new diff

To create a new diff, you need both the new version of the binary you want to support, as well the
old version you want to be able to patch to. Say Blizzard releases StarCraft 1.19.0, and we want to
be able to downgrade clients to 1.16.1:

1) Collect the `starcraft.exe` from 1.19.0, name it `starcraft-1190.exe`
2) Collect the `starcraft.exe` from 1.16.1, name it `starcraft-1161.exe`
3) Place them in a directory with `bsdiff.exe`, or put `bsdiff.exe` on your `PATH`
4) Run the following command: `bsdiff.exe starcraft-1190.exe starcraft-1161.exe starcraft-1190.diff`
5) Upload the diff using the admin tool. The binary will be `starcraft-1190.exe`, the diff will be
`starcraft-1190.diff`, the filename will be `starcraft.exe`, and the version description will be
`1.19.0`.

Repeat steps 1-5 with storm.dll, if it's changed (unlikely).

## Changing the target version

If/when we want to change the version we support directly (e.g. 1.16.1 -> 1.18.5), the existing
patch files will no longer be valid (as they target an earlier version). Making this change will
require a server release (and a client release anyway, obviously). At that point in time, we should
drop all the entries in the `starcraft_patches` table via a new migration.

Clients should overwrite their existing downgrade versions just fine in these cases, as long as the
server has new diffs available.

## Getting historical diffs

If you need diff files for previous versions (i.e. for testing something), talk to tec27.
