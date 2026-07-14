/**
 * Inserts the `_0.5x` size suffix before the file extension of a news image path
 * (e.g. `news-images/ab/cd/xyz.jpg` -> `news-images/ab/cd/xyz_0.5x.jpg`). This must match the
 * server-rs `small_variant_path` used to derive `coverImageSmallUrl` from the stored path.
 */
export function smallVariantPath(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot > slash) {
    return `${path.slice(0, dot)}_0.5x${path.slice(dot)}`
  }
  return `${path}_0.5x`
}
