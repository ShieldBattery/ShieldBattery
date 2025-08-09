import { Immutable } from 'immer'
import * as React from 'react'
import { useCallback, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MapInfoJson, SbMapId } from '../../common/maps'
import { MatchmakingPreferences } from '../../common/matchmaking'
import { MatchmakingMapPoolJson } from '../../common/matchmaking/matchmaking-map-pools'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { batchGetMapInfo } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { elevationPlus1 } from '../material/shadows'
import { useValueAsRef } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, bodyMedium, titleSmall } from '../styles/typography'
import { RaceSelect } from './race-select'

export interface FindMatchFormRef {
  submit: () => void
}

export interface FindMatchContentsProps {
  disabled: boolean
  mapSelections?: Array<Immutable<MapInfoJson>>
  formRef: React.Ref<FindMatchFormRef>
  onSubmit: (prefs: Immutable<MatchmakingPreferences>) => void
}

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

export const OutdatedIndicator = styled.span`
  ${titleSmall};
  margin-left: 16px;
  padding: 0 4px;
  color: var(--theme-amber);
  text-transform: uppercase;
  border: 1px solid var(--theme-amber);
  border-radius: 4px;
`

export const MAP_THUMB_SIZE_PX = 164

export const MapSelections = styled.div`
  margin: 16px 0;

  display: grid;
  gap: 12px 12px;
  grid-auto-flow: row;
  grid-auto-rows: min-content;
  grid-template-columns: repeat(auto-fill, ${MAP_THUMB_SIZE_PX}px);
`

export const SelectableMap = styled.div<{ $selected?: boolean; $disabled?: boolean }>`
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

const VetoStatus = styled.div`
  ${titleSmall};
  margin-top: 24px;
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
}

function ConnectedSelectableMap({
  mapId,
  isSelected: isVetoed,
  onClick,
  disabled,
  selectedIcon,
}: ConnectedSelectableMapProps) {
  const dispatch = useAppDispatch()
  const map = useAppSelector(s => s.maps.byId.get(mapId))
  const handleClick = useCallback(() => {
    if (!disabled) {
      onClick(mapId)
    }
  }, [mapId, onClick, disabled])

  useEffect(() => {
    dispatch(batchGetMapInfo(mapId))
  }, [dispatch, mapId])

  // TODO(tec27): allow these to be keyboard focused and vetoed via keypress

  return (
    <SelectableMap $selected={isVetoed} $disabled={disabled}>
      {map ? (
        <MapThumbnail
          map={map}
          showMapName={true}
          forceAspectRatio={1}
          size={MAP_THUMB_SIZE_PX}
          isSelected={isVetoed}
          onClick={handleClick}
          selectedIcon={selectedIcon}
        />
      ) : null}
    </SelectableMap>
  )
}

export interface MapVetoesControlProps {
  onChange: (vetoedMaps: SbMapId[]) => void
  value: SbMapId[] | null
  mapPool: Immutable<MatchmakingMapPoolJson>
  disabled: boolean
  className?: string
  errorText?: string
}

export function MapVetoesControl({
  onChange,
  value,
  mapPool,
  disabled,
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
        {mapPool?.maps.map(id => (
          <ConnectedSelectableMap
            key={id}
            mapId={id}
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
        {mapPool?.maps.map(id => (
          <ConnectedSelectableMap
            key={id}
            mapId={id}
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
