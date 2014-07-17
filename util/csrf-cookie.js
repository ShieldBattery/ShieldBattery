var onHeaders = require('on-headers')

module.exports = function(req, res, next) {
  onHeaders(res, function() {
    res.cookie('XSRF-TOKEN', req.csrfToken())
  })
  next()
}
