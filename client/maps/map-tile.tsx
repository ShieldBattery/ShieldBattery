import { TFunction } from 'i18next'
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
import { RoomChip } from '../lobbies/room/room-parts'
import { useCurrentMapPoolTypes } from '../matchmaking/map-pool-membership'
import { IconButton } from '../material/button'
import { EllipsizedText } from '../material/ellipsized-text'
import { LinkButton } from '../material/link-button'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodySmall, labelMedium, labelSmall, singleLine, titleSmall } from '../styles/typography'
import { openMapDownloadDialog, openMapPreviewDialog, removeFromMyMaps } from './action-creators'
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
    listed
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

const TilePickButton = styled.button`
  width: 100%;
  margin: 0;
  padding: 0;

  display: flex;
  flex-direction: column;
  gap: 8px;

  border: none;
  border-radius: 8px;
  outline-offset: 2px;
  background: none;
  color: inherit;
  text-align: start;
  cursor: pointer;

  &:disabled {
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
  }
`

const ImageBox = styled.div<{ $selected?: boolean }>`
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  overflow: hidden;

  border: 1px solid rgb(from var(--color-blue80) r g b / 0.12);
  border-radius: 6px;
  background-color: var(--theme-container-low);
  container-type: inline-size;

  ${TileLink}:hover &, ${TilePickButton}:hover:not(:disabled) & {
    outline: 2px solid var(--theme-outline-variant);
  }

  && {
    ${props => (props.$selected ? 'outline: 2px solid var(--theme-amber);' : '')}
  }
`

/** Covers the image while a pick of the map is being completed. */
const PendingOverlay = styled.div`
  position: absolute;
  inset: 0;
  background-color: rgb(from var(--color-blue10) r g b / 0.6);
`

const QueueChip = styled.div`
  ${labelMedium};
  ${singleLine};
  position: absolute;
  left: 6px;
  bottom: 6px;
  max-width: calc(100% - 12px);
  padding: 2px 8px;

  border-radius: 999px;
  background-color: var(--theme-amber-container);
  color: var(--theme-on-amber-container);
  pointer-events: none;
`

const Badge = styled.div`
  ${labelSmall};
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  text-transform: uppercase;
  letter-spacing: 0.08em;

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

/** The buttons over the top right corner of the image. */
const CornerActions = styled.div`
  position: absolute;
  top: 6px;
  right: 6px;

  display: flex;
  gap: 4px;
`

const CornerButton = styled(IconButton)<{ $favorited?: boolean }>`
  width: 28px;
  height: 28px;
  min-height: 28px;

  background-color: rgb(from var(--color-blue10) r g b / 0.6);
  color: ${props => (props.$favorited ? 'var(--theme-amber)' : 'var(--theme-on-surface)')};
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

const Meta = styled(EllipsizedText)`
  ${bodySmall};
  color: var(--color-grey-blue80);
`

enum SignalTone {
  Default,
  Rising,
  Fresh,
  Error,
}

const Signal = styled(EllipsizedText)<{ $tone?: SignalTone }>`
  ${labelSmall};
  color: ${props => {
    switch (props.$tone) {
      case SignalTone.Rising:
        return 'var(--theme-positive)'
      case SignalTone.Fresh:
        return 'var(--color-amber70)'
      case SignalTone.Error:
        return 'var(--theme-error)'
      default:
        return 'var(--color-grey-blue70)'
    }
  }};
`

/** The row under one of the viewer's own maps: its visibility and the actions for it. */
const LibraryFooter = styled.div`
  min-height: 32px;
  padding-left: 2px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const UnlistedChip = styled(RoomChip)`
  padding-block: 2px;
`

const FooterMenuButton = styled(IconButton)`
  width: 32px;
  height: 32px;
  min-height: 32px;
  margin-left: auto;
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
  /** When set, the tile picks the map (for a lobby) rather than linking to its page. */
  pick?: MapTilePick
}

