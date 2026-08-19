import { RouterContext } from '@koa/router'
import { createReadStream } from 'fs'
import httpErrors from 'http-errors'
import mime from 'mime'
import sharp, { FormatEnum } from 'sharp'
import { MAX_IMAGE_SIZE_BYTES } from '../../../common/images'
import {
  MAX_VIDEO_SIZE_BYTES,
  NewsImageUploadResponse,
  NewsVideoUploadResponse,
} from '../../../common/news'
import { getUrl, writeFile } from '../files'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { createImagePath } from '../files/images'
import { sniffVideoType } from '../files/videos'
import { httpApi } from '../http/http-api'
import { httpBefore, httpPost } from '../http/route-decorators'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { smallVariantPath } from './news-image-paths'

const imageUploadThrottle = createThrottle('newsimages', {
  rate: 5,
  burst: 10,
  window: 60000,
})

const videoUploadThrottle = createThrottle('newsvideos', {
  rate: 2,
  burst: 4,
  window: 60000,
})

// The widths that news images are resized down to, matching the `srcSet` the feed/detail pages
// serve (large + a half-resolution `_0.5x` sibling).
const LARGE_IMAGE_WIDTH = 1600
const SMALL_IMAGE_WIDTH = 800

// Formats we keep as-is; anything else is re-encoded to the fallback.
const ALLOWED_FORMATS: ReadonlyArray<keyof FormatEnum> = ['jpeg', 'png']
const FALLBACK_FORMAT: keyof FormatEnum = 'png'

@httpApi('/news')
export class NewsApi {
  @httpPost('/images')
  @httpBefore(
    ensureLoggedIn,
    checkAllPermissions('manageNews'),
    throttleMiddleware(imageUploadThrottle, throttleByUser),
    handleMultipartFiles(MAX_IMAGE_SIZE_BYTES),
  )
  async uploadImage(ctx: RouterContext): Promise<NewsImageUploadResponse> {
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

  @httpPost('/videos')
  @httpBefore(
    ensureLoggedIn,
    checkAllPermissions('manageNews'),
    throttleMiddleware(videoUploadThrottle, throttleByUser),
    handleMultipartFiles(MAX_VIDEO_SIZE_BYTES),
  )
  async uploadVideo(ctx: RouterContext): Promise<NewsVideoUploadResponse> {
    const videoFile = ctx.request.files?.video
    if (!videoFile) {
      throw new httpErrors.BadRequest('a video file must be provided')
    }
    if (Array.isArray(videoFile)) {
      throw new httpErrors.BadRequest('only one video file can be uploaded')
    }

    const type = await sniffVideoType(videoFile.filepath)
    if (!type) {
      throw new httpErrors.UnsupportedMediaType('only mp4 and webm videos are supported')
    }

    const path = createImagePath('news-videos', type)
    const stream = createReadStream(videoFile.filepath)

    // TODO: Uploaded videos that never end up referenced by a saved post are never cleaned up
    // and sit in the file store forever. If orphaned uploads become a storage problem, track
    // upload references and garbage-collect unreferenced files.
    await writeFile(path, stream, { acl: 'public-read', type: mime.getType(type) ?? undefined })

    return { path, url: getUrl(path) }
  }
}
