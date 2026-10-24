import { RouterContext } from '@koa/router'
import { createHash, timingSafeEqual } from 'crypto'
import { readFileSync, statSync } from 'fs'
import httpErrors from 'http-errors'

/** Loads the dedicated moderation capability once; unavailable credentials disable the endpoint. */
export function moderationServiceAuth(filename: string | undefined): (ctx: RouterContext) => void {
  let expected: Buffer | undefined
  if (filename) {
    try {
      const stat = statSync(filename)
      if (stat.isFile() && stat.size <= 128) {
        const token = readFileSync(filename, 'utf8').trim()
        if (/^[0-9a-f]{64}$/.test(token)) expected = createHash('sha256').update(token).digest()
      }
    } catch {
      // A missing or unreadable capability must never fall back to network-only authorization.
    }
  }
  return ctx => {
    const authorization = ctx.get('authorization')
    const match = authorization.length <= 128 && /^Bearer ([0-9a-f]{64})$/i.exec(authorization)
    if (
      !expected ||
      !match ||
      !timingSafeEqual(expected, createHash('sha256').update(match[1]).digest())
    ) {
      throw new httpErrors.Unauthorized('Unauthorized')
    }
  }
}