/** How a tile behaves when picking maps for a lobby. */
export interface MapTilePick {
  onPick: () => void
  /** Whether this is the map currently chosen. */
  selected: boolean
  /** Where the map sits in the lobby's map queue (1-based), if it's queued. */
  queuePositions?: ReadonlyArray<number>
  /** Whether a pick of this map is being completed. */
  pending: boolean
  /** Whether the last pick of this map failed. */
  failed: boolean
  disabled: boolean
}

/**
 * A map in the catalog: its image and the facts to judge it by, linking to its page (or, when
 * picking a map for a lobby, picking it).
 */
export function MapTile({
  map: mapRef,
  signal,
  addedAt,
  onRemovedFromLibrary,
  imageSize,
  pick,
}: MapTileProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
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

  const previewLabel = t('maps.thumbnail.showMapPreview', 'Show map preview')

  const contents = (
    <>
      <ImageBox $selected={pick?.selected}>
        <MapFileImage file={map.file} name={name} size={imageSize} forceAspectRatio={1} />
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
        {pick?.queuePositions?.length ? (
          <QueueChip>
            {t('maps.picker.inQueue', {
              defaultValue: '{{positions}} in queue',
              positions: pick.queuePositions.map(p => `#${p}`).join(', '),
            })}
          </QueueChip>
        ) : null}
        {pick?.pending ? (
          <PendingOverlay>
            <LoadingDotsArea />
          </PendingOverlay>
        ) : null}
      </ImageBox>
      <Text>
        <Name text={name} />
        <Meta text={mapTileMeta(map, t)} />
        {pick?.failed ? (
          <Signal
            $tone={SignalTone.Error}
            text={t('maps.picker.pickFailed', "Couldn't load this map. Select it to try again.")}
          />
        ) : (
          <MapTileSignalLine map={map} signal={signal} addedAt={addedAt} />
        )}
      </Text>
    </>
  )

  return (
    <Root>
      {pick ? (
        <TilePickButton
          type='button'
          aria-pressed={pick.selected}
          disabled={pick.disabled || pick.pending}
          onClick={pick.onPick}>
          {contents}
        </TilePickButton>
      ) : (
        <TileLink href={urlForMap(map.id, map.name)}>{contents}</TileLink>
      )}
      {onRemovedFromLibrary ? (
        <LibraryFooter>
          {map.listed ? null : <UnlistedChip>{t('maps.page.unlisted', 'Unlisted')}</UnlistedChip>}
          <LibraryMapMenu mapId={map.id} mapName={map.name} onRemoved={onRemovedFromLibrary} />
        </LibraryFooter>
      ) : (
        <CornerActions>
          {pick ? (
            <Tooltip text={previewLabel} position='bottom' tabIndex={-1}>
              <CornerButton
                icon={<MaterialIcon icon='zoom_in' size={18} />}
                ariaLabel={previewLabel}
                onClick={() => dispatch(openMapPreviewDialog(map.id))}
              />
            </Tooltip>
          ) : null}
          <Tooltip text={favoriteLabel} position='bottom' tabIndex={-1}>
            <CornerButton
              $favorited={map.isFavorited}
              icon={<MaterialIcon icon='star' size={18} filled={map.isFavorited} />}
              ariaLabel={favoriteLabel}
              disabled={favoritePending}
              onClick={() => toggleFavorite(map)}
            />
          </Tooltip>
        </CornerActions>
      )}
    </Root>
  )
}

type TileMap = MapTile_SbMapFragmentFragment

