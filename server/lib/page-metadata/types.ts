import type { PageMetadata } from '../../../common/page-metadata'

export type { PageMetadata }

/** Values available to every {@link PageMetadataResolver}, regardless of the matched route. */
export interface PageMetadataContext {
  /** The canonical origin for the site, e.g. `https://shieldbattery.net` (no trailing slash). */
  canonicalHost: string
  /** The base URL that public assets (images, fonts, etc.) are served from. */
  publicAssetsUrl: string
}

/** The site-wide default preview image, used when a page has no more specific image. */
export function defaultPageImage(context: PageMetadataContext): string {
  return `${context.canonicalHost}/images/logo-and-text-1200x630.png`
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
