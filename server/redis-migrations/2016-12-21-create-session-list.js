import redis from '../lib/redis'
import config from '../config'

(async() => { // eslint-disable-line
  const sessionKeys = await redis.keys('koa:sess:*')
  for (const sessionId of sessionKeys) {
    const session = JSON.parse(await redis.get(sessionId))
    if (session.userId !== undefined) {
      const userSessionsKey = 'user_sessions:' + session.userId
      redis.sadd(userSessionsKey, sessionId)
      redis.expire(userSessionsKey, config.sessionTtl)
    }
  }

  redis.quit()
})()
