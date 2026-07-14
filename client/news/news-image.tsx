import { AutoSizeImage } from '../dom/auto-size-image'
import { makePublicAssetUrl } from '../network/server-url'

const LARGE_IMAGE_WIDTH = 1600
const SMALL_IMAGE_WIDTH = 800

const NEWS_IMAGE_PATH = '/images/static-news/'
const NEWS_IMAGES: ReadonlyArray<string> = [
  'ashworld0',
  'badlands0',
  'space0',
  'ice0',
  'jungle0',
  'space1',
]

export const newsDateFormatter = new Intl.DateTimeFormat(navigator.language, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/**
 * Deterministically maps a post's UUID to one of the stock fallback images. Hashing the id (rather
 * than using a list position) keeps a post's fallback image stable as new posts are added or pages
 * are loaded.
 */
function stockImageIndex(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return ((hash % NEWS_IMAGES.length) + NEWS_IMAGES.length) % NEWS_IMAGES.length
}

/**
 * Renders a news post's cover image, preferring its uploaded cover (falling back to a deterministic
 * stock image when the post has none).
 */
export function NewsImage({
  id,
  coverImageUrl,
  coverImageSmallUrl,
  className,
}: {
  id: string
  coverImageUrl?: string | null
  coverImageSmallUrl?: string | null
  className?: string
}) {
  let smallSrc: string
  let largeSrc: string
  if (coverImageUrl) {
    largeSrc = coverImageUrl
    smallSrc = coverImageSmallUrl ?? coverImageUrl
  } else {
    const name = NEWS_IMAGES[stockImageIndex(id)]
    largeSrc = makePublicAssetUrl(`${NEWS_IMAGE_PATH}${name}.jpg`)
    smallSrc = makePublicAssetUrl(`${NEWS_IMAGE_PATH}${name}_0.5x.jpg`)
  }

  return (
    <AutoSizeImage
      className={className}
      alt=''
      aria-hidden={true}
      draggable={false}
      srcSet={`${smallSrc} ${SMALL_IMAGE_WIDTH}w, ${largeSrc} ${LARGE_IMAGE_WIDTH}w`}
      loading='lazy'
    />
  )
}
