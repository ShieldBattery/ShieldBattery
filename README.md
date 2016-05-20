# manner-pylon
The official server for [shieldbattery](https://github.com/tec27/shieldbattery).

## IRC
The shieldbattery developers (and by extension, manner-pylon) frequent `#shieldbattery-dev` on QuakeNet, feel free to stop in with questions, comments, or just to hang out!

## Dependencies
manner-pylon requires [Node.js](http://nodejs.org), [postgres v9.4+](http://postgresql.org), and [redis](http://redis.io) in order to run.

### Installing dependencies on Linux/Mac
The easiest path to installing is to use the normal installer for node (from the [Nodejs website](http://nodejs.org), and your OS' package manager (or [brew](http://brew.sh/) for Mac) to install postgres and redis.

### Installing dependencies on Windows
Use the normal installer for node (from the [nodejs website](http://nodejs.org)). Use the Windows installer from postgres as well (available [here](http://www.postgresql.org/download/windows/)). For Redis, use the installers provided by MSOpenTech; they can be found [here](https://github.com/MSOpenTech/redis/releases). Note that only 64-bit installers are provided.

You will also need the [OpenSSL development libraries](http://slproweb.com/products/Win32OpenSSL.html) for building one of the binary dependencies (bcrypt). Download and install the Win32 or Win64 (matching your node install's affinity) OpenSSL package (*not* the Light version), making sure to put it in the default location.

## Running the server
### Initialize node modules

After downloading the server files, or after pulling new commits, you should update/install the npm
modules using

```
npm install
```

OR

```
npm update
```

If you are unsure of which you need to run, running both should be fine.


### Start redis
The redis server can be started using

```
redis-server
```

For more documentation, check out the [redis docs](http://redis.io/documentation).

### Configure and start postgres

The postgres server must be started and running with a user configured (remember what the username
and password are for this account, you'll need this when configuring manner-pylon).

Detailed guides can be found at
[the postgres wiki](https://wiki.postgresql.org/wiki/Detailed_installation_guides). A simpler guide
can also be found
[here](http://www.thegeekstuff.com/2009/04/linux-postgresql-install-and-configure-from-source/).

You will need some extensions set up for our schema to work properly, run the following commands
as your database super-user (generally, `postgres`):
```sql
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
```

### Configure manner-pylon

Copy `config.example.js` and `database.example.json` to `config.js` and `database.json`,
respectively. Edit these files as you see fit to match your local configuration.

### Initialize the database structure

**NOTE**: postgres must be properly configured beforehand for the db-migrate scripts to work.
**NOTE**: an existing `DATABASE_URL` environment variable will take precedence over `database.json` and should be removed or updated to match your desired database configuration. 

Migrate the database template into the postgres server with

```
npm run migrate-up
```

to initialize the database structures and tables.

You will need to run this command after pulling in commits that change that database structure as
well.

### Run the server

The standard way to run the server is:

```
npm start
```

This command will format and colorize the log output, but if you want/need the raw output you can
also use:

```
node index.js
```
