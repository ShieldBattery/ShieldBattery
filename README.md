# shieldbattery
The client-side parts of the shieldbattery project, including an injector
service, an injected game management DLL, a game network provider, a windowed
mode for StarCraft: Brood War and various other utilities.

For the server-side parts, see
[manner-pylon](https://github.com/tec27/manner-pylon).

## IRC
The shieldbattery developers frequent `#shieldbattery-dev` on QuakeNet, feel
free to stop in with questions, comments, or just to hang out!

## Developer setup
ShieldBattery is a combination of C++ and JavaScript, and thus developing for it
involves two different workflows.

### Repository setup
We use a git submodule for the node dependency, which needs to be
initialized after a fresh repository clone. Run `git submodule init` followed by
`git submodule update` to make this happen. Whenever the node dependency has
been updated, you'll then need to re-run `git submodule update` to get the new
changes.

### General environment Setup
Building shieldbattery properly requires some environment variables to be set so
that it can properly move things around after building. Set your environment
variables as follows:

```
SHIELDBATTERY_PATH=<path to your desired shieldbattery test install>
```

For me, this is:

```
SHIELDBATTERY_PATH=C:\shieldbattery\
```

Note that this should *not* be the same place that you cloned the repo. Setting
your test install directory to the same directory as your repo will not work
correctly, and is not at all a desired way of doing things.

Shieldbattery uses [gyp](https://code.google.com/p/gyp/) for generating
project files, which requires a working
[Python 2.7.x](http://www.python.org/download/) install. Install this before
attempting to follow further steps.

### JavaScript
All of the JS for the project is under the `js` directory. You can edit this
however you wish, and no build step is necessary, but you install the
dependencies you'll need to install a version of node.js. Any version of node
&gt;= 5 should be fine, generally you'll just want to install the latest stable
version from [nodejs.org](https://nodejs.org/).

### C++
Building the C++ code requires Visual Studio 2015 or higher. The
easiest/cheapest way to get this is through the
[Community edition](https://www.visualstudio.com/en-us/downloads/download-visual-studio-vs.aspx)
.

Once Visual Studio is installed, you can generated project files by running the
`vcbuild.bat` script in the root of this repository. If you plan on building
inside of Visual Studio, you can run this with the `nobuild` flag to speed
things up. Note that this script will also install JS dependencies and link up
the JS directory to your `SHIELDBATTERY_PATH`, so complete the previous setup
steps first.

`vcbuild.bat` will generate `shieldbattery.sln` in the root of the repo; open
this with Visual Studio to be able to edit and build the C++ code. Note that
Debug builds add significant startup time to the applications, while Release
builds add significant compile time. Pick your poison based on your needs at the
time.

If you should ever need to add or remove files to the projects, make the changes
in `shieldbattery.gyp` and then re-run the build script to regenerate projects.
This will ensure everyone can get to the same project state as you once your
changes are merged.

## Project structure
The various project files/folders are:
- **bundler**: a script that bundles up all the binaries and scripts so they can
be included in the installer
- **common**: utility classes that are used almost everywhere.
- **forge**: windowed mode and general rendering wrapper for ShieldBattery.
- **installer**: WiX installer project used for generating a releasable
Windows installer.
- **logger**: logging class for pushing log lines from C++ to JS (so they can be
put in the same log file in the same format)
- **js**: All the JavaScript for the various projects, including code that
interfaces with the various native modules we've created.
- **psi**: Node-embedded background service that handles launching and injecting
Starcraft.
- **psi-emitter**: an executable which detects the desktop resolution, for use
by **psi** (since it cannot detect such information while running as a service).
- **scout**: multiplexing injectee DLL. Usable with InfectInject should you need
to get DLLs injected for debugging purposes, but this is generally a very
special purpose need and not something we release with ShieldBattery.
- **shieldbattery**: Node-embedded DLL that gets injected into Starcraft by
**psi** and links in **forge**, **node-bw**, and **snp**.
- **snp**: Storm Network Provider linked into **shieldbattery** (generic
interface dll that Starcraft uses to e.g. send packets and retrieve game lists).
Most of the network code is implemented in JavaScript.
- **node-bw**: native V8/Node bindings for Starcraft, linked into
**shieldbattery**.
- **node-psi**: native V8/Node bindings for **psi**, providing things like JS
functions for process creation and DLL injection.
- **v8-helpers**: V8-related utility functionality for use in our linked Node
C++ modules.

## Running Shieldbattery
After building the project, due to some race condition stuff, you will need to
start the psi service manually (you can do so in `services.msc`). That's pretty
much it for the shieldbattery side of things. If you'd actually like to play a
game through ShieldBattery, you'll need to have a
[manner-pylon](https://github.com/tec27/manner-pylon) server running, either
locally or you can use the [online dev version](https://dev.shieldbattery.net/)
(currently unupdated).

Note: If you're running manner-pylon locally (or on any other non-official
host), you will need to add those extra hosts to the allowed hosts list. You do
this by creating a file called `dev.json` in the `SHIELDBATTERY_PATH` and
entering something like this:

```
{
  "extraAllowedHosts": [
    "http://localhost",
    "https://localhost",
    "https://example.com"
  ]
}
```

Scheme (http or https) and port must match the host you'll be connecting from to
be allowed through.
