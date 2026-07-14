import slug from 'slug'
import { Tagged } from 'type-fest'
import { decodePrettyId, encodePrettyId } from '../../common/pretty-id'
import { urlPath } from '../../common/urls'

/**
 * The ID of a news post as used in routes (equivalent to the DB one, just encoded in a way that
 * looks more friendly in URLs).
 */
export type RouteNewsPostId = Tagged<string, 'RouteNewsPostId'>

export function toRouteNewsPostId(id: string): RouteNewsPostId {
  return encodePrettyId(id) as RouteNewsPostId
}

export function fromRouteNewsPostId(routeId: RouteNewsPostId): string {
  return decodePrettyId(routeId)
}

/**
 * Returns the URL for a particular news post. If the post's title is available, the URL will
 * include a slug (otherwise there will be a redirect once the data has loaded).
 */
export function urlForNewsPost(id: string, title?: string) {
  return urlPath`/news/${toRouteNewsPostId(id)}/${title ? slug(title) : '_'}`
}
