/**
 * Self-hosted Google-style emoji images, bundled from the `emoji-datasource-google` package so
 * clients never load emoji artwork from a third-party CDN. The images go through the normal asset
 * pipeline (hashed files served with the rest of the client's assets, in both the web and Electron
 * builds).
 *
 * This module maps ~3800 image files, so it should only ever be imported dynamically (it's pulled
 * in alongside the emoji picker / emoji data chunks, not the main bundle).
 */

const IMAGE_URLS: Record<string, string> = import.meta.glob(
  '/node_modules/emoji-datasource-google/img/google/64/*.png',
  // no-inline keeps the small PNGs as real files — inlined, they'd all land base64-encoded in
  // this module's chunk, making it several megabytes of JS
  { eager: true, query: '?url&no-inline', import: 'default' },
)

const PATH_PREFIX = '/node_modules/emoji-datasource-google/img/google/64/'

/**
 * Returns the self-hosted image URL for an emoji's unified codepoint string (e.g. "1f525"), or
 * `undefined` if the set has no image for it.
 */
export function googleEmojiImageUrl(unified: string): string | undefined {
  return IMAGE_URLS[`${PATH_PREFIX}${unified.toLowerCase()}.png`]
}
