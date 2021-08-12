import { Context } from 'koa'
import { ClientSessionInfo } from '../../../common/users/session'

export default function initSession(ctx: Context, data: ClientSessionInfo) {
  const { user, permissions, lastQueuedMatchmakingType } = data

  if (!ctx.session) {
    throw new Error('Session must be created on context first')
  }
  if (typeof user.id !== 'number') {
    throw new Error('Sessions can only be initialized for users saved in the DB')
  }

  ctx.session.userId = user.id
  ctx.session.userName = user.name
  ctx.session.email = user.email
  ctx.session.emailVerified = user.emailVerified
  ctx.session.permissions = permissions
  ctx.session.lastQueuedMatchmakingType = lastQueuedMatchmakingType
}
