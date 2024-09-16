import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { useKeyListener } from '../keyboard/key-listener.js'
import ImageList from '../material/image-list.js'
import { shadow2dp, shadow8dp } from '../material/shadows.js'
import { useStableCallback } from '../state-hooks.js'
import { background400, colorError, colorTextFaint, colorTextSecondary } from '../styles/colors.js'
import { styledWithAttrs } from '../styles/styled-with-attrs.js'
import { subtitle1 } from '../styles/typography.js'
import { ConnectedMapThumbnail } from './map-thumbnail.js'

const SPACE = 'Space'
const TAB = 'Tab'

const Container = styled.div`
  &:focus {
    outline: none;
  }
`

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
`

const StyledSelectedIcon = styledWithAttrs(MaterialIcon)({ icon: 'check_circle', size: 64 })`
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
  background-color: ${background400};
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

const BrowseIcon = styledWithAttrs(MaterialIcon)({ icon: 'map', size: 96 })`
  color: ${colorTextFaint};
`

const BrowseText = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
`

export interface MapSelectProps {
  /** A list of potential map IDs available in the quick select (available without browsing). */
  quickMaps: ReadonlyArray<string>
  value?: string | null
  disabled?: boolean
  errorText?: string
  onChange: (selectedId: string) => void
  onMapBrowse: (event: KeyboardEvent | React.MouseEvent) => void
}

export function MapSelect({
  quickMaps,
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
    if (!disabled && id !== value) {
      onChange(id)
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

      if (event.code === SPACE && focusedIndex > -1 && focusedIndex <= quickMaps.length) {
        if (focusedIndex === quickMaps.length) {
          onMapBrowse(event)
        } else {
          onMapSelect(quickMaps[focusedIndex])
        }
        return true
      } else if (event.code === TAB) {
        if (focusedIndex === (event.shiftKey ? 0 : quickMaps.length)) {
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

  // TODO(tec27): After moving to normal tabindex usage, change BrowseButton to an actual button
  // and use the standard ripple stuff instead of all its custom hover/focus states (and disable it
  // when this component is disabled)
  return (
    <Container tabIndex={0} onMouseDown={onMouseDown} onFocus={onFocus} onBlur={onBlur}>
      {errorText ? <ErrorText>{errorText}</ErrorText> : undefined}
      <ImageList $columnCount={3} $padding={4}>
        {quickMaps.map((id, i) => (
          <ConnectedMapThumbnail
            key={id}
            map={id}
            forceAspectRatio={1}
            size={256}
            showMapName={true}
            isSelected={id === value}
            isFocused={isFocused && focusedIndex === i}
            selectedIcon={<StyledSelectedIcon />}
            onClick={() => onMapSelect(id)}
          />
        ))}
        <BrowseButton
          onClick={disabled ? undefined : onMapBrowse}
          $isFocused={isFocused && focusedIndex === quickMaps.length}>
          <BrowseIcon />
          <BrowseText>{t('maps.mapSelect.browseMaps', 'Browse maps')}</BrowseText>
        </BrowseButton>
      </ImageList>
    </Container>
  )
}
