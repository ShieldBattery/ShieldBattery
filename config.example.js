// Example config file
// Fill in the correct values for your environment and rename to config.js
// NOTE: you will also need to configure your databases in database.json for db-migrate
import fs from 'fs'

const config = {}
config.canonicalHost = 'https://localhost' // main HTTPS url for the site
config.httpsPort = 443
config.httpPort = 80

config.sessionSecret = 'shhhhhhh'
config.sessionTtl = 1209600 // in seconds

config.db = {
  connString: JSON.parse(fs.readFileSync('./database.json')).dev
}

config.redis = {
  host: 'localhost',
  port: 6379
}

config.logLevels = {
  file: 'warn',
  console: 'debug'
}

// Uncomment and set your Google Analytics ID to enable analytics reporting
// config.analyticsId = 'UA-000000-01'

// Uncomment and set a url to the feedback page that is shown on the main site
// config.feedbackUrl = 'http://goo.gl/forms/yaV3pAlCdzWEikTL2'

// Set a minimum required Psi version
// If the version is not specified, it defaults to no minimum version
config.minPsiVersion = '0.0.0'
// Uncomment to specify an installer URL, which will be given to clients if their Psi is detected
// to be out of date. If none is specified, no link will be given to clients.
// config.installerUrl = 'https://localhost/installer.msi'

// Settings for rally-point (forwarding servers for use by game players). Two possible options:
// - Use a local server (spun up as a child process), typical for dev
// - Use a set of remote servers, typical for production
config.rallyPoint = {
  secret: 'reallySecretString', // used for both local and remote options
  // Local server option
  local: {
    address: '::ffff:127.0.0.1', // Address that players will connect to, needs to be ipv6 formatted
    port: 14098,
  },
  // Remote servers option
  /*
  remote: [
    { address: 'rp1.shieldbattery.net', port: 14098 },
    { address: 'rp2.shieldbattery.net', port: 14098 },
  ],
  */

  // Optional, change where the routeCreator binds to (defaults to binding on everything on a
  // random port)
  /*
  routeCreator: {
    host: '::',
    port: 14099,
  }
  */
}

// Uncommenting this block will enable HTTPS, which requires generating server certs & keys
// It's advisable to leave commented if you're doing local development
/*
config.https = {
  ca: [],
  key: fs.readFileSync(require.resolve('./certs/server.key'), 'utf8'),
  cert: fs.readFileSync(require.resolve('./certs/server.crt'), 'utf8')
}
*/
export default config
