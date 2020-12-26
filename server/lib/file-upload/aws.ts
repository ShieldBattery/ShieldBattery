import path from 'path'
import { Readable } from 'stream'
import aws from 'aws-sdk'

import { FileStore } from './store'

// How long browsers can cache resources for (in seconds). These resources should all be pretty
// static, so this can be a long time
export const FILE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60

// Convert some of the more frequently used options to the AWS formatting
function formatOptions(options: any = {}) {
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
export default class Aws implements FileStore {
  readonly bucket: string
  readonly client: aws.S3

  constructor({
    endpoint,
    accessKeyId,
    secretAccessKey,
    region,
    bucket,
  }: {
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    region: string
    bucket: string
  }) {
    const options: aws.S3.ClientConfiguration = {
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

  private getNormalizedPath(filename: string): string {
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
  async write(filename: string, stream: Readable, options: any = {}) {
    const normalized = this.getNormalizedPath(filename)
    const params = {
      Key: normalized,
      Bucket: this.bucket,
      Body: stream,
      CacheControl: `max-age=${FILE_MAX_AGE_SECONDS}`,
      ...formatOptions(options),
    }
    return this.client.upload(params).promise()
  }

  async read(filename: string, options: any = {}): Promise<Buffer> {
    const normalized = this.getNormalizedPath(filename)
    const params = {
      Key: normalized,
      Bucket: this.bucket,
    }

    const result = await this.client.getObject(params).promise()
    // NOTE(tec27): AWS docs say this will be a Buffer in Node, types are weird though
    return (result.Body as Buffer) ?? Buffer.alloc(0)
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `deleteObject` function.
  async delete(filename: string, options: any = {}) {
    const normalized = this.getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.deleteObject(params).promise()
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `deleteObjects` function.
  async deleteFiles(prefix: string, options: any = {}) {
    const normalized = this.getNormalizedPath(prefix)
    const files = await this.client
      .listObjectsV2({ Prefix: normalized, Bucket: this.bucket })
      .promise()
    const keys = (files.Contents ?? []).map(file => ({ Key: file.Key }))
    const params = { Delete: { Objects: keys }, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.deleteObjects(params).promise()
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `getSignedUrlPromise` function. Besides those, we allow sending some of the more frequently
  // used options in a more friendlier format, e.g. `expires` can be sent instead of `Expires`
  // which defines how long the fetched URL will be accessible for (default is 15mins).
  async url(filename: string, options: any = {}) {
    const normalized = this.getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.getSignedUrlPromise('getObject', params)
  }

  addMiddleware() {}
}
