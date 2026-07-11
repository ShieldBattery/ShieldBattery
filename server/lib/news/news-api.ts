import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import mime from 'mime'
import sharp, { FormatEnum } from 'sharp'
import { MAX_IMAGE_SIZE_BYTES } from '../../../common/images'
import { NewsCoverImageUploadResponse } from '../../../common/news'
import { getUrl, writeFile } from '../files'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { createImagePath } from '../files/images'
import { httpApi } from '../http/http-api'
import { httpBefore, httpPost } from '../http/route-decorators'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'

const coverImageUploadThrottle = createThrottle('newscoverimage', {
  rate: 5,
  burst: 10,
  window: 60000,
})

// The widths that cover images are resized down to, matching the `srcSet` the feed/detail pages
// serve (large + a half-resolution `_0.5x` sibling).
const LARGE_IMAGE_WIDTH = 1600
const SMALL_IMAGE_WIDTH = 800

// Formats we keep as-is; anything else is re-encoded to the fallback.
const ALLOWED_FORMATS: ReadonlyArray<keyof FormatEnum> = ['jpeg', 'png']
const FALLBACK_FORMAT: keyof FormatEnum = 'png'

/**
 * Inserts the `_0.5x` size suffix before the file extension of a cover image path
 * (e.g. `news-images/ab/cd/xyz.jpg` -> `news-images/ab/cd/xyz_0.5x.jpg`). This must match the
 * server-rs `small_variant_path` used to derive `coverImageSmallUrl` from the stored path.
 */
function smallVariantPath(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot > slash) {
    return `${path.slice(0, dot)}_0.5x${path.slice(dot)}`
  }
  return `${path}_0.5x`
}

@httpApi('/news')
export class NewsApi {
  @httpPost('/cover-images')
  @httpBefore(
    ensureLoggedIn,
    checkAllPermissions('manageNews'),
    throttleMiddleware(coverImageUploadThrottle, ctx => String(ctx.session!.user.id)),
    handleMultipartFiles(MAX_IMAGE_SIZE_BYTES),
  )
  async uploadCoverImage(ctx: RouterContext): Promise<NewsCoverImageUploadResponse> {
    const imageFile = ctx.request.files?.image
    if (!imageFile) {
      throw new httpErrors.BadRequest('an image file must be provided')
    }
    if (Array.isArray(imageFile)) {
      throw new httpErrors.BadRequest('only one image file can be uploaded')
    }

    const image = sharp(imageFile.filepath)
    const metadata = await image.metadata()
    const useFallback = !metadata.format || !ALLOWED_FORMATS.includes(metadata.format)
    const imageExtension = useFallback ? FALLBACK_FORMAT : metadata.format

    const renderVariant = (width: number): Promise<Buffer> => {
      // Cap the width, preserving aspect ratio and never upscaling smaller images.
      let pipeline = image.clone().resize({ width, withoutEnlargement: true })
      if (useFallback) {
        pipeline = pipeline.toFormat(FALLBACK_FORMAT)
      }
      return pipeline.toBuffer()
    }

    const [largeBuffer, smallBuffer] = await Promise.all([
      renderVariant(LARGE_IMAGE_WIDTH),
      renderVariant(SMALL_IMAGE_WIDTH),
    ])

    const path = createImagePath('news-images', imageExtension)
    const smallPath = smallVariantPath(path)
    const contentType = mime.getType(imageExtension) ?? undefined

    await Promise.all([
      writeFile(path, largeBuffer, { acl: 'public-read', type: contentType }),
      writeFile(smallPath, smallBuffer, { acl: 'public-read', type: contentType }),
    ])

    return { path, url: getUrl(path), smallUrl: getUrl(smallPath) }
  }
}
