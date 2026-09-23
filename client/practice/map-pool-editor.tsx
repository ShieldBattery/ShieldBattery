import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MapInfoJson, SbMapId } from '../../common/maps'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { BrowseServerMaps } from '../maps/browse-server-maps'
import { MapThumbnail } from '../maps/map-thumbnail'
import { SelectableMapContainer } from '../matchmaking/find-match-forms'
import { OutlinedButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodySmall, labelLarge } from '../styles/typography'
import {
  downloadingMapHashesAtom,
  installedMapHashesAtom,
  practiceStoreAtom,
} from './practice-atoms'
import { ensureMapsDownloaded } from './practice-launch'
import { rememberMaps } from './practice-store'

const Grid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`

/** Edge length of a pool tile: small enough for five per row, wide enough for the name overlay. */
const POOL_TILE_SIZE_PX = 120

const Tile = styled(SelectableMapContainer)<{ $dimmed: boolean }>`
  --sb-map-thumbnail-selected-color: var(--theme-error);

  width: ${POOL_TILE_SIZE_PX}px;
  height: ${POOL_TILE_SIZE_PX}px;

  & img {
    opacity: ${props => (props.$dimmed ? 0.4 : 1)};
  }
`

const SmallTile = styled.div<{ $size: number }>`
  position: relative;
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;

  border-radius: 4px;
  border: 1px solid rgb(from var(--theme-outline) r g b / 0.5);
  contain: content;
`

/** Stands in for the maps a capped strip leaves out, showing how many there are. */
const OverflowTile = styled.div<{ $size: number }>`
  ${labelLarge};
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 4px;
  border: 1px solid rgb(from var(--theme-outline) r g b / 0.5);
  background-color: var(--theme-container-highest);
  color: var(--theme-on-surface-variant);
`

const DownloadOverlay = styled.button`
  ${buttonReset};

  position: absolute;
  inset: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--theme-on-surface);

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: -3px;
  }
`

const DownloadPill = styled.span`
  ${labelLarge};

  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px 0 8px;

  border-radius: 16px;
  border: 1px solid var(--theme-outline);
  background-color: rgb(from var(--color-blue10) r g b / 0.85);
  color: var(--color-blue80);

  ${DownloadOverlay}:hover & {
    background-color: rgb(from var(--color-blue10) r g b / 0.95);
    border-color: var(--color-blue80);
  }
