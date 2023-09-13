import { Context } from 'koa'
import { ClientSessionInfo } from '../../../common/users/session'

export default function initSession(ctx: Context, data: ClientSessionInfo) {
  const { user, permissions, lastQueuedMatchmakingType } = data

  if (!ctx.session) {
    throw new Error('Session must be created on context first')
  }

  ctx.session.user = user
  ctx.session.permissions = permissions
  ctx.session.lastQueuedMatchmakingType = lastQueuedMatchmakingType
}
