var browserify = require('browserify-middleware')
  , path = require('path')
  , fs = require('fs')
  , constants = require('./util/constants')

var jsFileMatcher = RegExp.prototype.test.bind(/\.js$/)

function send404(req, res) {
  res.send(404)
}

function applyRoutes(app) {
  // client script (browserified)
  browserify.settings({ transform: [ 'browserify-ngmin' ] })
  app.get('/scripts/client.js', browserify(require.resolve('./client/index.js')))

  // api methods (through HTTP, which should be few, since most stuff is done through websockets)
  var apiFiles = fs.readdirSync(path.join(__dirname, 'api'))
    , baseApiPath = '/api/1/'
  apiFiles.filter(jsFileMatcher).forEach(function(filename) {
    var apiPath = baseApiPath + path.basename(filename, '.js')
    app.use(apiPath, require('./api/' + filename)())
    console.log('mounted ' + apiPath)
  })
  // error out on any API URIs that haven't been explicitly handled, so that we don't end up
  // sending back HTML due to the wildcard rule below
  app.route('/api/*')
    .all(send404)

  // partials
  app.get('/partials/:name', function(req, res) {
    var partialPath = path.join('partials', req.params.name)
      , templateData = { constants: constants }
    res.render(partialPath, templateData, function (err, html) {
      if (err) {
        req.log.error({ err: err, path: partialPath }, 'error rendering template')
        send404(req, res)
      }

      res.end(html)
    })
  })

  // common requests that we don't want to return the regular page for
  // TODO(tec27): we should probably do something based on expected content type as well
  app.get('/robots.txt', send404)
    .get('/favicon.ico', send404)

  // catch-all for the remainder, renders the index and expects angular to handle routing clientside
  app.get('*', function(req, res) {
    var sessionData = null
    if (req.session.userId) {
      sessionData = {}
      sessionData.user = { id: req.session.userId, name: req.session.userName }
      sessionData.permissions = req.session.permissions
      req.session.touch()
    }
    res.render('index', { curSession: sessionData })
  })
}

module.exports = applyRoutes
