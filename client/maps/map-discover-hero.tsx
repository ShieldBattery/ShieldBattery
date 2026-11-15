import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { urlForMapCollection } from '../../common/map-url'
import { filterColorCodes, makeMapCollectionId } from '../../common/maps'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapDiscoverHero_FeatureFragmentFragment } from '../gql/graphql'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, TextButton } from '../material/button'
import { elevationPlus1 } from '../material/shadows'
import { push } from '../navigation/routing'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyLarge,
  bodyMedium,
  displaySmall,
  labelLarge,
  labelMedium,
  titleLarge,
} from '../styles/typography'
import { MapByline } from './map-byline'
import {
  MapCollectionCard_CollectionFragment,
  MapCollectionMosaic,
  useCollectionCardText,
} from './map-collection-card'
import { mapCountText } from './map-collection-text'
import { urlForMapFile } from './map-family-files'
import { useCollectionHostAction, useMapHostAction } from './map-host-action'
import { MapFileImage } from './map-image'
import { MapTile_SbMapFragment, mapTileMeta, RISING_TRENDING_SCORE } from './map-tile'

export const MapDiscoverHero_FeatureFragment = graphql(/* GraphQL */ `
  fragment MapDiscoverHero_FeatureFragment on MapFeature {
    id
    blurb
    automatic
    map {
      id
      description
      family {
        id
        name
        current {
          id
        }
        owner {
          id
        }
        ownerKind
        credit
        stats {
          id
          trendingScore
          games7d
        }
      }
      file {
        id
        ...MapFileImage_FileFragment
      }
      ...MapTile_SbMapFragment
    }
    collection {
      id
      description
      mapCount
      ...MapCollectionCard_CollectionFragment
    }
  }
`)

/** The hero's width below which its image is left out and its text stands alone. */
const TEXT_ONLY_BELOW_PX = 700

/** The width the hero's image is expected to be drawn at, in CSS pixels. */
const HERO_IMAGE_SIZE = 1024

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })

const Root = styled.section`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
  position: relative;
  min-height: 320px;
  overflow: hidden;
  container-type: inline-size;

  display: flex;
  align-items: center;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

/** The map's image (or the collection's mosaic) along the hero's right side, fading out to the left. */
const ImageArea = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 68%;

  mask-image: linear-gradient(to right, transparent, black 55%);

  @container (width < ${TEXT_ONLY_BELOW_PX}px) {
    display: none;
  }
`

/** Stretches the collection's mosaic over the whole image area, its maps cropped to fit. */
const HeroMosaic = styled(MapCollectionMosaic)`
  height: 100%;
  aspect-ratio: auto;
  border: none;
  border-radius: 0;
`

const Text = styled.div`
  position: relative;
  width: 100%;
  max-width: 560px;
  padding: 32px 40px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;

  @container (width < ${TEXT_ONLY_BELOW_PX}px) {
    max-width: none;
    padding: 24px;
  }
`

const Label = styled.div`
  ${labelMedium};
  color: var(--theme-amber);
  text-transform: uppercase;
  letter-spacing: 0.12em;
`

const Name = styled.h2`
  ${displaySmall};
  margin: 0;
  color: var(--theme-on-surface);
  overflow-wrap: anywhere;

  @container (width < ${TEXT_ONLY_BELOW_PX}px) {
    ${titleLarge};
  }
`

const HeroByline = styled(MapByline)`
  && {
    ${bodyMedium};
  }
`

const Meta = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Blurb = styled.p`
  ${bodyLarge};
  margin: 0;
  color: var(--theme-on-surface);
  overflow-wrap: anywhere;

  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const StatLine = styled.div<{ $rising: boolean }>`
  ${labelLarge};
  display: flex;
  align-items: center;
  gap: 6px;

  color: ${props => (props.$rising ? 'var(--theme-positive)' : 'var(--theme-on-surface-variant)')};
`

const Buttons = styled.div`
  margin-top: 4px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

/**
 * The map or collection leading the Discover page this week: the staff's pick, or the map rising
 * fastest. Renders nothing for a feature with nothing the viewer can see.
 */
