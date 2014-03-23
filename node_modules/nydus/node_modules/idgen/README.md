idgen
-----

Minimal ID generator

[![build status](https://secure.travis-ci.org/carlos8f/node-idgen.png)](http://travis-ci.org/carlos8f/node-idgen)

Features (vs. traditional UUIDs):

- Uses [base64url](http://tools.ietf.org/html/rfc4648#section-5) encoding
  for compactness and readability. I think hex-based UUIDs are too long and
  hard to identify at a glance. base64url works nicely in URLs and can
  be generated from a Buffer.
- Supports deterministic IDs by passing in a Buffer, created using SHA or HMAC for example.
- Supports generating any length ID (adjust length to increase uniqueness or compactness).
- Can produce cryptographically secure random strings.

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
idgen(8);
// returns: 1WWQ1OEc

// more collision-proof 16-character id:
idgen(16);
// returns: C1574ad7cX6ztPsD

// from a Buffer:
idgen(Buffer('8da307895368fcca53995503407f950c3291eb1d34af51237f500ac7e5bdf009', 'hex'));
// returns: jaMHiVNo_MpTmVUDQH-VDDKR6x00r1Ejf1AKx-W98Ak

// to get the Buffer back,
Buffer('jaMHiVNo_MpTmVUDQH-VDDKR6x00r1Ejf1AKx-W98Ak', 'base64').toString('hex')
// returns: 8da307895368fcca53995503407f950c3291eb1d34af51237f500ac7e5bdf009

// from a Buffer, truncated to 16 characters:
idgen(16, Buffer('8da307895368fcca53995503407f950c3291eb1d34af51237f500ac7e5bdf009', 'hex'));
// returns: jaMHiVNo_MpTmVUD
```

CLI version
===========

```bash
$ npm install -g idgen
$ idgen
1WWQ1OEc
$ idgen 16
C1574ad7cX6ztPsD
$ echo -n "carlos" | idgen
Y2FybG9z
```

License
=======

MIT