import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { urlForMap } from '../../common/map-url'
import { filterColorCodes, SbMapId, Tileset, tilesetToName } from '../../common/maps'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapKind, MapTile_SbMapFragmentFragment } from '../gql/graphql'
import { narrowDuration } from '../i18n/date-formats'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { useCurrentMapPoolTypes } from '../matchmaking/map-pool-membership'
import { IconButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodySmall, labelMedium, singleLine, titleSmall } from '../styles/typography'
import { openMapDownloadDialog, removeFromMyMaps } from './action-creators'
import { useToggleMapFavorite } from './map-favorites'
import { MapFileImage } from './map-image'
import { umsForceLayout } from './map-page-summaries'

export const MapTile_SbMapFragment = graphql(/* GraphQL */ `
  fragment MapTile_SbMapFragment on SbMap {
    id
    name
    kind
    playerCount
    official
    publishedAt
    isFavorited
    stats {
      id
      games7d
      games28d
      gamesTotal
      trendingScore
    }
    file {
      id
      ...MapFileImage_FileFragment
      width
      height
      tileset
      isEud
      umsForces {
        name
        teamId
        players {
          playerId
          isComputer
        }
      }
    }
  }
`)

/** How long after being published a map counts as new. */
const NEW_MAP_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The trending score from which a map counts as rising: lobby play this week at least 2 standard
 * deviations above what the weeks before it predict.
 */
const RISING_TRENDING_SCORE = 200

/** Which fact the line under a tile's name shows, chosen to explain the order of the list. */
export enum MapTileSignal {
  /** Games this week for maps that are rising, otherwise games this month. */
  Trending,
  /** Games this month. */
  Month,
  /** When the map was published. */
  Published,
  /** When the map was added to the viewer's maps (`addedAt`). */
  Added,
  /** Games ever. */
  Total,
}

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })

const Root = styled.div`
  position: relative;
  min-width: 0;
`

const TileLink = styled(LinkButton)`
  display: flex;
  flex-direction: column;
  gap: 8px;

  border-radius: 8px;
  outline-offset: 2px;
`

const ImageBox = styled.div`
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  overflow: hidden;

  border-radius: 6px;
  background-color: var(--theme-container-low);
  container-type: inline-size;

  ${TileLink}:hover & {
    outline: 2px solid var(--theme-outline-variant);
  }
`

const Badge = styled.div`
  ${labelMedium};
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;

  border-radius: 999px;
  background-color: var(--theme-amber-container);
  color: var(--theme-on-amber-container);
  pointer-events: none;
`

const PoolChips = styled.div`
  position: absolute;
  right: 6px;
  bottom: 6px;
  max-width: calc(100% - 12px);

  display: flex;
  flex-wrap: wrap-reverse;
  justify-content: flex-end;
  gap: 4px;

  @container (max-width: 140px) {
    display: none;
  }
`

const PoolChip = styled(Tooltip)`
  ${labelMedium};
  ${singleLine};
  padding: 2px 8px;

  border-radius: 999px;
  background-color: rgb(from var(--color-blue10) r g b / 0.72);
  color: var(--theme-on-surface);
`

const FavoriteButton = styled(IconButton)`
  position: absolute;
  top: 4px;
  right: 4px;

  background-color: rgb(from var(--color-blue10) r g b / 0.5);
`

const Text = styled.div<{ $hasMenu: boolean }>`
  min-width: 0;
  padding-inline: 2px ${props => (props.$hasMenu ? '40px' : '2px')};

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Name = styled.div`
  ${titleSmall};
  ${singleLine};
  color: var(--theme-on-surface);
`

const Meta = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Signal = styled.div<{ $rising?: boolean }>`
  ${bodySmall};
  ${singleLine};
  color: ${props => (props.$rising ? 'var(--theme-positive)' : 'var(--theme-on-surface-variant)')};
`

const MenuButton = styled(IconButton)`
  position: absolute;
  right: -4px;
  bottom: 4px;
