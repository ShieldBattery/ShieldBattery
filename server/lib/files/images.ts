import { nanoid } from 'nanoid'
import sharp, { FitEnum, FormatEnum } from 'sharp'

/** Maximum image size that we allow to be uploaded. */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024

/**
 * Creates an image path that is used to save this image to our server/CDN given the root folder and
 * the image extension.
 */
export function createImagePath(rootFolder: string, imageExtension: string) {
  const imageId = nanoid()
  const firstChars = imageId.slice(0, 2)
  const secondChars = imageId.slice(2, 4)
  return `${rootFolder}/${firstChars}/${secondChars}/${imageId}.${imageExtension}`
}

interface ResizeImageConfigType {
  allowedTypes: Array<keyof FormatEnum>
  fallbackType: keyof FormatEnum
  objectFit: keyof FitEnum
}

const RESIZE_IMAGE_DEFAULT_CONFIG: ResizeImageConfigType = {
  allowedTypes: ['jpg', 'jpeg', 'png'],
  fallbackType: 'png',
  objectFit: sharp.fit.cover,
}

/**
 * Takes an image at a specific path and resizes it to the given dimensions. Also accepts an
 * optional object for further configuration.
 *
 * Returns a tuple of the resized image object and its assigned extension.
 */
export async function resizeImage(
  filePath: string,
  width: number,
  height: number,
  config?: Partial<ResizeImageConfigType>,
): Promise<[image: sharp.Sharp, imageExtension: string]> {
  const mergedConfig = { ...RESIZE_IMAGE_DEFAULT_CONFIG, ...config }

  const image = sharp(filePath)
  const metadata = await image.metadata()

  let imageExtension: string
  if (metadata.format && mergedConfig.allowedTypes.includes(metadata.format)) {
    imageExtension = metadata.format
  } else {
    image.toFormat(mergedConfig.fallbackType)
    imageExtension = mergedConfig.fallbackType
  }

  image.resize(width, height, {
    fit: mergedConfig.objectFit,
    withoutEnlargement: true,
  })

  return [image, imageExtension]
}
