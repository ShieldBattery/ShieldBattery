// Middleware that tracks session IDs for a given user. Session IDs are added to a redis set and any
// time this set is modified, its TTL is reset to the TTL of a session.
import Redis from 'ioredis'
import config from '../../config'

const redis = new Redis()

// This middleware must be placed *after* the session middleware in the chain of middlewares
export default function() {
  return async (ctx, next) => {
    await next()

    if (ctx.sessionId && ctx.session.userId) {
      const userSessionsKey = 'user_sessions:' + ctx.session.userId
      const sessions = await redis.smembers(userSessionsKey)
      // Every time the set is modified (ie. it's not empty), the TTL is reset to the session's TTL
      if (sessions.length > 0) {
        await redis.expire(userSessionsKey, config.sessionTtl)
      }
      await redis.sadd(userSessionsKey, ctx.sessionId)
    }
  }
}
