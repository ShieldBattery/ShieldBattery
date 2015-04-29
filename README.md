#shieldbattery
The client-side parts of the shieldbattery project, including an injector service, an injected game management DLL, a game network provider, a windowed mode for StarCraft:Brood War and various other utilities.

##IRC
The shieldbattery developers frequent `#shieldbattery-dev` on QuakeNet, feel free to stop in with questions, comments, or just to hang out!

##Developer Setup
Shieldbattery is a combination of C++ and JavaScript, and thus developing for it involves two different workflows. A script is included to setup both areas, `vcbuild.bat`. This will both generate C++ project files as well as build the native Node modules and link them into your environment.

Developing for shieldbattery will require an install of Visual Studio 2012 or greater. I believe the [Express Edition](http://www.microsoft.com/visualstudio/eng/products/visual-studio-express-products) should work, but I have not tested this personally. It also requires [iojs](http://iojs.org) or [node.js](http://nodejs.org/) to be installed, any version >= 0.12.x should work fine (if you also want to run manner-pylon, install iojs).

####Environment Setup
Building shieldbattery properly requires some environment variables to be set so that it can properly move things around after building. Set your environment variables as follows:
```
SHIELDBATTERY_PATH=<path to your desired shieldbattery test install>
```
For me, this is:
```
SHIELDBATTERY_PATH=C:\shieldbattery\
```

Note that this should *not* be the same place that you cloned the repo. Setting your test install directory to the same directory as your repo will not work correctly, and is not at all a desired way of doing things.
####Getting Project Files
Visual Studio project files are generated using [gyp](https://code.google.com/p/gyp/). This is the canonical source for project files, so they will not be checked into git. You'll need a copy of [Python 2.7.x](http://www.python.org/download/) installed to use gyp.

Generating the project files should be straightforward, simply run `vcbuild.bat` in the base directory. This will generate the solution and project files for you to open in Visual Studio (namely, `shieldbattery.sln`). If you encounter any problems utilizing these generated projects, please report them here or submit a fix to the gyp file, don't just fix them in Visual Studio!

The various project files/folders are:
- bundler: a script that bundles up all the binaries and scripts.
- common: utility classes that are used almost everywhere.
- forge: windowed mode and general rendering wrapper for ShieldBattery.
- installer: WiX installer project used for installing ShieldBattery.
- logger: logging class for pushing log lines from C++->JS (so they can be put in the same log file in the same format)
- js: All the javascript for the various projects, including linked in node-psi and node-bw.
- psi: background service that handles launching and injecting Starcraft (also embedded Node).
- psi-emitter: an executable which detects the desktop resolution.
- scout: multiplexing injectee DLL. I use this with InfectInject, but this method is deprecated now that psi is working.
- shieldbattery: Node embedded in a dll that loads a specific JS file on startup.
- snp: Storm Network Provider dll (generic interface dll that Starcraft uses to e.g. send packets and retrieve game lists).
- node-bw: native V8/Node bindings for Starcraft (and to a slight extent, shieldbattery).
- node-psi: native V8/Node bindings for psi
- v8-helpers: V8-related utility functionality for use in our Node C++ modules (node-bw and node-psi)

The generated `shieldbattery.sln` will contain all of these projects, and is what you should use if you desire to edit the code with an IDE.

####Running Shieldbattery
After building the project, due to some race condition stuff, you will need to start the psi service manually (you can do so in services.msc). That's pretty much it for the shieldbattery side of things. If you'd actually like to play a game over ShieldBattery, you'll need to have a [manner-pylon](https://github.com/tec27/manner-pylon) server running, either locally or you can use [online dev version](https://dev.shieldbattery.net/) (currently unupdated).

Note: If you're running manner-pylon locally (or on any other non-official host), you will need to add those extra hosts to the allowed hosts list. You do this by creating a file called `dev.json` in the `SHIELDBATTERY_PATH` and entering something like this:
```
{
  "extraAllowedHosts": [
    "http://localhost",
    "https://localhost",
    "https://mycooldomain.com"
  ]
}
```
