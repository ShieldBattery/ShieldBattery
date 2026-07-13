import {
  NEWS_STOCK_IMAGES,
  NEWS_STOCK_IMAGES_PATH_PREFIX,
  newsStockImageIndex,
} from '../../common/news'
import { AutoSizeImage } from '../dom/auto-size-image'
import { makePublicAssetUrl } from '../network/server-url'

const LARGE_IMAGE_WIDTH = 1600
const SMALL_IMAGE_WIDTH = 800

export const newsDateFormatter = new Intl.DateTimeFormat(navigator.language, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

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
    const name = NEWS_STOCK_IMAGES[newsStockImageIndex(id)]
    largeSrc = makePublicAssetUrl(`${NEWS_STOCK_IMAGES_PATH_PREFIX}${name}.jpg`)
    smallSrc = makePublicAssetUrl(`${NEWS_STOCK_IMAGES_PATH_PREFIX}${name}_0.5x.jpg`)
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
