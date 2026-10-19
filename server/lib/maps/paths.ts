import { MapExtension } from '../../../common/maps'

export function mapPath(hash: string, extension: MapExtension) {
  const firstByte = hash.slice(0, 2)
  const secondByte = hash.slice(2, 4)
  return `maps/${firstByte}/${secondByte}/${hash}.${extension}`
}

/**
 * Returns the file store path of one of a map's images, for the generation `imageVersion` rendered
 * by `renderVersion`. Render version 0 images are all JPEGs, at legacy paths that every generation
 * shares. Must match `map_image_path` in server-rs, which writes the images.
 */
export function imagePath({
  hash,
  imageVersion,
  renderVersion,
  size,
  format,
}: {
  hash: string
  imageVersion: number
  renderVersion: number
  size: 256 | 512 | 1024 | 2048
  format: 'avif' | 'jpg'
}) {
  const dir = `map_images/${hash.slice(0, 2)}/${hash.slice(2, 4)}`
  return renderVersion === 0
    ? `${dir}/${hash}-${size}.jpg`
    : `${dir}/${hash}/${imageVersion}-${size}.${format}`
}
