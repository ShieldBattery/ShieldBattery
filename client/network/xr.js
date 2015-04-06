let xr = require('xr')
  , readCookies = require('./read-cookies')

let JSON_PREFIX = /^\)\]\}',?\n/
function loadJson(str) {
  let replaced = str.replace(JSON_PREFIX, '')
  return JSON.parse(replaced)
}

let oldHeaders = xr.defaults.headers
xr.configure({
  load: loadJson,
})

let headersArg = {
  get headers() {
    return Object.assign(oldHeaders, {
      'X-XSRF-TOKEN': readCookies()['XSRF-TOKEN']
    })
  },
}


for (let method of ['get', 'put', 'post', 'patch']) {
  let old = xr[method]
  xr[method] = (url, data, args) => old(url, data, Object.assign(args || {}, headersArg))
}
for (let method of ['del', 'options']) {
  let old = xr[method]
  xr[method] = (url, args) => old(url, Object.assign(args || {}, headersArg))
}

module.exports = xr
