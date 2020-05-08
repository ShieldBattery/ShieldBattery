import httpErrors from 'http-errors'
import redis from '../redis'
import sessionStore from './session-store'

export default async function (ctx, updatedValues) {
  if (!ctx.session.userId) {
    throw new httpErrors.Unauthorized()
  }

  const userSessionsKey = 'user_sessions:' + ctx.session.userId
  const userSessionIds = await redis.smembers(userSessionsKey)

  for (const sessionId of userSessionIds) {
    // NOTE(2Pac): There is actually a race condition here (we first get the value, then modify and
    // store it back; something else could modify it between the get and the store). However, fixing
    // it would be quite involved (would probably need to modify the redis store) and the impact of
    // it is not that great, so it's whatever.
    const session = await sessionStore.get(sessionId)
    if (session) await sessionStore.set(sessionId, { ...session, ...updatedValues })
  }

  // Above updates the sessions directly in the store, but the current session on the server remains
  // unupdated. So we update it manually here.
  for (const [key, value] of Object.entries(updatedValues)) {
    ctx.session[key] = value
  }
}
