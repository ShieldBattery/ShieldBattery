// Example config file
// Fill in the correct values for your environment and rename to config.js
// NOTE: you will also need to configure your databases in database.json for db-migrate
var config = module.exports
  , fs = require('fs')

config.canonicalHost = 'https://localhost' // main HTTPS url for the site
config.httpsPort = 443
config.httpPort = 80

config.db =
{ connString: JSON.parse(fs.readFileSync('./database.json')).dev
}
