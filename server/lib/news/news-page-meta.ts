import slug from 'slug'
import {
  NEWS_STOCK_IMAGES,
  NEWS_STOCK_IMAGES_PATH_PREFIX,
  newsStockImageIndex,
} from '../../../common/news'
import { decodePrettyId, encodePrettyId, isPrettyId } from '../../../common/pretty-id'
import { getUrl } from '../files'
import type { PageMetadataResolver } from '../page-metadata/types'
import { getPublishedNewsPostMeta } from './news-post-models'

function stockImageUrl(id: string, publicAssetsUrl: string): string {
  const name = NEWS_STOCK_IMAGES[newsStockImageIndex(id)]
  return `${publicAssetsUrl}${NEWS_STOCK_IMAGES_PATH_PREFIX}${name}.jpg`
}

/**
 * Resolves the Open Graph/Twitter Card metadata for a news post permalink (registered for the
 * `/news/:id/*?` route in `page-metadata.ts`).
 *
 * `params.id` is expected to be the post's pretty (base64url-encoded) id; anything else — a raw
 * UUID, a malformed id, etc. — returns `undefined` (so we never hit the database with garbage), as
 * does a post that doesn't exist or isn't currently published. Either case falls back to the
 * default site-wide metadata.
 */
export const newsPostPageMetadata: PageMetadataResolver = async (params, context) => {
  const routeId = params.id
  if (!routeId || !isPrettyId(routeId)) {
    return undefined
  }

  const id = decodePrettyId(routeId)
  const post = await getPublishedNewsPostMeta(id)
  if (!post) {
    return undefined
  }

  return {
    url: `${context.canonicalHost}/news/${encodePrettyId(id)}/${slug(post.title)}`,
    type: 'article',
    title: post.title,
    // Meta descriptions are single-line, so collapse any newlines/whitespace runs in the summary.
    description: post.summary.replace(/\s+/g, ' ').trim(),
    image: post.coverImagePath
      ? getUrl(post.coverImagePath)
      : stockImageUrl(id, context.publicAssetsUrl),
    publishedTime: post.publishedAt.toISOString(),
  }
}
