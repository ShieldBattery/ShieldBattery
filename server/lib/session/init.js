export default function(ctx, user, permissions) {
  ctx.session.userId = user.id
  ctx.session.userName = user.name
  ctx.session.email = user.email
  ctx.session.emailVerified = user.emailVerified
  ctx.session.permissions = permissions
}
