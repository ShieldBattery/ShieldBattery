// Example config file
// Fill in the correct values for your environment and rename to config.js
// NOTE: you will also need to configure your databases in database.json for db-migrate
var config = module.exports
  , fs = require('fs')

config.canonicalHost = 'https://localhost' // main HTTPS url for the site
config.httpsPort = 443
config.httpPort = 80

config.sessionSecret = 'shhhhhhh'
config.sessionTtl = 1209600 // in seconds

config.db = {
  connString: JSON.parse(fs.readFileSync('./database.json')).dev
}

config.redis = {
  host: 'localhost'
, port: 6379
}

config.logLevels = {
  file: 'warn'
, console: 'debug'
}

config.https = {
  ca: []
, key: fs.readFileSync(require.resolve('./certs/server.key'), 'utf8')
, cert: fs.readFileSync(require.resolve('./certs/server.crt'), 'utf8')
}
// If you want to turn https off (e.g. for local development), you can also do:
// config.https = false
