import path from 'path'
import util from 'util'
import aws from 'aws-sdk'

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
    this.getSignedUrlAsync = util.promisify(this.client.getSignedUrl.bind(this.client))
  }

  _getNormalizedPath(filename) {
    const normalized = path.normalize(filename)
    if (path.isAbsolute(normalized) || normalized[0] === '.') {
      throw new Error('Invalid directory')
    }
    return normalized
  }

  async write(filename, stream, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, Body: stream, ...options }
    return this.client.upload(params).promise()
  }

  async delete(filename, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...options }
    return this.client.deleteObject(params).promise()
  }

  async url(filename, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...options }
    return this.getSignedUrlAsync('getObject', params)
  }
}
