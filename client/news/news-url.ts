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

/** Search param on the news editor route naming where a successful save should navigate. */
export const EDITOR_RETURN_TO_PARAM = 'returnTo'
/** `EDITOR_RETURN_TO_PARAM` value that sends a successful save back to the post's public page. */
export const EDITOR_RETURN_TO_POST = 'post'

/**
 * Returns the URL of the admin editor for a news post. With `returnToPost`, a successful save
 * navigates back to the post's public page instead of the admin list.
 */
export function urlForNewsPostEditor(id: string, { returnToPost = false } = {}): string {
  const path = urlPath`/admin/news/${id}`
  return returnToPost ? `${path}?${EDITOR_RETURN_TO_PARAM}=${EDITOR_RETURN_TO_POST}` : path
}
