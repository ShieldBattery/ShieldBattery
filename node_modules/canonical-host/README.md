# canonical-host

Redirect users to the canonical hostname for your site.

## Usage

```javascript
var canon = require('canonical-host')('my-site.com', 'other-site.com')

http.createServer(function (req, res) {
  // returns 'true' if it's taking over
  if (!canon(req, res)) return

  // now we know that they're visiting either my-site.com
  // or other-site.com
  res.end('Hello from the proper host name!')
})
```

## canon(hosts..., [statusCode=301])

Pass in the request, the response, 1 or more hostnames to accept,
and optionally a statusCode to send with the redirect.

If the host arg has `https://` in front of it, then it will be
redirected to https if it's not https already.  Likewise if it starts
with `http://` and is already https.

Returns a function that takes a req/res pair, and which returns
true if it redirected, false otherwise.
