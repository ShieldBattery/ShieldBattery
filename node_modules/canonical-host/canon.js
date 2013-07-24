module.exports = canon

var url = require('url')

function canon (hosts) {
  if (!hosts) {
    throw new Error('Must provide at least one canonical hostname')
  }
  // default to not-https
  if (!hosts.match(/^https?:\/\//)) hosts = 'http://' + hosts
  hosts = [url.parse(hosts)]
  var statusCode = 301
  for (var i = 1; i < arguments.length; i ++) {
    var a = arguments[i]
    if (typeof a === 'number') statusCode = a
    else {
      // default to not-https
      if (!a.match(/^https?:\/\//)) a = 'http://' + a
      hosts.push(url.parse(a))
    }
  }
  var len = hosts.length
  return redirector(statusCode, hosts, hosts.length)
}

function redirector (statusCode, hosts, len) {
  return function cannon (req, res, cb) {
    var h = req.headers.host
    // not sending a hostname is not at ALL canonical!
    if (!h) {
      res.statusCode = 400
      res.end('Bad request\n')
      return true
    }

    var ssl = !!req.socket.encrypted
    h = url.parse('http' + (ssl ? 's' : '') + '://' + h)
    var redir = hosts[0]

    FOR: for (var i = 0; i < len; i++) {
      var spec = hosts[i]
      // if it's a host we like, and https is not required,
      // or it is required and provided, then that's a match.
      var hostNameMatch = spec.hostname === h.hostname
      // if the port is not specified, or not sent, then pretend
      // that it matches.
      var portMatch = spec.port === h.port ||
                      !spec.port ||
                      !h.port

      // the protocol wasn't set to https, then accept anything.
      // if we must have https, then redirect to that.
      // Handy for servers that listen on both :80 and :443, and want
      // to forward all traffic to the :443 server, but with one
      // canon function.
      var protoMatch = (spec.protocol === h.protocol) ||
                       (spec.protocol !== 'https:')

      // using a bitmask for this is silly, but it's the easiest way
      // to make sure I cover every possible case.
      var mask = (hostNameMatch ? 4 : 0) +
                 (portMatch ? 2 : 0) +
                 (protoMatch ? 1 : 0)

      switch (mask) {
        case 7:
          // user has sent canonical hostname!  horray!
          if (typeof cb === 'function') cb()
          return false

        case 6: // hostName and host, but not protocol
        case 5: // hostname and proto, but not port, and it was specified
        case 4: // similar to 6.
          // This is a close enough match.  Redirect here,
          // unless another canonical match already called dibs.
          if (!redir) redir = spec
          continue

        case 3: // port and proto, but not hostname
        case 2: // only port, but not hostname/ssl
        case 1: // only protocol matches.  Keep looking.
        case 0: // nothing matches.  keep looking.
          continue
      }

      throw new Error('unreachable')
    }


    redir = redir.protocol + '//' + redir.host + url.parse(req.url).path
    redir = url.format(redir)

    res.statusCode = statusCode
    res.setHeader('location', redir)
    res.end('<html>Moved: <a href="' + redir + '">' + redir + '</a>\n')
    return true
  }
}
