export default function (ctx, user, permissions) {
  ctx.session.userId = user.id
  ctx.session.userName = user.name
  ctx.session.emailVerified = user.emailVerified
  ctx.session.permissions = permissions
}
