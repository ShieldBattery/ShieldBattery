module.exports = function(req, user) {
  req.session.userId = user.id
  req.session.userName = user.name
}
