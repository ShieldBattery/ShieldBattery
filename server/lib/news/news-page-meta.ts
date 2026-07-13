import {
  NEWS_STOCK_IMAGES,
  NEWS_STOCK_IMAGES_PATH_PREFIX,
  newsStockImageIndex,
} from '../../../common/news'
import { getUrl } from '../files'
import type { PageMetadataResolver } from '../page-metadata/page-metadata'
import { getPublishedNewsPostMeta } from './news-post-models'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function stockImageUrl(id: string, publicAssetsUrl: string): string {
  const name = NEWS_STOCK_IMAGES[newsStockImageIndex(id)]
  return `${publicAssetsUrl}${NEWS_STOCK_IMAGES_PATH_PREFIX}${name}.jpg`
}

/**
 * Resolves the Open Graph/Twitter Card metadata for a news post permalink (registered for the
 * `/news/:id/*?` route in `page-metadata.ts`).
 *
 * `params.id` is expected to be the post's raw UUID; anything else returns `undefined` (so we
 * never hit the database with garbage), as does a post that doesn't exist or isn't currently
 * published. Either case falls back to the default site-wide metadata.
 */
export const newsPostPageMetadata: PageMetadataResolver = async (params, context) => {
  const id = params.id
  if (!id || !UUID_PATTERN.test(id)) {
    return undefined
  }

  const post = await getPublishedNewsPostMeta(id)
  if (!post) {
    return undefined
  }

  return {
    url: `${context.canonicalHost}/news/${id}`,
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