export function MapDiscoverHero({
  feature: featureRef,
}: {
  feature: FragmentType<typeof MapDiscoverHero_FeatureFragment>
}) {
  const feature = useFragment(MapDiscoverHero_FeatureFragment, featureRef)
  if (feature.map) {
    return <MapHero map={feature.map} blurb={feature.blurb} automatic={feature.automatic} />
  } else if (feature.collection) {
    return <CollectionHero collection={feature.collection} blurb={feature.blurb} />
  }
  return null
}

type HeroMap = NonNullable<MapDiscoverHero_FeatureFragmentFragment['map']>
type HeroCollection = NonNullable<MapDiscoverHero_FeatureFragmentFragment['collection']>

function MapHero({ map, blurb, automatic }: { map: HeroMap; blurb: string; automatic: boolean }) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  const { isLobbyHost, play } = useMapHostAction()
  const tileMap = useFragment(MapTile_SbMapFragment, map)
  const name = filterColorCodes(tileMap.name)
  const text = blurb || filterColorCodes(map.description).trim()
  // The map's play as a whole, which the automatic pick is chosen by, not just its current file's
  const stats = map.family.stats

  return (
    <Root>
      <ImageArea>
        <MapFileImage file={map.file} name={name} size={HERO_IMAGE_SIZE} loading='eager' />
      </ImageArea>
      <Text>
        <Label>
          {automatic
            ? t('maps.discover.onTheRise', 'On the rise')
            : t('maps.discover.mapOfTheWeek', 'Map of the week')}
        </Label>
        <Name>{name}</Name>
        <HeroByline
          owner={map.family.owner ?? undefined}
          ownerKind={map.family.ownerKind ?? undefined}
          credit={map.family.credit ?? undefined}
          facts={mapTileMeta(tileMap, t)}
        />
        {text ? <Blurb>{text}</Blurb> : null}
        {stats && stats.games7d > 0 ? (
          <StatLine $rising={stats.trendingScore >= RISING_TRENDING_SCORE}>
            {stats.trendingScore >= RISING_TRENDING_SCORE ? (
              <MaterialIcon icon='trending_up' size={20} />
            ) : null}
            {t('maps.catalog.gamesThisWeek', {
              defaultValue: '{{formattedCount}} games this week',
              defaultValue_one: '{{formattedCount}} game this week',
              count: stats.games7d,
              formattedCount: numbers.format(stats.games7d),
            })}
          </StatLine>
        ) : null}
        <Buttons>
          <FilledButton
            label={t('maps.catalog.viewMap', 'View map')}
            onClick={() => push(urlForMapFile(map.family, map.id))}
          />
          {IS_ELECTRON ? (
            <TextButton
              label={
                isLobbyHost
                  ? t('maps.page.useInMyLobby', 'Use in my lobby')
                  : t('maps.collections.createLobby', 'Create lobby')
              }
              onClick={() => play(map.id)}
            />
          ) : null}
        </Buttons>
      </Text>
    </Root>
  )
}

function CollectionHero({ collection, blurb }: { collection: HeroCollection; blurb: string }) {
  const { t } = useTranslation()
  const hostLobby = useCollectionHostAction()
  const card = useFragment(MapCollectionCard_CollectionFragment, collection)
  const { title } = useCollectionCardText(card)
  const id = makeMapCollectionId(collection.id)
  const text = blurb || collection.description.trim()

  return (
    <Root>
      <ImageArea>
        <HeroMosaic collection={card} size={HERO_IMAGE_SIZE} />
      </ImageArea>
      <Text>
        <Label>{t('maps.discover.collectionOfTheWeek', 'Collection of the week')}</Label>
        <Name>{title}</Name>
        <Meta>{mapCountText(collection.mapCount, t)}</Meta>
        {text ? <Blurb>{text}</Blurb> : null}
        <Buttons>
          <FilledButton
            label={t('maps.discover.viewCollection', 'View collection')}
            onClick={() => push(urlForMapCollection(id, card.title ?? undefined))}
          />
          {IS_ELECTRON && collection.mapCount > 0 ? (
            <TextButton
              label={t('maps.collections.createLobby', 'Create lobby')}
              onClick={() => hostLobby(id)}
            />
          ) : null}
        </Buttons>
      </Text>
    </Root>
  )
}
