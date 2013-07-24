// same as test/basic.js, but using the express-style middleware API.

var canon = require('../canon.js')
var test = require('tap').test
var request = require('request')

var http = require('http')
var https = require('https')
var path = require('path')
var fs = require('fs')
var url = require('url')

var key = read('agent1-key.pem')
var cert = read('agent1-cert.pem')
var opts = { key: key, cert: cert }

function read(fname) {
  fname = path.resolve(__dirname, 'keys', fname)
  return fs.readFileSync(fname)
}

var port = 1337
var servers = []

function server (cargs, opts, cb) {
  var c = canon.apply(null, cargs)
  var server = opts ? https.createServer(opts, handler)
                    : http.createServer(handler)
  var p = port++
  server.port = p
  server.canon = cargs
  server.handler = handler
  server.listen(p, function () {
    console.error((opts ? 'https' : 'http') + ' ' + p, cargs)
    servers.push(server)
    cb()
  })
  function handler (req, res) {
    // support switching out the handler later
    if (handler !== this.handler) return this.handler(req, res)

    if (c(req, res, next))
      console.error(res.statusCode, req.headers.host, req.url, cargs)

    function next() {
      console.error('200', req.headers.host, req.url, cargs)
      res.end('ok')
    }
  }
}

function req (server, host, ssl, cb) {
  var p = '/a/b/c?r=' + Math.random() + '&h=' + host
  var u = 'http' + (ssl ? 's' : '') + '://localhost:' + server.port + p
  var r = {
    url: u,
    headers: {},
    followRedirect: false
  }
  if (host) r.headers.host = host
  console.error(r)

  r = request(r, function (er, res, body) {
    return cb(er, res, body, p)
  })

  // request *always* puts a host: header on the req, because you
  // definitely always want that, except here, since we're
  // specifically testing pathological cases.
  if (!host) {
    delete r.headers.host
  }
}

test('startup', function (t) {
  var n = 0

  // basic
  server(['http.com'], null, done())
  // ssl requred
  server(['https://ssl.com'], opts, done())

  // multiple valid hostnames
  // https required for three, not one or two
  server(['one', 'two', 'https://three'], opts, done())
  server(['one', 'two', 'https://three'], null, done())

  // the port included in the hostname
  server(['httpport:'+port], null, done())
  server(['https://httpsport:'+port], opts, done())

  // redirects to the first port-style server
  server(['httpport:'+(port - 2)], null, done())
  server(['httpsport:'+(port - 2)], opts, done())

  function done () {
    n ++
    return function () {
      if (-- n === 0) {
        t.pass('done setting up')
        t.end()
      }
    }
  }
})

test('requests that do not redirect', function (t) {
  var plan = 0

  req(servers[0], 'http.com', false, done())
  req(servers[1], 'ssl.com', true, done())
  req(servers[2], 'one', true, done())
  req(servers[2], 'two', true, done())
  req(servers[2], 'three', true, done())
  req(servers[3], 'one', false, done())
  req(servers[3], 'two', false, done())
  req(servers[4], 'httpport', false, done())
  req(servers[5], 'httpsport', true, done())

  // include the correct port in host header
  req(servers[0], 'http.com:' + servers[0].port, false, done())
  req(servers[1], 'ssl.com:' + servers[1].port, true, done())
  req(servers[2], 'one:' + servers[2].port, true, done())
  req(servers[2], 'two:' + servers[2].port, true, done())
  req(servers[2], 'three:' + servers[2].port, true, done())
  req(servers[3], 'one:' + servers[3].port, false, done())
  req(servers[3], 'two:' + servers[3].port, false, done())
  req(servers[4], 'httpport:' + servers[4].port, false, done())
  req(servers[5], 'httpsport:' + servers[5].port, true, done())

  // wrong port, but allowed
  req(servers[0], 'http.com:1234', false, done())
  req(servers[1], 'ssl.com:1234', true, done())
  req(servers[2], 'one:1234', true, done())
  req(servers[2], 'two:1234', true, done())
  req(servers[2], 'three:1234', true, done())
  req(servers[3], 'one:1234', false, done())
  req(servers[3], 'two:1234', false, done())


  function done () {
    plan ++
    return handler
  }

  function handler (er, res, body) {
    if (er) throw er
    t.equal(res.statusCode, 200)
    t.equal(body, 'ok')
    if (--plan === 0) t.end()
  }
})

test('requests that do redirect', function (t) {
  var plan = 0

  req(servers[0], 'x', false, done())
  req(servers[1], 'x', true, done())
  req(servers[2], 'x', true, done())
  req(servers[3], 'x', false, done())
  req(servers[4], 'x', false, done())
  req(servers[5], 'x', true, done())

  // include the correct port in host header
  // but wrong hostname
  req(servers[0], 'x:' + servers[0].port, false, done())
  req(servers[1], 'x:' + servers[1].port, true, done())
  req(servers[2], 'x:' + servers[2].port, true, done())
  req(servers[3], 'x:' + servers[3].port, false, done())
  req(servers[4], 'x:' + servers[4].port, false, done())
  req(servers[5], 'x:' + servers[5].port, true, done())

  // wrong port, and not allowed
  req(servers[4], 'httpport:1234', false, done())
  req(servers[5], 'httpsport:1234', true, done())

  function done () {
    plan ++
    return handler
  }

  function handler (er, res, body, path) {
    if (er) throw er
    t.equal(res.statusCode, 301)
    var loc = res.headers.location
    t.ok(loc)
    console.error('loc', loc, res.headers, res.statusCode)
    t.equal(url.parse(loc).path, path)
    var re = /^<html>Moved: <a href="([^"]+)">([^<]+)<\/a>\n$/
    t.like(body, re)
    t.equal(body.match(re)[1], loc)
    t.equal(body.match(re)[2], loc)
    if (--plan === 0) t.end()
  }
})

test('requests that are wrong', function (t) {
  var plan = 0

  req(servers[0], false, false, done())
  req(servers[1], false, true, done())
  req(servers[2], false, true, done())
  req(servers[3], false, false, done())
  req(servers[4], false, false, done())
  req(servers[5], false, true, done())

  function done () {
    plan ++
    return handler
  }

  function handler (er, res, body, path) {
    if (er) throw er
    t.equal(res.statusCode, 400)
    t.equal(body, 'Bad request\n')
    if (--plan === 0) t.end()
  }
})

test('teardown', function (t) {
  var n = 0
  servers.forEach(function (s) {
    s.close(done())
  })
  function done () {
    n ++
    return function () {
      if (-- n === 0) {
        t.pass('done closing')
        t.end()
      }
    }
  }
})
