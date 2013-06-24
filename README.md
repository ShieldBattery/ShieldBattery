#shieldbattery
The client-side parts of the shieldbattery project, including an injector service, an injected game management DLL, a game network provider, and various other utilities. A lot of this is still in flux and will change rapidly.

##Developer Setup
Shieldbattery is a combination of C++ and JavaScript, and thus developing for it involves two different workflows. A script is included to setup both areas, `vcbuild.bat`. This will both generate C++ project files as well as build the native Node modules and link them into your environment.

Developing for shieldbattery will require an install of Visual Studio 2012 or greater. I believe the [Express Edition](http://www.microsoft.com/visualstudio/eng/products/visual-studio-express-products) should work, but I have not tested this personally.

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

The various project files/folders are:
- common: utility classes that are used almost everywhere.
- js: All the javascript for the various projects, including linked in node-psi and node-bw.
- psi: background service that handles launching and injecting Starcraft (also embedded Node).
  - psi/node-psi: native Node bindings for psi
- scout: multiplexing injectee DLL. I use this with InfectInject, but this method will soon be replaced by Psi.
- shieldbattery: Node embedded in a dll that loads a specific JS file on startup.
  - shieldbattery/node-bw: native Node bindings for Starcraft (and to a slight extent, shieldbattery).
- snp: Storm Network Provider dll (generic interface dll that Starcraft uses to e.g. send packets and retrieve game lists).

####Running Shieldbattery
Currently running the code is more of a pain than it needs to be. I utilize an InfectInject'd Starcraft exe to load the scout dll before Starcraft's entry point, and inject in wmode and shieldbattery. If you are very eager to run this, you can do so as well, but Psi will come along shortly and make this easier.