`

export interface MapTileProps {
  map: FragmentType<typeof MapTile_SbMapFragment>
  signal: MapTileSignal
  /** When the map was added to the viewer's maps, for {@link MapTileSignal.Added}. */
  addedAt?: string
  /**
   * Whether the tile has a menu with actions for one of the viewer's own maps. Called with the
   * map's id once it has been removed from them.
   */
  onRemovedFromLibrary?: (id: SbMapId) => void
  /** The width the tile's image is expected to be drawn at, in CSS pixels. */
  imageSize: number
}

/** A map in the catalog: its image and the facts to judge it by, linking to its page. */
export function MapTile({
  map: mapRef,
  signal,
  addedAt,
  onRemovedFromLibrary,
  imageSize,
}: MapTileProps) {
  const { t } = useTranslation()
  const map = useFragment(MapTile_SbMapFragment, mapRef)
  const poolTypes = useCurrentMapPoolTypes(map.id)
  const [toggleFavorite, favoritePending] = useToggleMapFavorite()

  // When the tile first rendered is recent enough to judge "new" by
  const [now] = useState(() => Date.now())

  const name = filterColorCodes(map.name)
  const isNew = !!map.publishedAt && now - Date.parse(map.publishedAt) < NEW_MAP_MS
  let badge: string | undefined
  if (map.official) {
    badge = t('maps.page.official', 'Official')
  } else if (isNew) {
    badge = t('maps.catalog.newBadge', 'New')
  }

  const favoriteLabel = map.isFavorited
    ? t('maps.thumbnail.removeFromFavorites', 'Remove from favorites')
    : t('maps.thumbnail.addToFavorites', 'Add to favorites')

  return (
    <Root>
      <TileLink href={urlForMap(map.id, map.name)}>
        <ImageBox>
          <MapFileImage
            file={map.file}
            name={name}
            size={imageSize}
            forceAspectRatio={1}
            showSpawns={true}
          />
          {badge ? <Badge>{badge}</Badge> : null}
          {poolTypes.length ? (
            <PoolChips>
              {poolTypes.map(type => {
                const label = matchmakingTypeToLabel(type, t)
                return (
                  <PoolChip
                    key={type}
                    text={t(
                      'maps.thumbnail.mapPoolChipTooltip',
                      'In the current {{mode}} ladder map pool',
                      { mode: label },
                    )}
                    position='top'
                    tabIndex={-1}>
                    {label}
                  </PoolChip>
                )
              })}
            </PoolChips>
          ) : null}
        </ImageBox>
        <Text $hasMenu={!!onRemovedFromLibrary}>
          <Name title={name}>{name}</Name>
          <Meta>
            <MapTileMeta map={map} />
          </Meta>
          <MapTileSignalLine map={map} signal={signal} addedAt={addedAt} />
        </Text>
      </TileLink>
      <Tooltip text={favoriteLabel} position='bottom' tabIndex={-1}>
        <FavoriteButton
          icon={<MaterialIcon icon='star' filled={map.isFavorited} />}
          ariaLabel={favoriteLabel}
          disabled={favoritePending}
          onClick={() => toggleFavorite(map)}
        />
      </Tooltip>
      {onRemovedFromLibrary ? (
        <LibraryMapMenu mapId={map.id} mapName={map.name} onRemoved={onRemovedFromLibrary} />
      ) : null}
    </Root>
  )
}

type TileMap = MapTile_SbMapFragmentFragment

function MapTileMeta({ map }: { map: TileMap }) {
  const { t } = useTranslation()
  const players = t('maps.catalog.players', {
    defaultValue: '{{count}} players',
    defaultValue_one: '{{count}} player',
    count: map.playerCount,
  })

  if (map.kind === MapKind.Ums) {
    const parts: string[] = []
    const layout = umsForceLayout(map.file.umsForces)
    if (layout) {
      const teams = layout.teams.join(` ${t('maps.page.forceVersus', 'vs')} `)
      parts.push(
        layout.computers > 0
          ? t('maps.page.forcesWithComputers', {
              defaultValue: '{{teams}} + {{count}} computers',
              defaultValue_one: '{{teams}} + {{count}} computer',
              teams,
              count: layout.computers,
            })
          : teams,
      )
    } else {
      parts.push(players)
    }
    if (map.file.isEud) {
      parts.push(t('maps.page.eud', 'EUD'))
    }
    return <>{parts.join(' · ')}</>
  }

  return (
    <>
      {[
        players,
        `${map.file.width}×${map.file.height}`,
        tilesetToName(map.file.tileset as Tileset, t),
      ].join(' · ')}
    </>
  )
}

function MapTileSignalLine({
  map,
  signal,
  addedAt,
}: {
  map: TileMap
  signal: MapTileSignal
  addedAt?: string
}) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  const durations = useFormat(narrowDuration)
  const { stats } = map

  switch (signal) {
    case MapTileSignal.Added:
      if (addedAt) {
        return (
          <Signal>
            {t('maps.catalog.addedAgo', {
              defaultValue: 'Added {{time}}',
              time: durations.format(new Date(addedAt)),
            })}
          </Signal>
        )
      }
      break
    case MapTileSignal.Published:
      if (map.publishedAt) {
        return (
          <Signal>
            {t('maps.catalog.publishedAgo', {
              defaultValue: 'Published {{time}}',
              time: durations.format(new Date(map.publishedAt)),
            })}
          </Signal>
        )
      }
      break
    case MapTileSignal.Trending:
      if (stats && stats.trendingScore >= RISING_TRENDING_SCORE) {
        return (
          <Signal $rising={true}>
            {t('maps.catalog.gamesThisWeek', {
              defaultValue: '{{formattedCount}} games this week',
              defaultValue_one: '{{formattedCount}} game this week',
              count: stats.games7d,
              formattedCount: numbers.format(stats.games7d),
            })}
          </Signal>
        )
      }
      return <MonthSignal games={stats?.games28d} />
    case MapTileSignal.Month:
      return <MonthSignal games={stats?.games28d} />
    case MapTileSignal.Total:
      break
    default:
      signal satisfies never
  }

  return (
    <Signal>
      {stats
        ? t('maps.catalog.plays', {
            defaultValue: '{{formattedCount}} plays',
            defaultValue_one: '{{formattedCount}} play',
            count: stats.gamesTotal,
            formattedCount: numbers.format(stats.gamesTotal),
          })
        : t('maps.catalog.notPlayed', 'Not played yet')}
    </Signal>
  )
}

function MonthSignal({ games }: { games: number | undefined }) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  return (
    <Signal>
      {games === undefined
        ? t('maps.catalog.notPlayed', 'Not played yet')
        : t('maps.catalog.gamesThisMonth', {
            defaultValue: '{{formattedCount}} games this month',
            defaultValue_one: '{{formattedCount}} game this month',
            count: games,
            formattedCount: numbers.format(games),
          })}
    </Signal>
  )
}

function LibraryMapMenu({
  mapId,
  mapName,
  onRemoved,
}: {
  mapId: SbMapId
  mapName: string
  onRemoved: (id: SbMapId) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const items: Array<[text: string, handler: () => void]> = [
    [t('maps.catalog.viewMap', 'View map'), () => push(urlForMap(mapId, mapName))],
    [t('maps.thumbnail.downloadMap', 'Download'), () => dispatch(openMapDownloadDialog(mapId))],
    [
      t('maps.thumbnail.removeFromMyMaps', 'Remove from my maps'),
      () =>
        dispatch(
          removeFromMyMaps(mapId, {
            onSuccess: () => {
              snackbarController.showSnackbar(
                t('maps.server.removedFromMyMaps', 'Removed from your maps'),
              )
              onRemoved(mapId)
            },
            onError: () =>
              snackbarController.showSnackbar(
                t(
                  'maps.server.removeFromMyMapsError',
                  'An error occurred while removing the map from your maps',
                ),
              ),
          }),
        ),
    ],
  ]

  return (
    <>
      <MenuButton
        ref={anchorRef}
        icon={<MaterialIcon icon='more_vert' />}
        ariaLabel={t('maps.catalog.mapActions', 'Map actions')}
        onClick={openMenu}
      />
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList dense={true}>
          {items.map(([text, handler]) => (
            <MenuItem
              key={text}
              text={text}
              onClick={() => {
                closeMenu()
                handler()
              }}
            />
          ))}
        </MenuList>
      </Popover>
    </>
  )
}

/** A tile-shaped placeholder for a map file that's being uploaded, or that failed to upload. */
export function PendingMapTile({
  fileName,
  error,
  onDismiss,
}: {
  fileName: string
  /** Why the upload failed. Unset while it's still uploading. */
  error?: string
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  return (
    <Root>
      <PendingImage $error={!!error}>
        {error ? (
          <>
            <MaterialIcon icon='error' size={32} />
            <PendingError>{error}</PendingError>
          </>
        ) : (
          <>
            <MaterialIcon icon='upload' size={32} />
            <PendingStatus>{t('maps.catalog.uploading', 'Uploading…')}</PendingStatus>
          </>
        )}
      </PendingImage>
      <Text $hasMenu={!!error}>
        <Name title={fileName}>{fileName}</Name>
        <Meta>
          {error
            ? t('maps.catalog.uploadFailed', 'Upload failed')
            : t('maps.catalog.privateUpload', 'Private upload')}
        </Meta>
      </Text>
      {error ? (
        <MenuButton
          icon={<MaterialIcon icon='close' />}
          ariaLabel={t('maps.catalog.dismissUpload', 'Dismiss')}
          onClick={onDismiss}
        />
      ) : null}
    </Root>
  )
}

const PendingImage = styled.div<{ $error: boolean }>`
  aspect-ratio: 1;
  width: 100%;
  margin-bottom: 8px;
  padding: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;

  border: 2px dashed
    ${props => (props.$error ? 'var(--theme-error)' : 'var(--theme-outline-variant)')};
  border-radius: 6px;
  color: ${props => (props.$error ? 'var(--theme-error)' : 'var(--theme-on-surface-variant)')};
  text-align: center;
`

const PendingStatus = styled.div`
  ${bodySmall};
`

const PendingError = styled.div`
  ${bodySmall};
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
`
