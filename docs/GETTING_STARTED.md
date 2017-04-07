# Getting Started

## Developer setup

ShieldBattery is a combination of C++ and JavaScript, and split between multiple server and client
pieces. Even if you only plan on developing JavaScript changes, you'll need to install the C++
dependencies in order to properly test things.

### Repository setup

We use a git submodule for the node dependency, which needs to be initialized after a fresh
repository clone. Run `git submodule init` followed by `git submodule update` to make this happen.
Whenever the node dependency has been updated, you'll then need to re-run `git submodule update` to
get the new changes.

### General environment setup

#### Python 2.7.x

ShieldBattery uses [gyp](https://gyp.gsrc.io/) for generating the game client project files, which
requires a working [Python 2.7.x](http://www.python.org/download/) install. Install this before
attempting to follow further steps.

### JavaScript

All of the JavaScript will either run in, or be built by, [node.js](https://nodejs.org). You'll need
to install a version of it, generally the current version is a good choice (7.3.0 at the time of
writing). The version you install does not need to match the version that the game client's
submodule is tagged to.

#### Yarn

The various JavaScript components use [Yarn](https://yarnpkg.com/) to manage their dependencies.
Install the latest version of it from their [downloads page](https://yarnpkg.com/en/docs/install).

### C++

Building the C++ code requires Visual Studio 2015 or higher. The easiest/cheapest way to get this
is through the
[Community edition](https://www.visualstudio.com/en-us/downloads/download-visual-studio-vs.aspx).

TODO(tec27): Build instructions once game client stuff has been moved around

### Server software

Along with nodejs, the server requires [PostgreSQL v9.4+](http://postgresql.org), and
[redis](http://redis.io).

#### PostgreSQL

On Windows, use the installer available [here](http://www.postgresql.org/download/windows/). On
Linux, this can generally be installed through the package manager for your OS. On Mac, use
[brew](http://brew.sh).

The PostgreSQL must be started and running with a user configured (remember what the username and
password are for this account, you'll need it when configuring the ShieldBattery server).

Detailed guides can be found at
[the PostgreSQL wiki](https://wiki.postgresql.org/wiki/Detailed_installation_guides). A simpler
guide can also be found
[here](http://www.thegeekstuff.com/2009/04/linux-postgresql-install-and-configure-from-source/).

You will need some extensions set up for our schema to work properly, run the following commands
as your database super-user (generally, `postgres`):

```sql
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
```

Note that these must be run on the database you've created for ShieldBattery (e.g. you should
choose that DB first, with `\c <yourDBname>` or something similar).

#### Redis

On Windows, use the installers provided by MSOpenTech; they can be found [here](https://github.com/MSOpenTech/redis/releases). Note that only 64-bit installers are provided.
On Linux, this can generally be installed through the package manage for your OS. On Mac, use
[brew](http://brew.sh).

The redis server can be started using

```
redis-server
```

For more documentation, check out the [redis docs](http://redis.io/documentation).

### Configuring the ShieldBattery server

Inside the `server` folder, copy `config.example.js` and `database.example.json` to `config.js` and
`database.json`, respectively. Edit these files as you see fit to match your local configuration.

### Installing dependencies

Every directory with a `yarn.lock` needs to have it's dependencies installed with Yarn. You can do
this manually, or simply run `yarnall` from the root directory:

```
yarn run yarnall
```

This should be done every time a `yarn.lock` file changes in the repository.

### Initialize the database structure

**NOTE**: PostgreSQL must be properly configured beforehand for the db-migrate scripts to work.

**NOTE**: an existing `DATABASE_URL` environment variable will take precedence over `database.json`
and should be removed or updated to match your desired database configuration.

Change into the `server` directory, then migrate the database to the latest structure with:

```
yarn run migrate-up
```

You will need to run this command after pulling in commits that change the database structure as
well.

### Run the server

The standard way to run the server is (from the `server` directory):

```
yarn start
```

This command will format and colorize the log output, but if you want/need the raw output you can
also use:

```
node index.js
```

### Set up an initial user

You'll need to update the database manually to get a user signed up. Access the server (defaulting
to http://localhost:5555) and sign up for an invite using the splash page. Then, run the following
query on your database:

```sql
UPDATE invites SET token = 'invited';
```

Navigate to the account sign up page (http://localhost:5555/signup) and plug in the email address
you signed up with, invite code as `invited`, and whatever other info you want, then create the
account. To update this account to be an admin, run the following query on your database:

```sql
UPDATE permissions SET edit_permissions = true WHERE user_id = 1;
```

Log out and back in with your user, and from then on you should be able to manage everything through
the client's admin interfaces (including adding more permissions to the root account).
