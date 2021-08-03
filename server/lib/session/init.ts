import { Context } from 'koa'
import { Permissions } from '../../../common/users/permissions'
import { SelfUser } from '../../../common/users/user-info'

export default function initSession(ctx: Context, user: SelfUser, permissions: Permissions) {
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
}
