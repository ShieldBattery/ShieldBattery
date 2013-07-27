var browserify = require('browserify-middleware')
  , path = require('path')

function applyRoutes(app) {
  // client script (browserified)
  browserify.settings({ transform: [ 'browserify-ngmin' ] })
  app.get('/scripts/client.js', browserify(path.join('.', 'client', 'index.js')))

  // partials
  app.get('/partials/:name', function(req, res) {
    res.render(path.join('partials', req.params.name))
  })

  // common requests that we don't want to return the regular page for
  // TODO(tec27): we should probably do something based on expected content type as well
  app.get('/favicon.ico', function(req, res) {
    res.status(404)
  }).get('/robots.txt', function(req, res) {
    res.status(404)
  })

  // catch-all for the remainder, renders the index and expects angular to handle routing clientside
  app.get('*', function(req, res) {
    res.render('index')
  })
}

module.exports = applyRoutes
