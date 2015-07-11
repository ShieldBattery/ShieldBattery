import xr from 'xr'
import readCookies from './read-cookies'

const JSON_PREFIX = /^\)\]\}',?\n/
function loadJson(str) {
  const replaced = str.replace(JSON_PREFIX, '')
  return JSON.parse(replaced)
}

const oldHeaders = xr.defaults.headers
xr.configure({
  load: loadJson,
})

const headersArg = {
  get headers() {
    return Object.assign(oldHeaders, {
      'X-XSRF-TOKEN': readCookies()['XSRF-TOKEN']
    })
  },
}


for (const method of ['get', 'put', 'post', 'patch']) {
  const old = xr[method]
  xr[method] = (url, data, args) => old(url, data, Object.assign(args || {}, headersArg))
}
for (const method of ['del', 'options']) {
  const old = xr[method]
  xr[method] = (url, args) => old(url, Object.assign(args || {}, headersArg))
}

export default xr
