import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import ImageList from '../material/image-list'
import { shadow2dp, shadow8dp } from '../material/shadows'
import { useStableCallback } from '../state-hooks'
import { bodyLarge, labelLarge } from '../styles/typography'
import { ConnectedMapThumbnail } from './map-thumbnail'

const SPACE = 'Space'
const TAB = 'Tab'

const Container = styled.div`
  &:focus {
    outline: none;
  }
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const StyledSelectedIcon = styled(MaterialIcon).attrs({ icon: 'check_circle', size: 64 })`
  text-shadow: 0 0 8px #000;
`

export const BrowseButton = styled.div<{ $isFocused?: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: var(--theme-container-low);
  border-radius: 2px;
  ${props => (props.$isFocused ? shadow8dp : shadow2dp)};

  &:after {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    content: '';

    background-color: white;
    opacity: ${props => (props.$isFocused ? '0.16 !important' : '0')};
    transition: opacity 150ms linear;
  }

  &:hover:after {
    opacity: 0.08;
    cursor: pointer;
  }

  &:active:after {
    opacity: 0.12;
    ${shadow8dp};
  }
`

const BrowseIcon = styled(MaterialIcon).attrs({ icon: 'map', size: 96 })`
  color: var(--theme-on-surface-variant);
`

const BrowseText = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
  margin-top: 8px;
  margin-bottom: 8px;
`

export interface MapSelectionValue {
  /** The currently selected map (if any). */
  mapId?: string | null
  /** A list of map IDs that have been selected recently, for easy choosing without browsing. */
  recentMaps?: string[]
}

export interface MapSelectProps {
  value?: MapSelectionValue | null
  disabled?: boolean
  errorText?: string
  onChange: (newValue: MapSelectionValue) => void
  onMapBrowse: (event: KeyboardEvent | React.MouseEvent) => void
  numRecentMaps: number
}

export function MapSelect({
  value,
  disabled = false,
  errorText,
  onChange,
  onMapBrowse,
}: MapSelectProps) {
  const { t } = useTranslation()
  const [isFocused, setIsFocused] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const onMapSelect = useStableCallback((id: string) => {
    if (!disabled && id !== value?.mapId) {
      onChange({
        mapId: id,
        // NOTE(tec27): We don't need to update this, as we can only select things that are already
        // in the recent maps list and we don't want to move those around while the user is making
        // a selection. If the selection is confirmed (e.g. the lobby is created with this map),
        // we'll move it to the front of the list at that point.
        recentMaps: value?.recentMaps,
      })
    }
  })
  const onMouseDown = useStableCallback((event: React.MouseEvent) => {
    // Only allow component to be focused with the keyboard; prevent focusing it on a mouse click
    event.preventDefault()
    setIsFocused(false)
    setFocusedIndex(-1)
  })

  useKeyListener({
    onKeyDown: event => {
      if (!isFocused || disabled) {
        return false
      }

      const recentMapsLength = value?.recentMaps?.length ?? 0
      if (event.code === SPACE && focusedIndex > -1 && focusedIndex <= recentMapsLength) {
        if (focusedIndex === recentMapsLength) {
          onMapBrowse(event)
        } else {
          onMapSelect(value!.recentMaps![focusedIndex])
        }
        return true
      } else if (event.code === TAB) {
        if (focusedIndex === (event.shiftKey ? 0 : recentMapsLength)) {
          setIsFocused(false)
          setFocusedIndex(-1)
          return true
        }

        const delta = event.shiftKey ? -1 : 1
        setFocusedIndex(focusedIndex + delta)
        return true
      }

      return false
    },
  })

  // TODO(tec27): It would probably be simpler to just set tabIndex=0 on all the maps + browse
  // button and use the browser's built-in focus traversal here, I think that's all this is really
  // emulating anyway
  const onFocus = useStableCallback(() => {
    if (!disabled) {
      setIsFocused(true)
      setFocusedIndex(0)
    }
  })

  const onBlur = useStableCallback(() => {
    setIsFocused(false)
    setFocusedIndex(-1)
  })

  const recentMaps = value?.recentMaps ?? []

  // TODO(tec27): After moving to normal tabindex usage, change BrowseButton to an actual button
  // and use the standard ripple stuff instead of all its custom hover/focus states (and disable it
  // when this component is disabled)
  return (
    <Container tabIndex={0} onMouseDown={onMouseDown} onFocus={onFocus} onBlur={onBlur}>
      {errorText ? <ErrorText>{errorText}</ErrorText> : undefined}
      <ImageList $columnCount={3} $padding={4}>
        {recentMaps.map((id, i) => (
          <ConnectedMapThumbnail
            key={id}
            map={id}
            forceAspectRatio={1}
            size={256}
            showMapName={true}
            isSelected={id === value?.mapId}
            isFocused={isFocused && focusedIndex === i}
            selectedIcon={<StyledSelectedIcon />}
            onClick={() => onMapSelect(id)}
          />
        ))}
        <BrowseButton
          onClick={disabled ? undefined : onMapBrowse}
          $isFocused={isFocused && focusedIndex === recentMaps.length}>
          <BrowseIcon />
          <BrowseText>{t('maps.mapSelect.browseMaps', 'Browse maps')}</BrowseText>
        </BrowseButton>
      </ImageList>
    </Container>
  )
}
