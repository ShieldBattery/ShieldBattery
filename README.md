#shieldbattery
Most of the client-side parts of the shieldbattery project, including an injector service, an injected game management DLL, a game network provider, and various other utilities. A lot of this is still in flux and will change rapidly.

##Developer Setup
Shieldbattery is a combination of C++ and JavaScript, and thus developing for it requires setting up two separate environments. This is slightly complex due to all the various projects changing at once. If you only want to make JS changes, you can skip the C++ setup and move on to the JS setup, but you'll need to get compiled binaries for the C++ parts (ask another project member! These will hopefully be hosted in a central location soon). Windows Vista or later is required to work with the code.

###C++ Setup
Developing the C++ components will require an install of Visual Studio 2012 or greater. I believe the [Express Edition](http://www.microsoft.com/visualstudio/eng/products/visual-studio-express-products) should work, but I have not tested this personally.

####Environment Setup
Building shieldbattery properly requires some environment variables to be set so that it can properly move things around after building. Set your environment variables as follows:
```
SHIELDBATTERY_PATH=<path to your desired shieldbattery test install>
BROOD_WAR_PATH=<path to your brood war installation>
```
For me, this is:
```
SHIELDBATTERY_PATH=C:\shieldbattery\
BROOD_WAR_PATH=C:\Program Files (x86)\Starcraft\
```
####Getting Project Files
Visual Studio project files are generated using [gyp](https://code.google.com/p/gyp/). This is the canonical source for project files, so they will not be checked into git. You'll need a copy of [Python 2.7.x](http://www.python.org/download/) installed to use gyp.

Generating the project files should be straightforward, simply run `vcbuild.bat` in the base directory. This will generate the solution and project files for you to open in Visual Studio (namely, `shieldbattery.sln`). If you encounter any problems utilizing these generated projects, please report them here or submit a fix to the gyp file, don't just fix them in Visual Studio!

The various project files are:
- common: utility classes that are used almost everywhere.
- scout: multiplexing injectee DLL. I use this with InfectInject, but this method will soon be replaced by Psii.
- shieldbattery: Node embedded in a dll that loads a specific JS file on startup.
- snp: Storm Network Provider dll (generic interface dll that Starcraft uses to e.g. send packets and retrieve game lists).

####Running Shieldbattery
Currently running the code is more of a pain than it needs to be. I utilize an InfectInject'd Starcraft exe to load the scout dll before Starcraft's entry point, and inject in wmode and shieldbattery. If you are very eager to run this, you can do so as well, but Psi will come along shortly and make this easier.

###JavaScript Setup
Developing on the JS side of Shieldbattery will require an install of (node.js)[http://nodejs.org/] (the latest version, 0.10.12 at the time of writing, will do fine). Once you have installed node, you'll need to setup a link or install of (node-bw)[https://github.com/tec27/node-bw] in `./shieldbattery/js/`. To do so, you can either use `npm install` or `npm link`. I recommend the latter, as node-bw will be changing rapidly for the time being. To do the link route, first clone node-bw from github, then:

```
cd <node-bw-clone-directory>
npm link
cd <shieldbattery-clone-directory>/shieldbattery/js
npm link node-bw
```

This is a one-time process when you first clone the repo (just make sure you keep the node-bw repo up to date!).

The `js` directory gets symlinked into the Shieldbattery test install directory you setup above whenever the Shieldbattery solution is rebuilt. `shieldbattery.js` is the entry-point.
