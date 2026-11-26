import { Immutable } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { SbMapId } from '../../common/maps'
import { getMatchmakingModeInfo } from '../../common/matchmaking'
import {
  MapPoolChangeNotice,
  MatchmakingMapPoolJson,
} from '../../common/matchmaking/matchmaking-map-pools'
import { TransInterpolation } from '../i18n/i18next'
import { dateTimeFormat, listFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { batchGetMapInfo } from '../maps/action-creators'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { TextButton } from '../material/button'
import { elevationPlus1, elevationPlus3 } from '../material/shadows'
import { useValueAsRef } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, bodyMedium, titleSmall } from '../styles/typography'
import {
  getDroppedSelectionsText,
  getMapPoolChangeSummaryText,
  groupDroppedSelections,
  orderMapsFirst,
} from './map-pool-change-text'
import { RaceSelect } from './race-select'

export const SectionTitle = styled.div`
  ${bodyLarge};
  margin: 8px 0 4px;
`

export const StyledRaceSelect = styled(RaceSelect)`
  margin: 12px 0;
`

export const DescriptionText = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export const MapSelectionsHeader = styled.div`
  margin: 40px 0 0px;

  display: flex;
  align-items: center;
`

export const MAP_THUMB_SIZE_PX = 196

export const MapSelections = styled.div`
  margin: 16px 0;

  display: grid;
  gap: 12px 12px;
  grid-auto-flow: row;
  grid-auto-rows: min-content;
  grid-template-columns: repeat(auto-fill, ${MAP_THUMB_SIZE_PX}px);
`

export const SelectableMapContainer = styled.div<{ $selected?: boolean; $disabled?: boolean }>`
  ${elevationPlus1};

  --sb-selectable-map-border: ${props =>
    props.$selected ? 'var(--sb-map-thumbnail-selected-color)' : 'var(--theme-outline)'};
  --sb-map-thumbnail-selected-icon-size: 48px;

  width: ${MAP_THUMB_SIZE_PX}px;
  height: ${MAP_THUMB_SIZE_PX}px;
  position: relative;
  border-radius: 4px;
  contain: strict;
  pointer-events: ${props => (props.$disabled ? 'none' : 'auto')};

  /** Add a border that is over top of the map image */
  &::after {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    content: '';
    pointer-events: none;

    border: 1px solid var(--sb-selectable-map-border);
    border-radius: 4px;
  }
`

// Floats at the bottom of the (scrollable) settings drawer so the remaining veto count stays visible
// while the user scrolls through the map pool vetoing maps, rather than being stuck below the grid.
const VetoStatus = styled.div`
  ${titleSmall};
  ${elevationPlus3};

  position: sticky;
  bottom: 16px;

  width: fit-content;
  margin-top: 24px;
  margin-left: auto;
  padding: 8px 16px;

  border-radius: 999px;
  background: var(--theme-container-highest);
  border: 1px solid color-mix(in srgb, var(--theme-on-surface) 12%, transparent);
  white-space: nowrap;
`

const VetoStatusLabel = styled.span`
  color: var(--theme-on-surface-variant);
`

const VetoStatusValue = styled.span<{ $exhausted: boolean }>`
  color: ${props => (props.$exhausted ? 'var(--theme-negative)' : 'var(--theme-on-surface)')};
`

interface ConnectedSelectableMapProps {
  mapId: SbMapId
  isSelected: boolean
  selectedIcon: React.ReactNode
  onClick: (mapId: SbMapId) => void
  disabled?: boolean
  isNew?: boolean
}

