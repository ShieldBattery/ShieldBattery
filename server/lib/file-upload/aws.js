import path from 'path'
import aws from 'aws-sdk'

// Convert some of the more frequently used options to the AWS formatting
function formatOptions(options = {}) {
  const formatted = {}
  if (options.cache) {
    formatted.CacheControl = options.cache
  }
  if (options.type) {
    formatted.ContentType = options.type
  }
  if (options.expires) {
    formatted.Expires = options.expires
  }

  return formatted
}

// This is a generic implementation of a file-store using the aws-sdk. Note however, that it can be
// used by any compatible storage provider, e.g. DigitalOcean Spaces or Amazon S3.
export default class Aws {
  constructor({ endpoint, accessKeyId, secretAccessKey, region, bucket }) {
    const options = {
      accessKeyId,
      secretAccessKey,
    }

    // DO Spaces use endpoints
    if (endpoint) {
      options.endpoint = new aws.Endpoint(endpoint)
    }
    // Amazon S3 uses regions
    if (region) {
      options.region = region
    }

    this.bucket = bucket
    this.client = new aws.S3(options)
  }

  _getNormalizedPath(filename) {
    // Force posix path separators on aws-compatible services which use it to create faux folders.
    const normalized = path.posix.normalize(filename)
    if (path.isAbsolute(normalized) || normalized[0] === '.') {
      throw new Error('Invalid directory')
    }
    return normalized
  }

  async write(filename, stream, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, Body: stream, ...formatOptions(options) }
    return this.client.upload(params).promise()
  }

  async delete(filename, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.deleteObject(params).promise()
  }

  async url(filename, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.getSignedUrlPromise('getObject', params)
  }
}
