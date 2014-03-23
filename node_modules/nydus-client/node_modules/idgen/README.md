idgen
-----

Minimal ID generator

[![build status](https://secure.travis-ci.org/carlos8f/node-idgen.png)](http://travis-ci.org/carlos8f/node-idgen)

Features (vs. traditional UUIDs and semi-deterministic alternatives):

- Uses `a-zA-Z0-9` for compactness and readability. I think hex-based UUIDs are too long and hard to identify at a glance.
- Has flexible length and character set (adjust length to increase uniqueness or compactness). Doesn't impose a specific format on the developer.
- Uses no crypto, to make it fast.
- Opaque, doesn't require any input data or need to reveal a MAC address, timestamp, or sequence number.
- Timestamp can be encoded into the first characters to increase uniqueness (16+ character IDs).
- Usable in both node and browser (also an advantage over mysql-style autoincremented IDs).

Install
=======

```bash
$ npm install idgen
```

Usage
=====

```javascript
var idgen = require('idgen');

// simple 8-character opaque id
idgen();
// returns: 1WWQ1OEc

// more collision-proof 16-character id with timestamp encoded into first 7 chars:
idgen(16);
// returns: NHUfJAAzlBXfckWD

// custom length and character set
idgen(10, 'abcdefg');
// returns: egbacgfbgc
```

CLI version
===========

```bash
$ npm install -g idgen
$ idgen
1WWQ1OEc
$ idgen 16
NHUgH3IIfFXNtszP
$ idgen 4 0123456789
6533
$ idgen_hex 24
dd8ea9d0243e1a9b2f28a068
```

Isn't it likely that I will see collisions?
===========================================

Maybe. Try using [idgen-collider](https://github.com/carlos8f/node-idgen-collider)
to find when collisions start to happen with your chosen character length and
character set.

Note! As of idgen 1.2.0, IDs of 16+ characters will include a 7-character prefix based
on the current millisecond time, to reduce likelihood of collisions.

License
=======

MIT