function SelectableMap({
  mapId,
  isSelected: isVetoed,
  onClick,
  disabled,
  selectedIcon,
  isNew,
}: ConnectedSelectableMapProps) {
  const newMapChip = useNewMapChip(isNew)
  const handleClick = useCallback(() => {
    if (!disabled) {
      onClick(mapId)
    }
  }, [mapId, onClick, disabled])

  // TODO(tec27): allow these to be keyboard focused and vetoed via keypress

  return (
    <SelectableMapContainer $selected={isVetoed} $disabled={disabled}>
      <ReduxMapThumbnail
        mapId={mapId}
        showInfoLayer={true}
        forceAspectRatio={1}
        size={MAP_THUMB_SIZE_PX}
        isSelected={isVetoed}
        onClick={handleClick}
        selectedIcon={selectedIcon}
        highlightChip={newMapChip}
      />
    </SelectableMapContainer>
  )
}

export interface MapVetoesControlProps {
  onChange: (vetoedMaps: SbMapId[]) => void
  value: SbMapId[] | null
  mapPool: Immutable<MatchmakingMapPoolJson>
  disabled: boolean
  /** Maps that are new to the pool. They're marked as such and listed first. */
  newMapIds?: ReadonlyArray<SbMapId>
  className?: string
  errorText?: string
}

export function MapVetoesControl({
  onChange,
  value,
  mapPool,
  disabled,
  newMapIds,
  className,
}: MapVetoesControlProps) {
  const { t } = useTranslation()
  const onChangeRef = useValueAsRef(onChange)
  const valueRef = useValueAsRef(value)
  const onClick = useCallback(
    (id: SbMapId) => {
      const newValue = [...(valueRef.current ?? [])]
      for (let i = 0; i < newValue.length; i++) {
        if (newValue[i] === id) {
          newValue.splice(i, 1)
          onChangeRef.current(newValue)
          return
        }
      }

      // value wasn't in the list, add it if there's space
      if (newValue.length < mapPool.maxVetoCount) {
        newValue.push(id)
        onChangeRef.current(newValue)
      }
    },
    [mapPool.maxVetoCount, onChangeRef, valueRef],
  )

  const vetoesLeft = mapPool.maxVetoCount - (value?.length ?? 0)
  return (
    <div className={className}>
      <MapSelections
        style={{ '--sb-map-thumbnail-selected-color': 'var(--theme-negative)' } as any}>
        {orderMapsFirst(mapPool.maps, newMapIds).map(id => (
          <SelectableMap
            key={id}
            mapId={id}
            isNew={newMapIds?.includes(id)}
            isSelected={value?.includes(id) ?? false}
            selectedIcon={<MaterialIcon icon='thumb_down' size={48} />}
            onClick={onClick}
            disabled={disabled}
          />
        ))}
      </MapSelections>
      <VetoStatus>
        <Trans t={t} i18nKey='matchmaking.findMatch.vetoesLeft'>
          <VetoStatusLabel>Vetoes left: </VetoStatusLabel>
          <VetoStatusValue $exhausted={vetoesLeft <= 0}>
            {{ vetoesLeft } as TransInterpolation}
          </VetoStatusValue>
        </Trans>
      </VetoStatus>
    </div>
  )
}

/**
 * A component which checks if the map pool can be theoretically exhausted by having all maps in it
 * vetoed and then displays a differently worded message based on that.
 */
export function VetoDescriptionText({
  maxVetoCount,
  mapPoolSize,
  numberOfPlayers,
}: {
  maxVetoCount: number
  mapPoolSize: number
  numberOfPlayers: number
}) {
  const { t } = useTranslation()

  const count = maxVetoCount

  return mapPoolSize > maxVetoCount * numberOfPlayers ? (
    <DescriptionText>
      <Trans t={t} i18nKey='matchmaking.findMatch.vetoDescriptionNoOverlap' count={count}>
        Veto up to {{ count }} maps. Vetoed maps will never be selected for play.
      </Trans>
    </DescriptionText>
  ) : (
    <DescriptionText>
      <Trans t={t} i18nKey='matchmaking.findMatch.vetoDescriptionWithOverlap' count={count}>
        Veto up to {{ count }} maps. Vetoed maps will be chosen significantly less often than other
        maps.
      </Trans>
    </DescriptionText>
  )
}

const ErrorText = styled.div`
  ${titleSmall};
  color: var(--theme-error);
`

