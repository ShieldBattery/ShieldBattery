import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbMapId, tilesetToName } from '../../../common/maps'
import { MaterialIcon } from '../../icons/material/material-icon'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { OutlinedButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { InputError } from '../../material/input-error'
import { useAppSelector } from '../../redux-hooks'
import { bodyLarge, bodySmall, labelLarge, singleLine } from '../../styles/typography'

export const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export const SectionHeader = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

/**
 * Arranges the map thumbnail alongside its name and meta line. Narrow containers lay these out as
 * a single compact row; wide containers turn the whole thing into a card, stacking the full-width
 * thumbnail (whose own name bar takes over what the row would otherwise show inline) above the
 * meta line and the change-map button.
 */
const MapPanel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;

  @container (min-width: 720px) {
    flex-direction: column;
    align-items: stretch;
    gap: 0;

    background-color: var(--theme-container-low);
    border-radius: 8px;
    overflow: hidden;
  }
`

const MapThumbnailWrapper = styled.div`
  width: 96px;
  height: 96px;
  aspect-ratio: 1;
  flex-shrink: 0;

  @container (min-width: 720px) {
    width: 100%;
    height: auto;
  }
`

const MapInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-grow: 1;
  min-width: 0;

  @container (min-width: 720px) {
    padding: 10px 12px 0;
  }
`

const MapName = styled.div`
  ${bodyLarge};
  ${singleLine};

  @container (min-width: 720px) {
    display: none;
  }
`

const MapMeta = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const ChangeMapButton = styled(OutlinedButton)`
  flex-shrink: 0;

  @container (min-width: 720px) {
    align-self: stretch;

    /* Inside the map card, inset the button to sit within the card's padded footer area. */
    ${MapPanel} > & {
      margin: 12px;
    }
  }
`

const EmptyMapPlaceholder = styled.button`
  ${buttonReset};

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;

  width: 96px;
  height: 96px;
  aspect-ratio: 1;
  flex-shrink: 0;

  border: 1px dashed var(--theme-outline);
  border-radius: 4px;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:disabled {
    cursor: default;
    opacity: var(--theme-disabled-opacity);
    pointer-events: none;
  }

  @container (min-width: 720px) {
    width: 100%;
    height: auto;
  }
`

const EmptyMapIcon = styled(MaterialIcon)`
  color: var(--theme-on-surface-variant);
`

const EmptyMapText = styled.div`
  ${labelLarge};
`

const RecentMapsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
`

const RecentMapWrapper = styled.div<{ $selected: boolean }>`
  aspect-ratio: 1;
  padding: 1px;
  border-radius: 6px;
  border: 2px solid ${props => (props.$selected ? 'var(--theme-amber)' : 'transparent')};
`

function RecentMapEntry({
  mapId,
  selected,
  disabled,
  onClick,
}: {
  mapId: SbMapId
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const mapName = useAppSelector(s => s.maps.byId.get(mapId)?.name)

  return (
    <RecentMapWrapper $selected={selected} title={mapName}>
      <ReduxMapThumbnail
        mapId={mapId}
        size={256}
        forceAspectRatio={1}
        hasMapDetailsAction={false}
        hasDownloadAction={false}
        hasFavoriteAction={false}
        hasMapPreviewAction={false}
        hasRegenMapImageAction={false}
        onClick={disabled ? undefined : onClick}
      />
    </RecentMapWrapper>
  )
}

export interface MapSelectionPanelProps {
  mapId?: SbMapId
  /** Maps to offer as one-click picks below the map card, in display order. */
  recentMaps?: ReadonlyArray<SbMapId>
  disabled?: boolean
  errorText?: string
  /** Extra text for the end of the selected map's meta line (e.g. whether it's downloaded). */
  metaSuffix?: string
  /** Called when the user asks to pick a different map; the caller shows the map browser. */
  onChangeMap: () => void
  /** Called with a recent map the user clicked. */
  onSelectMap: (mapId: SbMapId) => void
}

/**
 * The map side of a game setup: the selected map as a card with its meta line and a change-map
 * button (or a placeholder inviting a pick), plus recently used maps as one-click picks. Map info
 * comes from the redux map store, so every map offered here has to be loaded into it first. Lays
 * out for the nearest size container: a compact row when narrow, a card when 720px or wider.
 */
export function MapSelectionPanel({
  mapId,
  recentMaps,
  disabled,
  errorText,
  metaSuffix,
  onChangeMap,
  onSelectMap,
}: MapSelectionPanelProps) {
  const { t } = useTranslation()
  const selectedMapInfo = useAppSelector(s => (mapId ? s.maps.byId.get(mapId) : undefined))

  const mapMetaParts = selectedMapInfo
    ? [
        t('lobbies.createLobby.mapPlayerCount', {
          defaultValue: '{{count}} players',
          defaultValue_one: '{{count}} player',
          count: selectedMapInfo.mapData.slots,
        }),
        tilesetToName(selectedMapInfo.mapData.tileset, t),
        `${selectedMapInfo.mapData.width}×${selectedMapInfo.mapData.height}`,
      ]
    : []
  if (selectedMapInfo && metaSuffix) {
    mapMetaParts.push(metaSuffix)
  }

  return (
    <>
      {mapId ? (
        <MapPanel>
          <MapThumbnailWrapper>
            <ReduxMapThumbnail
              mapId={mapId}
              forceAspectRatio={1}
              size={512}
              showInfoLayer={true}
              onClick={disabled ? undefined : onChangeMap}
            />
          </MapThumbnailWrapper>
          <MapInfo>
            <MapName>{selectedMapInfo?.name ?? ''}</MapName>
            <MapMeta>{mapMetaParts.join(' · ')}</MapMeta>
          </MapInfo>
          <ChangeMapButton
            type='button'
            label={t('lobbies.hostGame.changeMap', 'Change map')}
            iconStart={<MaterialIcon icon='map' />}
            disabled={disabled}
            onClick={onChangeMap}
          />
        </MapPanel>
      ) : (
        <EmptyMapPlaceholder type='button' disabled={disabled} onClick={onChangeMap}>
          <EmptyMapIcon icon='map' />
          <EmptyMapText>{t('lobbies.createLobby.selectMap', 'Select map')}</EmptyMapText>
        </EmptyMapPlaceholder>
      )}
      {errorText ? <InputError error={errorText} /> : null}

      {recentMaps?.length ? (
        <Section>
          <SectionHeader>{t('lobbies.createLobby.recentMapsHeader', 'Recent maps')}</SectionHeader>
          <RecentMapsGrid>
            {recentMaps.map(id => (
              <RecentMapEntry
                key={id}
                mapId={id}
                selected={id === mapId}
                disabled={disabled}
                onClick={() => onSelectMap(id)}
              />
            ))}
          </RecentMapsGrid>
        </Section>
      ) : null}
    </>
  )
}
