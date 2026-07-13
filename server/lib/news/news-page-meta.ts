import {
  NEWS_STOCK_IMAGES,
  NEWS_STOCK_IMAGES_PATH_PREFIX,
  newsStockImageIndex,
} from '../../../common/news'
import { getUrl } from '../files'
import logger from '../logging/logger'
import { getPublishedNewsPostMeta } from './news-post-models'

const NEWS_POST_ROUTE_PATTERN =
  /^\/news\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i

/**
 * Returns the post id for a pathname of the form `/news/<uuid>` (with an optional single trailing
 * slash), or `undefined` if the pathname isn't a news post permalink.
 */
export function matchNewsPostRoute(pathname: string): string | undefined {
  const match = NEWS_POST_ROUTE_PATTERN.exec(pathname)
  return match ? match[1] : undefined
}

/** Server-rendered Open Graph/Twitter meta tag values for a news post permalink. */
export interface NewsPageMeta {
  url: string
  title: string
  description: string
  image: string
  /** ISO 8601 timestamp of when the post was published. */
  publishedTime: string
}

function canonicalHost(): string {
  const host = process.env.SB_CANONICAL_HOST!
  return host.endsWith('/') ? host.slice(0, -1) : host
}

function stockImageUrl(id: string, publicAssetsUrl: string): string {
  const name = NEWS_STOCK_IMAGES[newsStockImageIndex(id)]
  return `${publicAssetsUrl}${NEWS_STOCK_IMAGES_PATH_PREFIX}${name}.jpg`
}

/**
 * Returns the Open Graph/Twitter meta tag values for a news post permalink, or `undefined` if the
 * pathname isn't a news post permalink, the post doesn't exist, or the post isn't currently
 * published (in which case the default site-wide tags should be used instead).
 *
 * This never throws: any error looking up the post is logged and treated the same as "not found".
 */
export async function getNewsPageMeta(
  pathname: string,
  publicAssetsUrl: string,
): Promise<NewsPageMeta | undefined> {
  const id = matchNewsPostRoute(pathname)
  if (!id) {
    return undefined
  }

  try {
    const post = await getPublishedNewsPostMeta(id)
    if (!post) {
      return undefined
    }

    return {
      url: `${canonicalHost()}/news/${id}`,
      title: post.title,
      // Meta descriptions are single-line, so collapse any newlines/whitespace runs in the summary
      description: post.summary.replace(/\s+/g, ' ').trim(),
      image: post.coverImagePath ? getUrl(post.coverImagePath) : stockImageUrl(id, publicAssetsUrl),
      publishedTime: post.publishedAt.toISOString(),
    }
  } catch (err) {
    logger.warn({ err }, 'failed to retrieve news post meta for page tags')
    return undefined
  }
}