/** Control for doing positive map selection (e.g. "I want to play on these specific maps"). */
export function MapSelectionControl({
  onChange,
  value,
  mapPool,
  disabled,
  newMapIds,
  className,
  errorText,
}: MapVetoesControlProps) {
  const onChangeRef = useValueAsRef(onChange)
  const valueRef = useValueAsRef(value)
  const onClick = useCallback(
    (id: SbMapId) => {
      const newValue = [...(valueRef.current ?? [])]
      for (let i = 0; i < newValue.length; i++) {
        if (newValue[i] === id) {
          newValue.splice(i, 1)
          onChangeRef.current(newValue)
          return
        }
      }

      // value wasn't in the list, add it
      newValue.push(id)
      onChangeRef.current(newValue)
    },
    [onChangeRef, valueRef],
  )

  return (
    <div className={className}>
      <MapSelections
        style={{ '--sb-map-thumbnail-selected-color': 'var(--theme-positive)' } as any}>
        {orderMapsFirst(mapPool.maps, newMapIds).map(id => (
          <SelectableMap
            key={id}
            mapId={id}
            isNew={newMapIds?.includes(id)}
            isSelected={value?.includes(id) ?? false}
            selectedIcon={<MaterialIcon icon='thumb_up' size={48} />}
            onClick={onClick}
            disabled={disabled}
          />
        ))}
      </MapSelections>
      {errorText ? <ErrorText>{errorText}</ErrorText> : undefined}
    </div>
  )
}

/** Read-only display of the map(s) a fixed-map mode is always played on. */
export function FixedMapDisplay({
  mapPool,
  newMapIds,
  className,
}: {
  mapPool: Immutable<MatchmakingMapPoolJson>
  /** Maps that are new to the pool. They're marked as such and listed first. */
  newMapIds?: ReadonlyArray<SbMapId>
  className?: string
}) {
  return (
    <MapSelections className={className}>
      {orderMapsFirst(mapPool.maps, newMapIds).map(id => (
        // No `onClick`, so there's no selection/veto behavior here, but the thumbnail's own
        // actions (preview, favorite, map details) should still work, so the container isn't
        // marked as disabled.
        <SelectableMapContainer key={id}>
          <FixedMapThumbnail mapId={id} isNew={newMapIds?.includes(id) ?? false} />
        </SelectableMapContainer>
      ))}
    </MapSelections>
  )
}

function FixedMapThumbnail({ mapId, isNew }: { mapId: SbMapId; isNew: boolean }) {
  const newMapChip = useNewMapChip(isNew)
  return (
    <ReduxMapThumbnail
      mapId={mapId}
      showInfoLayer={true}
      forceAspectRatio={1}
      size={MAP_THUMB_SIZE_PX}
      highlightChip={newMapChip}
    />
  )
}

function useNewMapChip(isNew: boolean | undefined): { label: string; tooltip: string } | undefined {
  const { t } = useTranslation()
  return isNew
    ? {
        label: t('matchmaking.findMatch.newMap', 'New'),
        tooltip: t('matchmaking.findMatch.newMapTooltip', 'Added in the latest map pool update'),
      }
    : undefined
}

const ChangeInfo = styled.div`
  margin: 4px 0 12px;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ChangeSummaryRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  column-gap: 8px;
`

const ChangeSummaryText = styled.span`
  ${titleSmall};
  color: var(--theme-amber);
`

const DroppedSelectionsText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface);
`

const ChangeDetails = styled.dl`
  margin: 4px 0 0;
  padding: 12px 16px;

  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 16px;
  row-gap: 4px;

  border-radius: 8px;
  background: var(--theme-container-low);
`

const ChangeDetailLabel = styled.dt`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ChangeDetailValue = styled.dd`
  ${bodyMedium};
  margin: 0;
  color: var(--theme-on-surface);
`

const mapNameListFormat = listFormat({ style: 'long', type: 'conjunction' })
const poolStartDateFormat = dateTimeFormat({ year: 'numeric', month: 'long', day: 'numeric' })

