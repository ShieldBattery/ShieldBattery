var browserify = require('browserify')
  , koaWatchify = require('koa-watchify')
  , watchify = require('watchify')
  , koaStatic = require('koa-static')
  , router = require('koa-router')()
  , path = require('path')
  , fs = require('fs')
  , constants = require('./shared/constants')

var jsFileMatcher = RegExp.prototype.test.bind(/\.js$/)

function* send404(next) {
  this.status = 404
}

var IS_DEV = (process.env.NODE_ENV || 'development') == 'development'

function applyRoutes(app) {
  app.use(router.routes())
    .use(router.allowedMethods())

  // client script (browserified)
  var bundle = browserify({
    entries: [ require.resolve('./client/index.js') ],
    fullPaths: false,
    debug: IS_DEV,
    packageCache: {},
    cache: {}
  })

  if (IS_DEV) {
    bundle = watchify(bundle)
  } else {
    bundle.transform({ global: true }, 'uglifyify')
  }
  router.get('/scripts/client.js', koaWatchify(bundle))

  // static files
  router.get(/^\/public\/.+$/, koaStatic(path.join(__dirname)))

  // api methods (through HTTP)
  var apiFiles = fs.readdirSync(path.join(__dirname, 'server', 'api'))
    , baseApiPath = '/api/1/'
  apiFiles.filter(jsFileMatcher).forEach(filename => {
    var apiPath = baseApiPath + path.basename(filename, '.js')
      , routeHelper = new RouteHelper(router, apiPath)
    require('./server/api/' + filename)(routeHelper)
    console.log('mounted ' + apiPath)
  })
  // error out on any API URIs that haven't been explicitly handled, so that we don't end up
  // sending back HTML due to the wildcard rule below
  router.all(/^\/api\/.*$/, send404)

  // partials
  router.get('/partials/:name', function*(next) {
    var partialPath = path.join('partials', this.params.name)
      , templateData = { constants: constants }
    try {
      yield this.render(partialPath, templateData)
    } catch (err) {
      this.log.error({ err: err, path: partialPath }, 'error rendering template')
      send404(next)
    }
  })

  // common requests that we don't want to return the regular page for
  // TODO(tec27): we should probably do something based on expected content type as well
  router.get('/robots.txt', send404)
    .get('/favicon.ico', send404)

  // catch-all for the remainder, renders the index and expects angular to handle routing clientside
  router.get(/^\/.*$/, function*(next) {
    var sessionData = null
    if (this.session.userId) {
      sessionData = {}
      sessionData.user = { id: this.session.userId, name: this.session.userName }
      sessionData.permissions = this.session.permissions
    }
    yield this.render('index', { curSession: sessionData })
  })
}

class RouteHelper {
  constructor(router, apiPath) {
    this.router = router
    this.apiPath = apiPath
  }
}

['get', 'put', 'post', 'patch', 'delete', 'all'].forEach(method => {
  RouteHelper.prototype[method] = function() {
    var args = new Array(arguments.length)
    for (var i = 0; i < arguments.length; i++) {
      args[i] = arguments[i]
    }

    args[0] = this.apiPath + args[0]
    this.router[method].apply(this.router, args)
    return this
  }
})

module.exports = applyRoutes
