var browserify = require('browserify')
  , koaWatchify = require('koa-watchify')
  , watchify = require('watchify')
  , koaStatic = require('koa-static')
  , router = require('koa-router')()
  , path = require('path')
  , fs = require('fs')
  , constants = require('./shared/constants')
  , isDev = require('./server/env/is-dev')
  , httpErrors = require('./server/http/errors')

var jsFileMatcher = RegExp.prototype.test.bind(/\.js$/)

function* send404(next) {
  throw new httpErrors.NotFoundError()
}

function applyRoutes(app) {
  app.use(router.routes())
    .use(router.allowedMethods())

  // client script (browserified)
  let bundle = browserify({
    entries: [ require.resolve('./client/index.jsx') ],
    fullPaths: false,
    debug: isDev,
    packageCache: {},
    cache: {}
  })

  if (isDev) {
    bundle.transform('livereactload', { global: true })
    bundle = watchify(bundle)
    // start up a livereactload server to enable live reloading
    let livereload = require('livereactload')
    livereload.listen()
    bundle.on('update', () => livereload.notify())
  } else {
    bundle.transform('uglifyify', { global: true })
  }
  router.get('/scripts/client.js', koaWatchify(bundle))

  
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

  // common requests that we don't want to return the regular page for
  // TODO(tec27): we should probably do something based on expected content type as well
  router.get('/robots.txt', send404)
    .get('/favicon.ico', send404)

  // catch-all for the remainder, first tries static files, then if not found, renders the index and
  // expects the client to handle routing
  router.get(/^\/.*$/, koaStatic(path.join(__dirname, 'public')), function*(next) {
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
