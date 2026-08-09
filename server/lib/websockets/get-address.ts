import { IncomingMessage } from 'http'

const PROXY_HEADER = 'x-forwarded-for'

// Matches the Koa app's `app.proxy` setting: only trust proxy headers when we're actually behind
// our reverse proxy.
const BEHIND_PROXY = process.env.SB_HTTPS_REVERSE_PROXY === 'true'

export default function getAddress(req: IncomingMessage): string | undefined {
  const address = req.connection.remoteAddress
  if (!BEHIND_PROXY) {
    return address
  }

  const forwardedFor = req.headers[PROXY_HEADER]
  if (forwardedFor) {
    // Our nginx proxy *appends* the address it sees to any client-supplied X-Forwarded-For, so
    // only the final entry is trustworthy (earlier entries can be forged by the client)
    const value = Array.isArray(forwardedFor) ? forwardedFor[forwardedFor.length - 1] : forwardedFor
    const entries = value.split(/\s*,\s*/)
    return entries[entries.length - 1] || address
  }

  return address
}
