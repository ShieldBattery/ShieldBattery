import { RouterContext } from '@koa/router'

export interface AttachmentHeaders {
  contentType: string
  /** The filename a downloader should save the response as. */
  filename: string
  /** The body's size in bytes, if known up front (for a stream body, which Koa can't measure). */
  length?: number
}

/**
 * Marks the response as a file download with the given type and filename. Only headers are set:
 * the handler still supplies the body (a `Buffer`, string, or `Readable`) as usual.
 */
export function setAttachmentHeaders(
  ctx: RouterContext,
  { contentType, filename, length }: AttachmentHeaders,
) {
  ctx.set('Content-Type', contentType)
  ctx.set('Content-Disposition', `attachment; filename="${filename}"`)
  if (length !== undefined) {
    ctx.length = length
  }
}
