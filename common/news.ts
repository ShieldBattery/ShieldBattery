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
