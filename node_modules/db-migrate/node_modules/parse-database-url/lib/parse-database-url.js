var url = require("url");
var querystring = require("querystring");

/**
 * This is the exported function that parses database URLs.
 *
 * @param {String} databaseUrl the URL to be parsed
 * @return {Object<String, String>} the database configuration; this will
 *     always have the "driver" key pointing to a database driver, and may
 *     have some of the following keys: "host", "port", "user", "password",
 *     "database", "filename"
 */
module.exports = function (databaseUrl) {
  var parsedUrl = url.parse(databaseUrl, false, true);

  // Query parameters end up directly in the configuration.
  var config = querystring.parse(parsedUrl.query);

  // The protocol coming from url.parse() has a trailing :
  config.driver = (parsedUrl.protocol || "sqlite3:").replace(/\:$/, "");

  // url.parse() produces an "auth" that looks like "user:password". No
  // individual fields, unfortunately.
  if (parsedUrl.auth) {
    var userPassword = parsedUrl.auth.split(':', 2);
    config.user = userPassword[0];
    if (userPassword.length > 1) {
      config.password = userPassword[1];
    }
  }

  if (config.driver === "sqlite3") {
    if (parsedUrl.hostname) {
      if (parsedUrl.pathname) {
        // Relative path.
        config.filename = parsedUrl.hostname + parsedUrl.pathname;
      } else {
        // Just a filename.
        config.filename = parsedUrl.hostname;
      }
    } else {
      // Absolute path.
      config.filename = parsedUrl.pathname;
    }
  } else {
    config.database = parsedUrl.pathname.replace(/^\//, "").replace(/\/$/, "");

    if (parsedUrl.hostname) config.host = parsedUrl.hostname;
    if (parsedUrl.port) config.port = parsedUrl.port;
  }

  return config;
};
