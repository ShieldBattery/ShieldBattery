var crypto = require('crypto');

/**
 * id generator
 * ------------
 *
 * @exports {Function} id generator function
 */

/**
 * @param [len] {Number} Length of the ID to generate (defaults to 16). Can be omitted if buffer is specified.
 * @param [buf] {Buffer} Buffer to use to encode the output. If undefined, will use random bytes.
 * @return {String} A base64url string representing the input buffer or random bytes,
 *   trimmed to the length specified.
 */
function idgen(len, buf) {
  if (Buffer.isBuffer(len)) {
    buf = len;
    len = 0;
  }
  if (typeof len !== 'number') len = 16;

  if (!Buffer.isBuffer(buf)) {
    var numBytes = Math.ceil(Math.log(Math.pow(64, len)) / Math.log(2) / 8);
    buf = crypto.randomBytes(numBytes);
  }

  return buf.toString('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=/g, '')
    .substr(0, len || undefined);
}

module.exports = idgen;
