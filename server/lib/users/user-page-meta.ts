import { defaultPageImage, PageMetadataResolver } from '../page-metadata/types'
import { findUserById } from './user-model'

/** The largest value that fits in a Postgres `int4` column, which `users.id` is stored as. */
const MAX_INT4 = 0x7fffffff

// Pinned to UTC so the rendered date doesn't depend on the server host's timezone.
const SINCE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * Resolves the Open Graph/Twitter Card metadata for a user profile page (registered for the
 * `/users/:id/*?` route in `page-metadata.ts`).
 *
 * `params.id` is expected to be the user's numeric id; anything non-numeric, or a value that
 * overflows Postgres' `int4` range, returns `undefined` without querying the database (so garbage
 * can never reach — and error out on — a `WHERE id = ...` query). A missing user does the same.
 * Either case falls back to the default site-wide metadata.
 *
 * Crawler-facing metadata is intentionally English-only, same as the rest of this system.
 */
export const userPageMetadata: PageMetadataResolver = async (params, context) => {
  const routeId = params.id
  if (!routeId || !/^\d+$/.test(routeId)) {
    return undefined
  }

  const id = Number(routeId)
  if (id > MAX_INT4) {
    return undefined
  }

  const user = await findUserById(id)
  if (!user) {
    return undefined
  }

  const since = SINCE_FORMAT.format(new Date(user.created))

  return {
    url: `${context.canonicalHost}/users/${user.id}/${encodeURIComponent(user.name)}`,
    type: 'website',
    title: user.name,
    description: `View ${user.name}'s match history, rankings, and stats on ShieldBattery. Playing since ${since}.`,
    image: user.avatarUrl ?? defaultPageImage(context),
    // The default logo is a 1200x630 landscape image, better suited to a large card; an avatar is
    // square, so use the small thumbnail layout instead.
    cardType: user.avatarUrl ? 'summary' : undefined,
  }
}
