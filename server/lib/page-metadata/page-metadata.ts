import { parse } from 'regexparam'
import logger from '../logging/logger'
import { newsPostPageMetadata } from '../news/news-page-meta'

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

interface RouteDefinition {
  pattern: string
  resolver: PageMetadataResolver
}

// Route patterns use the same syntax as the client's wouter routes (`client/app-routes.tsx`) —
// `regexparam` is wouter's own route parser under the hood. When a client route should get its
// own server-rendered preview metadata, register its matching pattern here.
const ROUTES: ReadonlyArray<RouteDefinition> = [
  { pattern: '/news/:id/*?', resolver: newsPostPageMetadata },
]

// Patterns are fixed at startup, so parse them once rather than on every request.
const PARSED_ROUTES = ROUTES.map(({ pattern, resolver }) => ({
  parsed: parse(pattern),
  resolver,
}))

/**
 * Resolves the Open Graph/Twitter Card metadata to render for `pathname`.
 *
 * Routes are tried in registration order. The first resolver to return metadata wins; a resolver
 * that returns `undefined` (or throws) falls through to the next route. If no route produces
 * metadata, the default site-wide metadata is returned.
 */
export async function resolvePageMetadata(
  pathname: string,
  context: PageMetadataContext,
): Promise<PageMetadata> {
  for (const { parsed, resolver } of PARSED_ROUTES) {
    const match = parsed.pattern.exec(pathname)
    if (!match) {
      continue
    }

    const params: Record<string, string | undefined> = {}
    for (const [i, key] of parsed.keys.entries()) {
      params[key] = match[i + 1]
    }

    try {
      const metadata = await resolver(params, context)
      if (metadata) {
        return metadata
      }
    } catch (err) {
      logger.warn({ err }, 'page metadata resolver threw, falling back to default page metadata')
    }
  }

  return defaultPageMetadata(context)
}

/** The metadata used for any page that doesn't have a more specific resolver match. */
function defaultPageMetadata(context: PageMetadataContext): PageMetadata {
  return {
    url: context.canonicalHost,
    type: 'website',
    title: 'ShieldBattery',
    description: 'Play StarCraft 1 on the premier community-run platform.',
    image: `${context.canonicalHost}/images/logo-and-text-1200x630.png`,
  }
}
