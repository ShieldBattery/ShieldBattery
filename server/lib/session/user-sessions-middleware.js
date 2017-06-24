// Middleware that tracks session IDs for a given user. Session IDs are added to a redis set and any
// time this set is modified, its TTL is reset to the TTL of a session.
import redis from '../redis'
import config from '../../config'

// This middleware must be placed *after* the session middleware in the chain of middlewares
export default function() {
  return async(ctx, next) => {
    await next()

    if (ctx.sessionId && ctx.session.userId) {
      const userSessionsKey = 'user_sessions:' + ctx.session.userId
      await redis.sadd(userSessionsKey, 'koa:sess:' + ctx.sessionId)
      await redis.expire(userSessionsKey, config.sessionTtl)
    }
  }
}
