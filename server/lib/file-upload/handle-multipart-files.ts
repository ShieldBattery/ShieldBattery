import { unlink } from 'fs/promises'
import Koa from 'koa'
import koaBody from 'koa-body'
import logger from '../logging/logger'

/**
 * A Koa middleware function that sets up multipart file handling and will clean up the files
 * once the request is completed.
 *
 * @param maxFileSize The maximum size a file upload can be, in bytes. Note that this is also
 * limited by nginx's client_max_body_size.
 */
export function handleMultipartFiles(maxFileSize = 50 * 1024 * 1024) {
  const bodyMiddleware = koaBody({
    multipart: true,
    formidable: {
      maxFileSize,
    },
  })

  return async function handleMultipartFiles(ctx: Koa.Context, next: Koa.Next) {
    await bodyMiddleware(ctx, async () => {
      try {
        await next()
      } finally {
        if (ctx.request.files) {
          try {
            await Promise.all(
              Array.from(Object.values(ctx.request.files))
                .flat()
                .map(({ filepath }) => unlink(filepath)),
            )
          } catch (err) {
            logger.error({ err }, 'Failed to delete uploaded file')
          }
        }
      }
    })
  }
}
