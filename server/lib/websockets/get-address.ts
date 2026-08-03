import { IncomingMessage } from 'http'

const PROXY_HEADER = 'x-forwarded-for'

export default function getAddress(req: IncomingMessage): string | undefined {
  let address = req.connection.remoteAddress
  const forwardedFor = req.headers[PROXY_HEADER]
  if (forwardedFor) {
    address = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(/\s*,\s*/)[0]
  }

  return address
}
