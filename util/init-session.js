module.exports = function(req, user, permissions) {
  req.session.userId = user.id
  req.session.userName = user.name
  req.session.permissions = permissions
}