function mapTileMeta(map: TileMap, t: TFunction): string {
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
    return parts.join(' · ')
  }

  return [
    players,
    `${map.file.width}×${map.file.height}`,
    tilesetToName(map.file.tileset as Tileset, t),
  ].join(' · ')
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
          <Signal
            text={t('maps.catalog.addedAgo', {
              defaultValue: 'Added {{time}}',
              time: durations.format(new Date(addedAt)),
            })}
          />
        )
      }
      break
    case MapTileSignal.Published:
      if (map.publishedAt) {
        return (
          <Signal
            $tone={SignalTone.Fresh}
            text={t('maps.catalog.publishedAgo', {
              defaultValue: 'Published {{time}}',
              time: durations.format(new Date(map.publishedAt)),
            })}
          />
        )
      }
      break
    case MapTileSignal.Trending:
      if (stats && stats.trendingScore >= RISING_TRENDING_SCORE) {
        return (
          <Signal
            $tone={SignalTone.Rising}
            text={t('maps.catalog.gamesThisWeek', {
              defaultValue: '{{formattedCount}} games this week',
              defaultValue_one: '{{formattedCount}} game this week',
              count: stats.games7d,
              formattedCount: numbers.format(stats.games7d),
            })}
          />
        )
      }
      return <MonthSignal games={stats?.games28d} />
    case MapTileSignal.Total:
      break
    default:
      signal satisfies never
  }

  return (
    <Signal
      text={
        stats
          ? t('maps.catalog.totalGames', {
              defaultValue: '{{formattedCount}} games',
              defaultValue_one: '{{formattedCount}} game',
              count: stats.gamesTotal,
              formattedCount: numbers.format(stats.gamesTotal),
            })
          : t('maps.catalog.notPlayed', 'Not played yet')
      }
    />
  )
}

function MonthSignal({ games }: { games: number | undefined }) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  return (
    <Signal
      text={
        games === undefined
          ? t('maps.catalog.notPlayed', 'Not played yet')
          : t('maps.catalog.gamesThisMonth', {
              defaultValue: '{{formattedCount}} games this month',
              defaultValue_one: '{{formattedCount}} game this month',
              count: games,
              formattedCount: numbers.format(games),
            })
      }
    />
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
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const onRemove = () => {
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
    )
  }

  return (
    <>
      <FooterMenuButton
        ref={anchorRef}
        icon={<MaterialIcon icon='more_vert' size={20} />}
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
          <MenuItem
            text={t('maps.catalog.viewMap', 'View map')}
            icon={<MaterialIcon icon='info' />}
            onClick={() => {
              closeMenu()
              push(urlForMap(mapId, mapName))
            }}
          />
          <MenuItem
            text={t('maps.thumbnail.downloadMap', 'Download')}
            icon={<MaterialIcon icon='download' />}
            onClick={() => {
              closeMenu()
              dispatch(openMapDownloadDialog(mapId))
            }}
          />
          <DestructiveMenuItem
            text={t('maps.thumbnail.removeFromMyMaps', 'Remove from my maps')}
            icon={<MaterialIcon icon='delete' />}
            onClick={() => {
              closeMenu()
              onRemove()
            }}
          />
        </MenuList>
      </Popover>
    </>
  )
}

/** A tile-shaped placeholder for a map file that's being uploaded, or that failed to upload. */
export function PendingMapTile({
  fileName,
  progress,
  error,
  onDismiss,
}: {
  fileName: string
  /** The fraction of the file sent so far, once sending it has started. */
  progress?: number
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
            <PendingStatus>
              {progress === undefined
                ? t('maps.catalog.uploading', 'Uploading…')
                : t('maps.catalog.uploadingPercent', {
                    defaultValue: 'Uploading… {{percent}}%',
                    percent: Math.floor(progress * 100),
                  })}
            </PendingStatus>
            {progress !== undefined ? (
              <ProgressTrack>
                <ProgressFill style={{ width: `${progress * 100}%` }} />
              </ProgressTrack>
            ) : null}
          </>
        )}
      </PendingImage>
      <Text>
        <Name text={fileName} />
        <Meta
          text={
            error
              ? t('maps.catalog.uploadFailed', 'Upload failed')
              : t('maps.catalog.privateUpload', 'Private upload')
          }
        />
      </Text>
      <LibraryFooter>
        {error ? (
          <FooterMenuButton
            icon={<MaterialIcon icon='close' size={20} />}
            ariaLabel={t('maps.catalog.dismissUpload', 'Dismiss')}
            onClick={onDismiss}
          />
        ) : null}
      </LibraryFooter>
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

const ProgressTrack = styled.div`
  width: 80%;
  height: 4px;
  overflow: hidden;

  border-radius: 2px;
  background-color: var(--theme-container-highest);
`

const ProgressFill = styled.div`
  height: 100%;
  background-color: var(--theme-primary);
  transition: width 150ms linear;
`

const PendingError = styled.div`
  ${bodySmall};
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
`
