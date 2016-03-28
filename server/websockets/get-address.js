const PROXY_HEADER = 'x-forwarded-for'

export default function getAddress(req) {
  let address = req.connection.remoteAddress
  if (req.headers[PROXY_HEADER]) {
    address = req.headers[PROXY_HEADER].split(/\s*,\s*/)[0]
  }

  return address
}
