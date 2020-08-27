import path from 'path'
import aws from 'aws-sdk'

// How long browsers can cache resources for (in seconds). These resources should all be pretty
// static, so this can be a long time
export const FILE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60

// Convert some of the more frequently used options to the AWS formatting
function formatOptions(options = {}) {
  const formatted = { ...options }
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

  // Options object can contain any of the valid keys specified in the AWS SDK for the `upload`
  // function. Besides those, we allow sending some of the more frequently used options in a more
  // friendlier format, e.g. `cache` can be sent instead of `CacheControl`, and `type` can be sent
  // instead of `ContentType`.
  async write(filename, stream, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = {
      Key: normalized,
      Bucket: this.bucket,
      Body: stream,
      CacheControl: `max-age=${FILE_MAX_AGE_SECONDS}`,
      ...formatOptions(options),
    }
    return this.client.upload(params).promise()
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `deleteObject` function.
  async delete(filename, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.deleteObject(params).promise()
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `deleteObjects` function.
  async deleteFiles(prefix, options = {}) {
    const files = await this.client.listObjectsV2({ Prefix: prefix, Bucket: this.bucket }).promise()
    const keys = files.Contents.map(file => ({ Key: file.Key }))
    const params = { Delete: { Objects: keys }, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.deleteObjects(params).promise()
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `getSignedUrlPromise` function. Besides those, we allow sending some of the more frequently
  // used options in a more friendlier format, e.g. `expires` can be sent instead of `Expires`
  // which defines how long the fetched URL will be accessible for (default is 15mins).
  async url(filename, options = {}) {
    const normalized = this._getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.getSignedUrlPromise('getObject', params)
  }
}
