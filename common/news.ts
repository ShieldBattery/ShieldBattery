export type NewsEvent = UrgentMessageChangeEvent | NewsPostChangeEvent

export type UrgentMessageChangeEvent =
  | {
      type: 'urgentMessageChange'
      publishedAt?: undefined
      id?: undefined
    }
  | {
      type: 'urgentMessageChange'
      publishedAt: number
      id: string
    }

export type NewsPostChangeEvent =
  | {
      type: 'newsPostChange'
      publishedAt?: undefined
      id?: undefined
    }
  | {
      type: 'newsPostChange'
      publishedAt: number
      id: string
    }

/**
 * Response returned after uploading a news image, used for both post cover images and inline
 * images embedded in post markdown.
 */
export interface NewsImageUploadResponse {
  /**
   * The file-store path of the uploaded image. For cover images, this is what gets stored on the
   * post (as `coverImagePath`) to associate the image with it.
   */
  path: string
  /** A fully-qualified URL to the full-resolution image. */
  url: string
  /** A fully-qualified URL to the half-resolution (`_0.5x`) image. */
  smallUrl: string
}

/** Maximum size that we allow a news post video upload to be. */
export const MAX_VIDEO_SIZE_BYTES = 100 * 1000 * 1000 // 100MB

/**
 * Response returned after uploading a news video, used for inline videos embedded in post
 * markdown. Unlike images, videos get no resizing, so there is no small variant.
 */
export interface NewsVideoUploadResponse {
  /** The file-store path of the uploaded video. */
  path: string
  /** A fully-qualified URL to the video. */
  url: string
}

/** The public-assets path prefix under which the stock news fallback images live. */
export const NEWS_STOCK_IMAGES_PATH_PREFIX = 'images/static-news/'

/** The set of stock images used as a cover fallback for posts that don't have one uploaded. */
export const NEWS_STOCK_IMAGES: ReadonlyArray<string> = [
  'ashworld0',
  'badlands0',
  'space0',
  'ice0',
  'jungle0',
  'space1',
]

/**
 * Deterministically maps a post's UUID to one of the stock fallback images. Hashing the id (rather
 * than using a list position) keeps a post's fallback image stable as new posts are added or pages
 * are loaded.
 */
export function newsStockImageIndex(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return ((hash % NEWS_STOCK_IMAGES.length) + NEWS_STOCK_IMAGES.length) % NEWS_STOCK_IMAGES.length
}
