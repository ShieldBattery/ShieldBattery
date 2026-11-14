import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { urlForMapCollection } from '../../common/map-url'
import { filterColorCodes, makeMapCollectionId } from '../../common/maps'
import { useSelfUser } from '../auth/auth-utils'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapCollectionCard_CollectionFragmentFragment } from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { buttonReset } from '../material/button-reset'
import { EllipsizedText } from '../material/ellipsized-text'
import { LinkButton } from '../material/link-button'
import { bodySmall, titleSmall } from '../styles/typography'
import { collectionSubtitle, collectionTitle, dateNeedsYear } from './map-collection-text'
import { MapFileImage } from './map-image'
import { TileBadge } from './map-tile'

/** How many maps a collection's mosaic shows. */
const MOSAIC_SIZE = 4

export const MapCollectionMosaic_CollectionFragment = graphql(/* GraphQL */ `
  fragment MapCollectionMosaic_CollectionFragment on MapCollection {
    id
    cover {
      id
      name
      file {
        id
        ...MapFileImage_FileFragment
      }
    }
  }
`)

export const MapCollectionCard_CollectionFragment = graphql(/* GraphQL */ `
  fragment MapCollectionCard_CollectionFragment on MapCollection {
    id
    kind
    title
    public
    mapCount
    owner {
      id
      name
    }
    hidden {
      id
    }
    pool {
      id
      matchmakingType
      startDate
      endDate
    }
    ...MapCollectionMosaic_CollectionFragment
  }
`)

const MosaicRoot = styled.div`
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  overflow: hidden;

  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 2px;

  border: 1px solid rgb(from var(--color-blue80) r g b / 0.12);
  border-radius: 6px;
  background-color: var(--theme-container-low);
`

const MosaicCell = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--theme-container);
`

/**
 * The first maps of a collection in a 2x2 grid. A collection with fewer maps leaves the remaining
 * cells empty. `size` is the width the mosaic is expected to be drawn at, in CSS pixels.
 */
export function MapCollectionMosaic({
  collection: collectionRef,
  size,
  className,
}: {
  collection: FragmentType<typeof MapCollectionMosaic_CollectionFragment>
  size: number
  className?: string
}) {
  const collection = useFragment(MapCollectionMosaic_CollectionFragment, collectionRef)
  const cells = Array.from({ length: MOSAIC_SIZE }, (_, i) => collection.cover[i])
  return (
    <MosaicRoot className={className}>
      {cells.map((map, i) =>
        map ? (
          <MosaicCell key={map.id}>
            <MapFileImage
              file={map.file}
              name={filterColorCodes(map.name)}
              size={Math.ceil(size / 2)}
              forceAspectRatio={1}
            />
          </MosaicCell>
        ) : (
          // Empty cells have nothing to tell apart but their place
          <MosaicCell key={`empty-${i}`} />
        ),
      )}
    </MosaicRoot>
  )
}

/** A grid of collection cards, as wide as its container allows. */
export const MapCollectionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 18px 16px;
`

const Root = styled.div`
  position: relative;
  min-width: 0;
`

const cardContents = css`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;

  border-radius: 8px;
  outline-offset: 2px;
`

const CardLink = styled(LinkButton)`
  ${cardContents};
`

const CardButton = styled.button`
  ${buttonReset};
  ${cardContents};
  text-align: start;

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
  }
`

const ImageBox = styled.div`
  position: relative;

  ${CardLink}:hover &, ${CardButton}:hover & {
    border-radius: 6px;
    outline: 2px solid var(--theme-outline-variant);
  }
`

const Text = styled.div`
  min-width: 0;
  padding-inline: 2px;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Name = styled(EllipsizedText)`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const Subtitle = styled(EllipsizedText)`
  ${bodySmall};
  color: var(--color-grey-blue80);
`

const shortDateFormat = dateTimeFormat({ month: 'short', day: 'numeric' })
const shortDateWithYearFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

/**
 * Returns a function formatting a date for a collection's subtitle: the day and month, and the year
 * too when it isn't this year.
 */
export function useCollectionSubtitleDate(): (date: Date) => string {
  const shortDate = useFormat(shortDateFormat)
  const shortDateWithYear = useFormat(shortDateWithYearFormat)
  // When the card first rendered is recent enough to tell this year by
  const [now] = useState(() => new Date())
  return date => (dateNeedsYear(date, now) ? shortDateWithYear : shortDate).format(date)
}

type CardCollection = MapCollectionCard_CollectionFragmentFragment

/** Returns the title and subtitle a collection's card shows. */
export function useCollectionCardText(collection: CardCollection): {
  title: string
  subtitle: string
} {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const formatDate = useCollectionSubtitleDate()
  return {
    title: collectionTitle(collection, t),
    subtitle: collectionSubtitle(collection, selfUser?.id, formatDate, t),
  }
}

export interface MapCollectionCardProps {
  collection: FragmentType<typeof MapCollectionCard_CollectionFragment>
  /**
   * Opens the collection in place (e.g. in the map picker). Without it, the card links to the
   * collection's page.
   */
  onOpen?: () => void
  /** The width the card is expected to be drawn at, in CSS pixels. */
  imageSize?: number
}

/**
 * A collection as a card: a mosaic of its first maps, its title, and a line saying whose it is and
 * how many maps it holds. Its owner (and staff) also see whether staff hid it.
 */
export function MapCollectionCard({
  collection: collectionRef,
  onOpen,
  imageSize = 280,
}: MapCollectionCardProps) {
  const { t } = useTranslation()
  const collection = useFragment(MapCollectionCard_CollectionFragment, collectionRef)
  const { title, subtitle } = useCollectionCardText(collection)

  const contents = (
    <>
      <ImageBox>
        <MapCollectionMosaic collection={collection} size={imageSize} />
        {collection.hidden ? (
          <TileBadge>{t('maps.collections.hiddenByStaff', 'Hidden by staff')}</TileBadge>
        ) : null}
      </ImageBox>
      <Text>
        <Name text={title} />
        <Subtitle text={subtitle} />
      </Text>
    </>
  )

  return (
    <Root>
      {onOpen ? (
        <CardButton type='button' onClick={onOpen}>
          {contents}
        </CardButton>
      ) : (
        <CardLink
          href={urlForMapCollection(
            makeMapCollectionId(collection.id),
            collection.title ?? undefined,
          )}>
          {contents}
        </CardLink>
      )}
    </Root>
  )
}
