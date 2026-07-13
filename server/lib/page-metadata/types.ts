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
}

/** Values available to every {@link PageMetadataResolver}, regardless of the matched route. */
export interface PageMetadataContext {
  /** The canonical origin for the site, e.g. `https://shieldbattery.net` (no trailing slash). */
  canonicalHost: string
  /** The base URL that public assets (images, fonts, etc.) are served from. */
  publicAssetsUrl: string
}

/**
 * Resolves the {@link PageMetadata} for a route match. `params` holds the route's named/wildcard
 * segments (see {@link ROUTES}).
 *
 * Returning `undefined` means the route matched but there's nothing to render metadata for (e.g.
 * an unpublished or missing post) — the router falls back to the default site-wide metadata.
 * Throwing is treated the same way; a metadata resolver must never be the reason a page fails to
 * render.
 */
export type PageMetadataResolver = (
  params: Record<string, string | undefined>,
  context: PageMetadataContext,
) => Promise<PageMetadata | undefined>
