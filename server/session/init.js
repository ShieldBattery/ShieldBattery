module.exports = function(ctx, user, permissions) {
  ctx.session.userId = user.id
  ctx.session.userName = user.name
  ctx.session.permissions = permissions
}
