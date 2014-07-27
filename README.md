#manner-pylon
The official server for [shieldbattery](https://github.com/tec27/shieldbattery).

##Dependencies
manner-pylon requires [node](http://nodejs.org), [postgres](http://postgresql.org), and [redis](http://redis.io) in order to run.

###Installing dependencies on Linux/Mac
The easiest path to installing is to use the normal installer for node (from the [node website](http://nodejs.org), and your OS' package manager (or [brew](http://brew.sh/) for Mac) to install postgres and redis.

###Installing dependencies on Windows
Use the normal installer for node (from the [node website](http://nodejs.org)). Use the Windows installer from postgres as well (available [here](http://www.postgresql.org/download/windows/)). Installing redis on Windows is somewhat more of a pain. MSOpenTech maintains a fork of redis that works on Windows, but does not contain any of the necessary installer binaries, so you'll have to build them yourself. Clone [the fork](https://github.com/MSOpenTech/redis) and build the solutions as necessary until you end up with an MSI, then use that to install redis (see `redis\msvs\install\readme.txt` in that repository for further instructions). I recommend then using [NSSM](http://nssm.cc) to then create a redis service that runs on startup.

On Windows you will also need the [OpenSSL development libraries](http://slproweb.com/products/Win32OpenSSL.html) for building one of the binary dependencies (bcrypt). Download and install the Win32 or Win64 (matching your node install's affinity) OpenSSL package (*not* the Light version), making sure to put it in the default location.

##Running the server

### Cloning the repository
Install git for windows, login, and clone the `manner-pylon` repository to a folder on your system.

###Configure the server
Copy `config.example.js` and `database.example.json` to `config.js` and `database.json`, respectively. Edit these files as you see fit to match your local configuration.

###Initialize node modules
Update/install the npm modules by running the following command from the root of the `manner-pylon` directory (where `package.json` is located):
```
npm update
```
followed by
```
npm install
```
if you are installing for the first time.

###Acquire SSL certificates
If you are running the server somewhere remotely, you can get a certificate from a normal CA. If, however, you are running a local development server, you'll need to self-sign a certificate. For instructions on how to do that, see [here](http://stackoverflow.com/a/10176685/1050849). After generating the `cert.pem` and `key.pem` files with openssl, you will need to rename the files to `server.crt` and `server.key`, respectively. Create a folder called `certs` in the `manner-pylon` directory and copy the certificate files there. This location is gitignored for these purposes.

###Initialize the database
Open the Postgres **pgAdmin III** management application and create a new database called `shieldbattery`. To initialize the database with values (after having configured your user in the previous step), simply run
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

