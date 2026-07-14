import slug from 'slug'
import { LeagueId } from '../../../common/leagues/leagues'
import { decodePrettyId, encodePrettyId, isPrettyId } from '../../../common/pretty-id'
import { defaultPageImage, PageMetadataResolver } from '../page-metadata/types'
import { getLeague } from './league-models'

/**
 * Resolves the Open Graph/Twitter Card metadata for a league page (registered for the
 * `/leagues/:id/*?` route in `page-metadata.ts`).
 *
 * `params.id` is expected to be the league's pretty (base64url-encoded) id; anything else —
 * `/leagues/admin/...` also matches this route pattern and lands here, a raw UUID, etc. — returns
 * `undefined` so we never hit the database with garbage. `getLeague` already returns `undefined`
 * for leagues that shouldn't be visible yet (`signups_after` in the future), which is exactly the
 * visibility we want here too. Either case falls back to the default site-wide metadata.
 */
export const leaguePageMetadata: PageMetadataResolver = async (params, context) => {
  const routeId = params.id
  if (!routeId || !isPrettyId(routeId)) {
    return undefined
  }

  const id = decodePrettyId(routeId) as LeagueId
  const league = await getLeague(id, new Date())
  if (!league) {
    return undefined
  }

  return {
    url: `${context.canonicalHost}/leagues/${encodePrettyId(id)}/${slug(league.name)}`,
    type: 'website',
    title: league.name,
    // Meta descriptions are single-line, so collapse any newlines/whitespace runs.
    description: league.description.replace(/\s+/g, ' ').trim(),
    // `league.imagePath` is already a resolved URL (`convertLeagueFromDb` applies `getUrl`).
    image: league.imagePath ?? defaultPageImage(context),
  }
}
