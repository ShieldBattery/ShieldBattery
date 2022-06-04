import Koa from 'koa'
import { container } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user'
import { Redis } from '../redis'
import sessionStore from './session-store'

export async function updateAllSessionsForCurrentUser(
  ctx: Koa.Context,
  updatedValues: Partial<Koa.AppSession>,
): Promise<void> {
  if (!ctx.session?.userId) {
    throw new Error('Cannot update sessions for current user with no active session')
  }

  // Update the user's current session first, just in case something goes wrong below, we don't
  // want to be saving the outdated session over anything we've updated
  for (const [key, value] of Object.entries(updatedValues)) {
    ;(ctx.session as any)[key] = value
  }

  return updateAllSessions(ctx.session.userId, updatedValues)
}

export async function updateAllSessions(
  userId: SbUserId,
  updatedValues: Partial<Koa.AppSession>,
): Promise<void> {
  const redis = container.resolve(Redis)
  const userSessionsKey = `user_sessions:${userId}`
  const userSessionIds = await redis.smembers(userSessionsKey)

  // Update sessions in parallel
  await Promise.all(
    userSessionIds.map(async sessionId => {
      // NOTE(2Pac): There is actually a race condition here (we first get the value, then modify
      // and store it back; something else could modify it between the get and the store). However,
      // fixing this would require locking the session store, which is a fair amount of work for a
      // extremely rare problem that probably doesn't manifest extremely terribly (the session is,
      // after all, basically just a cache of user data)
      const session = await sessionStore.get(sessionId)
      if (session) {
        await sessionStore.set(sessionId, { ...session, ...updatedValues })
      }
    }),
  )
}
