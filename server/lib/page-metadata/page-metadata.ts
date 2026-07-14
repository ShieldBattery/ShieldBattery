import { parse } from 'regexparam'
import { gamePageMetadata } from '../games/game-page-meta'
import { leaguePageMetadata } from '../leagues/league-page-meta'
import logger from '../logging/logger'
import { newsPostPageMetadata } from '../news/news-page-meta'
import { userPageMetadata } from '../users/user-page-meta'
import { defaultPageImage, PageMetadata, PageMetadataContext, PageMetadataResolver } from './types'

export * from './types'

interface RouteDefinition {
  pattern: string
  resolver: PageMetadataResolver
}

/** Builds a {@link RouteDefinition} for a page whose metadata never depends on the route match. */
function staticRoute(pattern: string, title: string, description: string): RouteDefinition {
  const canonicalPath = pattern.replace(/\/\*\?$/, '')

  return {
    pattern,
    resolver: async (_params, context) => ({
      url: context.canonicalHost + canonicalPath,
      type: 'website',
      title,
      description,
      image: defaultPageImage(context),
    }),
  }
}

// Route patterns use the same syntax as the client's wouter routes (`client/app-routes.tsx`) —
// `regexparam` is wouter's own route parser under the hood. When a client route should get its
// own server-rendered preview metadata, register its matching pattern here.
const ROUTES: ReadonlyArray<RouteDefinition> = [
  { pattern: '/news/:id/*?', resolver: newsPostPageMetadata },
  { pattern: '/leagues/:id/*?', resolver: leaguePageMetadata },
  { pattern: '/users/:id/*?', resolver: userPageMetadata },
  { pattern: '/games/:id/*?', resolver: gamePageMetadata },

  staticRoute(
    '/download',
    'Download ShieldBattery',
    'Download ShieldBattery to play StarCraft: Brood War online with modern matchmaking, ladder ' +
      'rankings, leagues, and more.',
  ),
  staticRoute(
    '/faq',
    'ShieldBattery FAQ',
    'Answers to frequently asked questions about ShieldBattery.',
  ),
  staticRoute(
    '/ladder/*?',
    'ShieldBattery Ladder',
    'See the best StarCraft: Brood War players on the ShieldBattery ladder rankings.',
  ),
  staticRoute(
    '/leagues',
    'ShieldBattery Leagues',
    'Compete against other StarCraft: Brood War players in leagues on ShieldBattery.',
  ),
  staticRoute('/news', 'ShieldBattery News', 'The latest news and updates from ShieldBattery.'),
  staticRoute(
    '/live',
    'ShieldBattery Live Streams',
    'Watch ShieldBattery players streaming StarCraft: Brood War live right now.',
  ),
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
    image: defaultPageImage(context),
  }
}
