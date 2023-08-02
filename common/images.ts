import cuid from 'cuid'
import sharp from 'sharp'

/** Maximum image size that we allow to be uploaded. */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024

/**
 * Creates an image path that is used to save this image to our server/CDN given the root folder and
 * the image extension.
 */
export function createImagePath(rootFolder: string, imageExtension: string) {
  const imageId = cuid()
  // Note that cuid ID's are less random at the start so we use the end instead
  const firstChars = imageId.slice(-4, -2)
  const secondChars = imageId.slice(-2)
  return `${rootFolder}/${firstChars}/${secondChars}/${imageId}.${imageExtension}`
}

/**
 * Takes an image at a specific path and resizes it to the given dimensions. Also forces
 * non-standard image formats to .png.
 *
 * Returns a tuple of the resized image object and its assigned extension.
 */
export async function resizeImage(
  filePath: string,
  width: number,
  height: number,
): Promise<[image: sharp.Sharp, imageExtension: string]> {
  const image = sharp(filePath)
  const metadata = await image.metadata()

  let imageExtension: string
  if (metadata.format !== 'jpg' && metadata.format !== 'jpeg' && metadata.format !== 'png') {
    image.toFormat('png')
    imageExtension = 'png'
  } else {
    imageExtension = metadata.format
  }

  image.resize(width, height, {
    fit: sharp.fit.cover,
    withoutEnlargement: true,
  })

  return [image, imageExtension]
}
