import { Immutable } from 'immer'
import React, { useCallback, useEffect } from 'react'
import styled from 'styled-components'
import { MapInfoJson } from '../../common/maps'
import { MatchmakingMapPool, MatchmakingPreferences } from '../../common/matchmaking'
import ThumbDownIcon from '../icons/material/thumb-down-48px.svg'
import { batchGetMapInfo } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { shadow4dp } from '../material/shadows'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useValueAsRef } from '../state-hooks'
import {
  amberA400,
  colorDividers,
  colorNegative,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { body1, body2, subtitle1 } from '../styles/typography'
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
  ${subtitle1};
  margin: 8px 0 4px;
`

export const StyledRaceSelect = styled(RaceSelect)`
  margin: 12px 0;
`

export const DescriptionText = styled.span`
  ${body1};
  color: ${colorTextSecondary};
`

export const MapSelectionsHeader = styled.div`
  margin: 40px 0 0px;

  display: flex;
  align-items: center;
`

export const OutdatedIndicator = styled.span`
  ${body2};
  margin-left: 16px;
  padding: 0 4px;
  color: ${amberA400};
  text-transform: uppercase;
  border: 1px solid ${amberA400};
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

export const SelectableMap = styled.div<{ $vetoed?: boolean; $disabled?: boolean }>`
  ${shadow4dp};

  --sb-selectable-map-border: ${props => (props.$vetoed ? colorNegative : colorDividers)};
  --sb-map-thumbnail-selected-color: ${colorNegative};
  --sb-map-thumbnail-selected-icon-size: 48px;

  width: ${MAP_THUMB_SIZE_PX}px;
  height: ${MAP_THUMB_SIZE_PX}px;
  position: relative;
  border-radius: 2px;
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
    border-radius: 2px;
  }
`

const VetoStatus = styled.div`
  ${body2};
  margin-top: 24px;
`

const VetoStatusLabel = styled.span`
  color: ${colorTextSecondary};
`

const VetoStatusValue = styled.span<{ $exhausted: boolean }>`
  color: ${props => (props.$exhausted ? colorTextFaint : colorTextPrimary)};
`

interface ConnectedSelectableMapProps {
  mapId: string
  isVetoed: boolean
  onClick: (mapId: string) => void
  disabled?: boolean
}

function ConnectedSelectableMap({
  mapId,
  isVetoed,
  onClick,
  disabled,
}: ConnectedSelectableMapProps) {
  const dispatch = useAppDispatch()
  const map = useAppSelector(s => s.maps2.byId.get(mapId))
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
    <SelectableMap $vetoed={isVetoed} $disabled={disabled}>
      {map ? (
        <MapThumbnail
          map={map}
          showMapName={true}
          size={MAP_THUMB_SIZE_PX}
          isSelected={isVetoed}
          onClick={handleClick}
          selectedIcon={<ThumbDownIcon />}
        />
      ) : null}
    </SelectableMap>
  )
}

export interface MapVetoesControlProps {
  onChange: (vetoedMaps: string[]) => void
  value: string[] | null
  mapPool?: Immutable<MatchmakingMapPool>
  maxVetoes: number
  disabled: boolean
  className?: string
}

export function MapVetoesControl({
  onChange,
  value,
  mapPool,
  maxVetoes,
  disabled,
  className,
}: MapVetoesControlProps) {
  const onChangeRef = useValueAsRef(onChange)
  const valueRef = useValueAsRef(value)
  const onClick = useCallback(
    (id: string) => {
      const newValue = [...(valueRef.current ?? [])]
      for (let i = 0; i < newValue.length; i++) {
        if (newValue[i] === id) {
          newValue.splice(i, 1)
          onChangeRef.current(newValue)
          return
        }
      }

      // value wasn't in the list, add it if there's space
      if (newValue.length < maxVetoes) {
        newValue.push(id)
        onChangeRef.current(newValue)
      }
    },
    [maxVetoes, onChangeRef, valueRef],
  )

  const vetoesLeft = maxVetoes - (value?.length ?? 0)
  return (
    <div className={className}>
      <MapSelections>
        {mapPool?.maps.map(id => (
          <ConnectedSelectableMap
            key={id}
            mapId={id}
            isVetoed={value?.includes(id) ?? false}
            onClick={onClick}
            disabled={disabled}
          />
        ))}
      </MapSelections>
      <VetoStatus>
        <VetoStatusLabel>Vetoes left: </VetoStatusLabel>
        <VetoStatusValue $exhausted={vetoesLeft <= 0}>{vetoesLeft}</VetoStatusValue>
      </VetoStatus>
    </div>
  )
}
