import React from 'react'
import PropTypes from 'prop-types'
import { Map, List, Set } from 'immutable'
import styled from 'styled-components'

import ImageList from '../material/image-list.jsx'
import KeyListener from '../keyboard/key-listener.jsx'
import MapThumbnail from './map-thumbnail.jsx'

import SelectedIcon from '../icons/material/baseline-check_circle-24px.svg'
import BrowseIcon from '../icons/material/ic_terrain_black_24px.svg'

import { shadow2dp, shadow8dp } from '../material/shadows'
import { grey800, colorError, colorTextSecondary } from '../styles/colors'
import { Subheading } from '../styles/typography'

const SPACE = 'Space'
const TAB = 'Tab'

const Container = styled.div`
  &:focus {
    outline: none;
  }
`

const ErrorText = styled(Subheading)`
  color: ${colorError};
`

const StyledSelectedIcon = styled(SelectedIcon)`
  path:last-child {
    stroke: #000;
  }
`

export const BrowseButton = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: ${grey800};
  border-radius: 2px;
  ${props => (props.isFocused ? shadow8dp : shadow2dp)};

  &:after {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    content: '';

    background-color: white;
    opacity: ${props => (props.isFocused ? '0.16 !important' : '0')};
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

  & > svg {
    width: 96px;
    height: 96px;
    opacity: 0.6;
  }
`

const BrowseText = styled(Subheading)`
  color: ${colorTextSecondary};
`

const THUMBNAIL_SIZES = {
  xsmall: { columnCount: 6, padding: 4 },
  small: { columnCount: 5, padding: 4 },
  medium: { columnCount: 4, padding: 4 },
  large: { columnCount: 3, padding: 4 },
  xlarge: { columnCount: 2, padding: 32 },
}

// This component should only be used inside forms; If you just need a way to display a list of
// maps, without selection/form support, use the ImageList component directly.
export default class MapSelect extends React.Component {
  static propTypes = {
    list: PropTypes.instanceOf(List),
    byId: PropTypes.instanceOf(Map),
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(List)]),
    maxSelections: PropTypes.number,
    selectedIcon: PropTypes.element,
    canBrowseMaps: PropTypes.bool,
    allowUnselect: PropTypes.bool,
    errorText: PropTypes.string,
    favoriteStatusRequests: PropTypes.instanceOf(Set),
    onChange: PropTypes.func,
    onMapBrowse: PropTypes.func,
    onMapPreview: PropTypes.func,
    onToggleFavoriteMap: PropTypes.func,
    thumbnailSize: props => {
      if (typeof props.thumbnailSize !== 'string') {
        return new Error('`thumbnailSize` must be a string.')
      }
      const thumbnailSizes = Object.keys(THUMBNAIL_SIZES)
      if (!thumbnailSizes.includes(props.thumbnailSize)) {
        return new Error(
          `\`thumbnailSize\` must be of one of the following values: ${thumbnailSizes.join(', ')}.`,
        )
      }
      return null
    },
  }

  static defaultProps = {
    maxSelections: -1, // Means user can select as many maps as they want
    thumbnailSize: 'large',
    favoriteStatusRequests: new Set(),
  }

  state = {
    isFocused: false,
    focusedIndex: -1,
  }

  render() {
    const {
      list,
      byId,
      value,
      errorText,
      thumbnailSize,
      canBrowseMaps,
      favoriteStatusRequests,
      selectedIcon,
      onMapPreview,
      onToggleFavoriteMap,
    } = this.props
    const { isFocused, focusedIndex } = this.state

    const isSelected = m => (typeof value === 'string' ? value === m.id : value.includes(m.id))
    const mapElements = list.map((id, i) => {
      const map = byId.get(id)
      return (
        <MapThumbnail
          key={id}
          map={map}
          showMapName={true}
          canHover={true}
          isSelected={isSelected(map)}
          isFocused={isFocused && focusedIndex === i}
          isFavoriting={favoriteStatusRequests.has(map.id)}
          selectedIcon={selectedIcon || <StyledSelectedIcon />}
          onClick={() => this.onMapSelect(map.id)}
          onPreview={onMapPreview ? () => onMapPreview(map) : undefined}
          onToggleFavorite={onToggleFavoriteMap ? () => onToggleFavoriteMap(map) : undefined}
        />
      )
    })

    return (
      <Container
        tabIndex={0}
        onMouseDown={this.onMouseDown}
        onFocus={this.onFocus}
        onBlur={this.onBlur}>
        <KeyListener onKeyDown={this.onKeyDown} />
        {errorText ? <ErrorText>{errorText}</ErrorText> : null}
        <ImageList
          columnCount={THUMBNAIL_SIZES[thumbnailSize].columnCount}
          padding={THUMBNAIL_SIZES[thumbnailSize].padding}>
          {mapElements}
          {canBrowseMaps ? (
            <BrowseButton
              onClick={this.onMapBrowse}
              isFocused={isFocused && focusedIndex === list.length}>
              <BrowseIcon />
              <BrowseText>Browse maps</BrowseText>
            </BrowseButton>
          ) : null}
        </ImageList>
      </Container>
    )
  }

  onMapSelect = mapId => {
    const { value, maxSelections, allowUnselect, onChange } = this.props

    if (!onChange) return

    if (typeof value === 'string') {
      if (allowUnselect && value === mapId) {
        onChange('')
      } else {
        onChange(mapId)
      }
    } else {
      if (value.includes(mapId)) {
        if (allowUnselect) {
          const mapIndex = value.findIndex(m => m === mapId)
          onChange(value.delete(mapIndex))
        }

        return
      }

      const newValue =
        value.size >= maxSelections && maxSelections !== -1
          ? value.shift().push(mapId)
          : value.push(mapId)

      onChange(newValue)
    }
  }

  onMapBrowse = event => {
    if (this.props.onMapBrowse) {
      this.props.onMapBrowse(event)
    }
  }

  onMouseDown = event => {
    // Only allow component to be focused with the keyboard; prevent focusing it on a mouse click
    event.preventDefault()
    this.setState({ isFocused: false, focusedIndex: -1 })
  }

  onFocus = () => {
    this.setState({ isFocused: true, focusedIndex: 0 })
  }

  onBlur = () => {
    this.setState({ isFocused: false, focusedIndex: -1 })
  }

  onKeyDown = event => {
    const { list } = this.props
    const { isFocused, focusedIndex } = this.state

    if (!isFocused) return false

    if (event.code === SPACE && focusedIndex > -1 && focusedIndex <= list.size) {
      if (focusedIndex === list.size) this.onMapBrowse(event)
      else this.onMapSelect(list.get(focusedIndex))
      return true
    } else if (event.code === TAB) {
      if (focusedIndex === (event.shiftKey ? 0 : list.size)) {
        this.setState({ isFocused: false, focusedIndex: -1 })
        return false
      }
      const delta = event.shiftKey ? -1 : 1
      this.setState({ focusedIndex: focusedIndex + delta })
      return true
    }

    return false
  }
}
