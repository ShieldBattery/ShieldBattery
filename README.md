#manner-pylon
The official server for [shieldbattery](https://github.com/tec27/shieldbattery).

##IRC
The shieldbattery developers (and by extension, manner-pylon) frequent `#shieldbattery-dev` on QuakeNet, feel free to stop in with questions, comments, or just to hang out!

##Dependencies
manner-pylon requires [node](http://nodejs.org), [postgres](http://postgresql.org), and [redis](http://redis.io) in order to run.

###Installing dependencies on Linux/Mac
The easiest path to installing is to use the normal installer for node (from the [node website](http://nodejs.org), and your OS' package manager (or [brew](http://brew.sh/) for Mac) to install postgres and redis.

###Installing dependencies on Windows
Use the normal installer for node (from the [node website](http://nodejs.org)). Use the Windows installer from postgres as well (available [here](http://www.postgresql.org/download/windows/)). Installing redis on Windows is somewhat more of a pain. MSOpenTech maintains a fork of redis that works on Windows, but does not contain any of the necessary installer binaries, so you'll have to build them yourself. Clone [the fork](https://github.com/MSOpenTech/redis) and build the solutions as necessary until you end up with an MSI, then use that to install redis (see `redis\msvs\install\readme.txt` in that repository for further instructions). I recommend then using [NSSM](http://nssm.cc) to then create a redis service that runs on startup.

On Windows you will also need the [OpenSSL development libraries](http://slproweb.com/products/Win32OpenSSL.html) for building one of the binary dependencies (bcrypt). Download and install the Win32 or Win64 (matching your node install's affinity) OpenSSL package (*not* the Light version), making sure to put it in the default location.

##Running the server
###Initialize node modules
After downloading the server files, or after pulling new commits, you should update/install the npm modules using
```
npm install
```
OR
```
npm update
```
If you are unsure of which you need to run, running both should be fine.

###Configure the server
Copy `config.example.js` and `database.example.json` to `config.js` and `database.json`, respectively. Edit these files as you see fit to match your local configuration. Make sure to turn off HTTPS (by setting config.https to false) if you're doing local development and don't have certificates.

###Initialize the database
To initialize postgres (after having configured your user in the previous step), simply run
```
npm run migrate-up
```
You will need to run this command after pulling in commits that change that database structure as well.

###Actually run the server
The standard way to run the server is:
```
npm start
```
This command will give you better (and more colorful) logging output, but you can also simply run:
```
node index.js
```

