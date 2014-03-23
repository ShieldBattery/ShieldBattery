# pgpass

[![Build Status](https://travis-ci.org/hoegaarden/pgpass.png?branch=master)](https://travis-ci.org/hoegaarden/pgpass)

## Install

```sh
npm install --save hoegaarden/pgpass
```

## Usage
```js
var pgPass = require('pgpass');

var connInfo = {
  'host' : 'pgserver' ,
  'user' : 'the_user_name' ,
};


// ---- async ----
pgPass(connInfo, function(pass){
  conn_info.password = pass;
  // connect to postgresql server
});
```

## Description

This module tries to read the `~/.pgpass` file (or the equivalent for windows systems). If the environment variable `PGPASSFILE` is set, this file is used instead. If everything goes right, the password from said file is to the callback; if the password cannot be read `undefined` is passed to the callback.

Cases where `undefined` is returned:

- the environment variable `PGPASSWORD` is set
- the file cannot be read (wrong permissions, no such file, ...)
- for non windows systems: the file is write-/readable by the group or by other users
- there is no matching line for the given connection info

The goal of this package is to get included in the `node-postgresql` module to get the same behaviour for the javascript client as for the native client.

## Tests

There are tests in `./test/`; including linting and coverage testing. Running `npm test` runs:

- `jshint`
- `mocha` tests
- `jscoverage` and `mocha -R html-cov`

You can see the coverage report in `coverage.html`.


## Development, Patches, Bugs, ...

If you find Bugs or have improvments, please feel free to open a issue on github. If you provide a pull request, I'm more than happy to merge them, just make sure to add tests for your changes.

## Links

- https://github.com/hoegaarden/node-pgpass
- http://www.postgresql.org/docs/current/static/libpq-pgpass.html
- https://wiki.postgresql.org/wiki/Pgpass
- https://github.com/postgres/postgres/blob/master/src/interfaces/libpq/fe-connect.c
