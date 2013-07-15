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
- scout: multiplexing injectee DLL. I use this with InfectInject, but this method is deprecated now that psi is working.
- shieldbattery: Node embedded in a dll that loads a specific JS file on startup.
- snp: Storm Network Provider dll (generic interface dll that Starcraft uses to e.g. send packets and retrieve game lists).
- node-bw: native V8/Node bindings for Starcraft (and to a slight extent, shieldbattery).
- node-psi: native V8/Node bindings for psi
- v8-helpers: V8-related utility functionality for use in our Node C++ modules (node-bw and node-psi)

The generated `shieldbattery.sln` will contain all of these projects, and is what you should use if you desire to edit the code with an IDE.

####Running Shieldbattery
Run psi.exe as an administrator from your `SHIELDBATTERY_PATH` directory, then launch the `websocket-launcher.htm` and set your settings as you see fit. The command-prompt for psi should show a connection being accepted. The buttons on the website will launch the game and handle all the configuration to get into a game.

If you'd like your testing to be a bit more pleasurable, you can currently tell psi to inject other DLLs into Starcraft. I personally use wmode, and you can download a zip for psi [here](http://tec27.com/sbat-test-plugins.zip). Simply extract the plugins directory to your `SHIELDBATTERY_PATH` and make sure wmode is specified for injecting on the test page.
