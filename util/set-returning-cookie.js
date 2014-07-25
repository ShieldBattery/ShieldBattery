module.exports = function(res) {
  res.cookie('returning', 'true', { maxAge: 10 * 365 * 24 * 60 * 60 * 1000 })
}
