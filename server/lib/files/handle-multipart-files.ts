import { unlink } from 'fs/promises'
import Koa from 'koa'
import koaBody from 'koa-body'
import { FilesErrorCode, MAX_FILE_SIZE } from '../../../common/files'
import { asHttpError } from '../errors/error-with-payload'
import logger from '../logging/logger'
import { FilesError } from './files-error'

function convertFormidableError(err: Error) {
  // TODO(2Pac): Can't do a much better check here since koa-body uses an old version of formidable.
  // Looks like it might get updated soon tho: https://github.com/koajs/koa-body/issues/241
  if (!('code' in err)) {
    throw err
  }

  switch ((err as any).code) {
    // TODO(2Pac): koa-body seems to be using an ancient version of formidable internally so we
    // can't use the actual error types here. In the newer version, these error codes correspond to
    // `biggerThanTotalMaxFileSize` and `biggerThanMaxFileSize` respectively. In the version that
    // koa-body currently uses, only the 1009 error code is used, so we should be fine when
    // updating. We only need to update the types here so the code is more readable and type-safe.
    case 1009:
    case 1016:
      throw asHttpError(
        413,
        new FilesError(FilesErrorCode.MaxFileSizeExceeded, 'Max file size exceeded'),
      )
    default:
      throw err
  }
}

/**
 * A Koa middleware function that sets up multipart file handling and will clean up the files
 * once the request is completed.
 *
 * @param maxFileSize The maximum size a file upload can be, in bytes. Note that this is also
 * limited by nginx's client_max_body_size.
 */
export function handleMultipartFiles(maxFileSize = MAX_FILE_SIZE) {
  const bodyMiddleware = koaBody({
    multipart: true,
    formidable: {
      maxFileSize,
    },
    onError: err => {
      convertFormidableError(err)
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
