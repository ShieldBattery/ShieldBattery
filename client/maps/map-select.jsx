import React from 'react'
import PropTypes from 'prop-types'
import { List } from 'immutable'
import styled from 'styled-components'

import { MAP_UPLOADING } from '../../app/common/flags'
import ImageList from '../material/image-list.jsx'
import KeyListener from '../keyboard/key-listener.jsx'
import MapThumbnail from './map-thumbnail.jsx'

import SelectedIcon from '../icons/material/baseline-check_circle-24px.svg'
import BrowseIcon from '../icons/material/ic_terrain_black_24px.svg'

import { fastOutSlowIn } from '../material/curve-constants'
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

const BrowseButton = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: ${grey800};
  border-radius: 2px;
  ${props => (props.isFocused ? shadow8dp : shadow2dp)};
  transition: background-color 150ms ${fastOutSlowIn};

  &:hover {
    background-color: rgba(255, 255, 255, 0.12);
    cursor: pointer;
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.16);
    ${shadow8dp};
  }

  ${props =>
    props.isFocused
      ? `
        background-color: rgba(255, 255, 255, 0.16) !important;
      `
      : ''}

  & > svg {
    width: 90px;
    height: 90px;
    opacity: 0.5;
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
    maps: PropTypes.array,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(List)]),
    errorText: PropTypes.string,
    onChange: PropTypes.func,
    canBrowseMaps: PropTypes.bool,
    onMapBrowse: PropTypes.func,
    maxSelections: PropTypes.number,
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
    maps: [],
    maxSelections: -1, // Means user can select as much maps as they want
    thumbnailSize: 'large',
  }

  state = {
    isFocused: false,
    focusedIndex: -1,
  }

  render() {
    const { maps, value, errorText, thumbnailSize, canBrowseMaps } = this.props
    const { isFocused, focusedIndex } = this.state

    const isSelected = m =>
      value && (typeof value === 'string' ? value === m.id : value.includes(m.id))
    const mapElements = maps.map((map, i) => (
      <MapThumbnail
        key={map.id}
        map={map}
        showMapName={true}
        canHover={true}
        isSelected={isSelected(map)}
        isFocused={isFocused && focusedIndex === i}
        selectedIcon={<StyledSelectedIcon />}
        onClick={() => this.onMapSelect(map.id)}
      />
    ))

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
          {MAP_UPLOADING && canBrowseMaps ? (
            <BrowseButton
              onClick={this.onMapBrowse}
              isFocused={isFocused && focusedIndex === maps.length}>
              <BrowseIcon />
              <BrowseText>Browse maps</BrowseText>
            </BrowseButton>
          ) : null}
        </ImageList>
      </Container>
    )
  }

  onMapSelect = map => {
    const { value, maxSelections, onChange } = this.props

    if (!onChange) return

    if (typeof value === 'string') {
      onChange(map)
    } else {
      if (value.includes(map)) return

      const newValue =
        value.size >= maxSelections && maxSelections !== -1
          ? value.pop().unshift(map)
          : value.unshift(map)

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
    const { maps } = this.props
    const { isFocused, focusedIndex } = this.state

    if (!isFocused) return false

    if (event.code === SPACE && focusedIndex > -1 && focusedIndex <= maps.length) {
      if (focusedIndex === maps.length) this.onMapBrowse(event)
      else this.onMapSelect(maps[focusedIndex].id)
      return true
    } else if (event.code === TAB) {
      if (focusedIndex === (event.shiftKey ? 0 : maps.length)) {
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