/**
 * Describes how the map pool changed for the player: a one-line summary, which of their own map
 * selections were dropped, and a collapsed list of the remaining details.
 */
export function MapPoolChangeInfo({
  notice,
  mapPool,
}: {
  notice: ReadonlyDeep<MapPoolChangeNotice>
  mapPool: Immutable<MatchmakingMapPoolJson>
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const listFormatter = useFormat(mapNameListFormat)
  const dateFormatter = useFormat(poolStartDateFormat)
  const mapsById = useAppSelector(s => s.maps.byId)

  const droppedGroups = groupDroppedSelections(notice)
  useEffect(() => {
    for (const mapId of [...notice.removedMaps, ...notice.droppedSelections.map(d => d.mapId)]) {
      dispatch(batchGetMapInfo(mapId))
    }
  }, [dispatch, notice])

  // Names that haven't loaded yet are left out rather than shown as placeholders.
  const nameMaps = (mapIds: ReadonlyArray<SbMapId>): string[] =>
    mapIds.flatMap(id => {
      const name = mapsById.get(id)?.name
      return name ? [name] : []
    })

  const selectionStyle = getMatchmakingModeInfo(mapPool.matchmakingType).mapSelectionStyle
  const droppedTexts =
    selectionStyle === 'fixed'
      ? []
      : droppedGroups.flatMap(({ reason, mapIds }) => {
          const names = nameMaps(mapIds)
          return names.length
            ? [
                getDroppedSelectionsText(
                  reason,
                  selectionStyle,
                  listFormatter.format(names),
                  names.length,
                  t,
                ),
              ]
            : []
        })
  const removedNames = nameMaps(notice.removedMaps)

  return (
    <ChangeInfo>
      <ChangeSummaryRow>
        <ChangeSummaryText>{getMapPoolChangeSummaryText(notice, t)}</ChangeSummaryText>
        <TextButton
          label={t('matchmaking.findMatch.poolChange.details', 'Details')}
          iconEnd={expanded ? 'expand_less' : 'expand_more'}
          ariaExpanded={expanded}
          ariaControls={detailsId}
          onClick={() => setExpanded(!expanded)}
        />
      </ChangeSummaryRow>
      {droppedTexts.length ? (
        <DroppedSelectionsText>{droppedTexts.join(' ')}</DroppedSelectionsText>
      ) : null}
      {expanded ? (
        <ChangeDetails id={detailsId}>
          {removedNames.length ? (
            <>
              <ChangeDetailLabel>
                {t('matchmaking.findMatch.poolChange.removedMaps', 'Removed maps')}
              </ChangeDetailLabel>
              <ChangeDetailValue>{listFormatter.format(removedNames)}</ChangeDetailValue>
            </>
          ) : null}
          {notice.maxVetoCount ? (
            <>
              <ChangeDetailLabel>
                {t('matchmaking.findMatch.poolChange.vetoLimitLabel', 'Veto limit')}
              </ChangeDetailLabel>
              <ChangeDetailValue>
                {notice.maxVetoCount.previous} → {notice.maxVetoCount.current}
              </ChangeDetailValue>
            </>
          ) : null}
          {notice.mapCount ? (
            <>
              <ChangeDetailLabel>
                {t('matchmaking.findMatch.poolChange.poolSizeLabel', 'Maps in the pool')}
              </ChangeDetailLabel>
              <ChangeDetailValue>
                {notice.mapCount.previous} → {notice.mapCount.current}
              </ChangeDetailValue>
            </>
          ) : null}
          <ChangeDetailLabel>
            {t('matchmaking.findMatch.poolChange.startDateLabel', 'In effect since')}
          </ChangeDetailLabel>
          <ChangeDetailValue>{dateFormatter.format(mapPool.startDate)}</ChangeDetailValue>
        </ChangeDetails>
      ) : null}
    </ChangeInfo>
  )
}
