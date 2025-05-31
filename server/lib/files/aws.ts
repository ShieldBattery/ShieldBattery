import { GetObjectCommand, S3, S3ClientConfig } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import path from 'path'
import { Readable } from 'stream'
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
  if (options.acl) {
    formatted.ACL = options.acl
  }

  return formatted
}

// This is a generic implementation of a file-store using the aws-sdk. Note however, that it can be
// used by any compatible storage provider, e.g. DigitalOcean Spaces or Amazon S3.
export default class Aws implements FileStore {
  readonly baseUrl?: string
  readonly bucket: string
  readonly client: S3
  readonly cdnHost: string | undefined

  constructor({
    endpoint,
    accessKeyId,
    secretAccessKey,
    region,
    bucket,
    cdnHost,
  }: {
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    region: string
    bucket: string
    cdnHost?: string
  }) {
    const options: S3ClientConfig = {
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }

    // DO Spaces use endpoints
    if (endpoint) {
      // AWS SDK v3 constructs a new URL() out of this, so it needs to have a "https://" prefix.
      const endpointWithPrefix = /^[^:/]+:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`
      options.endpoint = endpointWithPrefix
      // AWS SDK v3 requires `region` to be set, even if it's not used.
      options.region = 'us-east-1'

      const hostname = new URL(endpointWithPrefix).hostname
      this.baseUrl = `https://${bucket}.${hostname}`
    }
    // Amazon S3 uses regions
    if (region) {
      options.region = region

      // TODO(2Pac): Calculate `baseUrl` for Amazon S3 if we ever use that.
    }

    this.bucket = bucket
    this.client = new S3(options)
    this.cdnHost = cdnHost
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
    return new Upload({
      client: this.client,
      params,
    }).done()
  }

  async read(filename: string, options: any = {}): Promise<Buffer> {
    const normalized = this.getNormalizedPath(filename)
    const params = {
      Key: normalized,
      Bucket: this.bucket,
    }

    const result = await this.client.getObject(params)
    if (!result.Body) {
      return Buffer.alloc(0)
    }
    return Buffer.from(await result.Body.transformToByteArray())
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `deleteObject` function.
  async delete(filename: string, options: any = {}) {
    const normalized = this.getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.deleteObject(params)
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `deleteObjects` function.
  async deleteFiles(prefix: string, options: any = {}) {
    const normalized = this.getNormalizedPath(prefix)
    const files = await this.client.listObjectsV2({ Prefix: normalized, Bucket: this.bucket })
    const keys = (files.Contents ?? []).map(file => ({ Key: file.Key }))
    const params = { Delete: { Objects: keys }, Bucket: this.bucket, ...formatOptions(options) }
    return this.client.deleteObjects(params)
  }

  url(filename: string, options: any = {}): string {
    if (!this.baseUrl) {
      throw new Error('`baseUrl` needs to be set to get the URL')
    }
    const url = `${this.baseUrl}/${filename}`
    if (this.cdnHost) {
      const cdnUrl = new URL(url)
      cdnUrl.host = this.cdnHost
      return cdnUrl.toString()
    } else {
      return url
    }
  }

  // Options object can contain any of the valid keys specified in the AWS SDK for the
  // `getSignedUrlPromise` function. Besides those, we allow sending some of the more frequently
  // used options in a more friendlier format, e.g. `expires` can be sent instead of `Expires`
  // which defines how long the fetched URL will be accessible for (default is 15mins).
  async signedUrl(filename: string, options: any = {}): Promise<string> {
    const normalized = this.getNormalizedPath(filename)
    const params = { Key: normalized, Bucket: this.bucket, ...formatOptions(options) }
    const url = await getSignedUrl(this.client, new GetObjectCommand(params), {
      expiresIn: options.expires,
    })
    if (this.cdnHost) {
      const cdnUrl = new URL(url)
      cdnUrl.host = this.cdnHost
      return cdnUrl.toString()
    } else {
      return url
    }
  }

  addMiddleware() {}
}
