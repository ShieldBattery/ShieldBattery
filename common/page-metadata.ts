/**
 * Server-rendered Open Graph/Twitter Card metadata for a page, rendered into the page's
 * `<head>` by `server/views/index.pug`.
 */
export interface PageMetadata {
  url: string
  type: 'website' | 'article'
  title: string
  description: string
  image: string
  /** ISO 8601 timestamp of when the page's content was published. Article pages only. */
  publishedTime?: string
  /**
   * The Twitter card layout to use. `summary` renders a small square thumbnail (right for
   * avatars); `summary_large_image` renders a full-width image. Defaults to
   * `summary_large_image` when unset.
   */
  cardType?: 'summary' | 'summary_large_image'
}