`

const CornerButton = styled.button`
  ${buttonReset};

  position: absolute;
  top: 4px;
  right: 4px;
  width: 28px;
  height: 28px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  background-color: rgb(from var(--color-blue10) r g b / 0.72);
  color: var(--theme-on-surface);

  &:disabled {
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const EmptyPool = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

export interface MapPoolGridProps {
  maps: ReadonlyArray<MapInfoJson>
  /**
   * Edge length of a plain thumbnail, for a compact strip. Without it, tiles are selectable map
   * tiles with the map name overlaid.
   */
  size?: number
  /**
   * Caps a compact strip at this many tiles: when the pool is larger, the last tile stands in for
   * the rest with a count. Only applies with `size`.
   */
  maxTiles?: number
  onRemove?: (mapId: SbMapId) => void
  /** Maps shown but left out of the draw; requires `onToggleVeto`. */
  vetoedMapIds?: ReadonlySet<SbMapId>
  /** Turns a map's veto on or off when its tile is clicked. */
  onToggleVeto?: (mapId: SbMapId) => void
  /** Whether a further veto is allowed (a pool always keeps at least one map in play). */
  canVetoMore?: boolean
  className?: string
}

/**
 * Shows the maps a practice pool draws from. Maps whose files aren't on this PC are marked and can
 * be downloaded from here, because an undownloaded map is never drawn. Vetoed maps stay visible so
 * they can be turned back on.
 */
export function MapPoolGrid({
  maps,
  size,
  maxTiles,
  onRemove,
  vetoedMapIds,
  onToggleVeto,
  canVetoMore = true,
  className,
}: MapPoolGridProps) {
  const { t } = useTranslation()
  const installed = useAtomValue(installedMapHashesAtom)
  const downloading = useAtomValue(downloadingMapHashesAtom)

  if (maps.length === 0) {
    return (
      <EmptyPool className={className}>
        {t('practice.mapPool.empty', 'No maps chosen yet.')}
      </EmptyPool>
    )
  }

  const capped = size !== undefined && maxTiles !== undefined && maps.length > maxTiles
  const shown = capped ? maps.slice(0, maxTiles - 1) : maps
  const hiddenCount = maps.length - shown.length

  return (
    <Grid className={className}>
      {shown.map(map => {
        const isDownloading = downloading.has(map.hash)
        const isInstalled = installed.has(map.hash)
        const isVetoed = vetoedMapIds?.has(map.id) ?? false
        const vetoBlocked = !isVetoed && !canVetoMore
        // A vetoed map isn't drawn, so there's nothing to download for it until it's put back.
        const needsDownload = !isInstalled && !isVetoed

        const downloadOverlay = needsDownload ? (
          <DownloadOverlay
            type='button'
            disabled={isDownloading}
            aria-label={t('practice.mapPool.downloadMap', {
              defaultValue: 'Download {{mapName}}',
              mapName: map.name,
            })}
            onClick={() => {
              ensureMapsDownloaded([map]).catch(err => {
                logger.error(`Failed to download a practice map: ${err?.stack ?? err}`)
              })
            }}>
            <DownloadPill>
              <MaterialIcon icon={isDownloading ? 'hourglass_top' : 'download'} size={18} />
              {isDownloading
                ? t('practice.mapPool.downloading', 'Downloading…')
                : t('practice.mapPool.download', 'Download')}
            </DownloadPill>
          </DownloadOverlay>
        ) : null

        const removeButton = onRemove ? (
          <CornerButton
            type='button'
            aria-label={t('practice.mapPool.removeMap', {
              defaultValue: 'Remove {{mapName}} from the pool',
              mapName: map.name,
            })}
            onClick={() => onRemove(map.id)}>
            <MaterialIcon icon='close' size={18} />
          </CornerButton>
        ) : null

        if (size !== undefined) {
          return (
            <SmallTile key={map.id} $size={size}>
              <MapThumbnail map={map} showInfoLayer={false} />
              {downloadOverlay}
              {removeButton}
            </SmallTile>
          )
        }

        // An undownloaded map's whole tile is its download action, so vetoing it moves to a
        // corner control instead of the tile click.
        const vetoOnClick = onToggleVeto && !needsDownload ? () => onToggleVeto(map.id) : undefined
        const vetoCorner =
          onToggleVeto && needsDownload ? (
            <CornerButton
              type='button'
              disabled={vetoBlocked}
              title={
                vetoBlocked
                  ? t('practice.mapPool.lastMap', 'At least one map has to stay in the pool')
                  : t('practice.mapPool.vetoMap', 'Leave this map out')
              }
              aria-label={t('practice.mapPool.vetoMapNamed', {
                defaultValue: 'Leave {{mapName}} out of the pool',
                mapName: map.name,
              })}
              onClick={() => onToggleVeto(map.id)}>
              <MaterialIcon icon='thumb_down' size={16} />
            </CornerButton>
          ) : null

        return (
          <Tile
            key={map.id}
            $selected={isVetoed}
            $disabled={vetoBlocked && !needsDownload}
            $dimmed={needsDownload}>
            <MapThumbnail
              map={map}
              showInfoLayer={true}
              forceAspectRatio={1}
              size={POOL_TILE_SIZE_PX}
              isSelected={isVetoed}
              selectedIcon={<MaterialIcon icon='thumb_down' size={40} />}
              onClick={vetoOnClick}
            />
            {downloadOverlay}
            {vetoCorner}
            {removeButton}
          </Tile>
        )
      })}
      {hiddenCount > 0 && size !== undefined ? (
        <OverflowTile
          $size={size}
          title={t('practice.mapPool.moreMaps', {
            defaultValue_one: '{{count}} more map',
            defaultValue_other: '{{count}} more maps',
            count: hiddenCount,
          })}>
          +{hiddenCount}
        </OverflowTile>
      ) : null}
    </Grid>
  )
}

const EditorRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const BrowsePanel = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  height: 640px;
  border-radius: 4px;
  contain: strict;
`

const BrowseActions = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const BrowseHint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

export interface MapPoolEditorProps {
  mapIds: ReadonlyArray<SbMapId>
  /** Adds the map to the pool, or removes it when it's already in. */
  onToggle: (mapId: SbMapId) => void
}

/**
 * Editing surface for a custom practice pool: the chosen maps plus an in-page map browser whose
 * clicks toggle a map in or out of the pool.
 */
export function MapPoolEditor({ mapIds, onToggle }: MapPoolEditorProps) {
  const { t } = useTranslation()
  const [browsing, setBrowsing] = useState(false)
  const mapsById = useAppSelector(s => s.maps.byId)
  const knownMaps = useAtomValue(practiceStoreAtom).knownMaps

  const chosen = mapIds
    .map(id => knownMaps[id] ?? (mapsById.get(id) as MapInfoJson | undefined))
    .filter((m): m is MapInfoJson => !!m)

  const toggleMap = (mapId: SbMapId) => {
    const map = mapsById.get(mapId) as MapInfoJson | undefined
    if (map) {
      rememberMaps([map])
    }
    onToggle(mapId)
  }

  return (
    <EditorRoot>
      <MapPoolGrid maps={chosen} onRemove={toggleMap} />
      <BrowseActions>
        <OutlinedButton
          label={
            browsing
              ? t('practice.mapPool.doneChoosing', 'Done choosing maps')
              : t('practice.mapPool.chooseMaps', 'Choose maps')
          }
          iconStart={<MaterialIcon icon={browsing ? 'check' : 'add'} />}
          onClick={() => setBrowsing(!browsing)}
        />
        {browsing ? (
          <BrowseHint>
            {t('practice.mapPool.browseHint', 'Click a map to add or remove it from the pool.')}
          </BrowseHint>
        ) : null}
      </BrowseActions>
      {browsing ? (
        <BrowsePanel>
          <BrowseServerMaps onMapClick={toggleMap} />
        </BrowsePanel>
      ) : null}
    </EditorRoot>
  )
}
