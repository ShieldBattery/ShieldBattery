import React from 'react'
import PropTypes from 'prop-types'
import { List } from 'immutable'
import styled from 'styled-components'

import { MAP_UPLOADING } from '../../app/common/flags'
import MapThumbnail from '../maps/map-thumbnail.jsx'

import SelectedIcon from '../icons/material/baseline-check_circle-24px.svg'
import BrowseIcon from '../icons/material/ic_terrain_black_24px.svg'

import { fastOutSlowIn } from '../material/curve-constants'
import { shadow2dp, shadow8dp } from '../material/shadows'
import { grey800, colorTextSecondary } from '../styles/colors'
import { Subheading } from '../styles/typography'

// TODO(2Pac): Make this into a general image list component and move it to material folder
export const ImageList = styled.div`
  display: grid;
  grid-template-columns: ${props => `repeat(${props.columnCount}, 1fr)`};
  grid-auto-rows: 1fr;
  grid-gap: ${props => `${props.padding}px`};

  // A trick to keep grid items at 1:1 aspect ratio while having variable widths
  &::before {
    content: '';
    width: 0;
    padding-bottom: 100%;
    grid-row: 1 / 1;
    grid-column: 1 / 1;
  }

  & > *:first-child {
    grid-row: 1 / 1;
    grid-column: 1 / 1;
  }
`

const BrowseButton = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: ${grey800};
  border-radius: 2px;
  ${shadow2dp};
  transition: background-color 150ms ${fastOutSlowIn};

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
    cursor: pointer;
  }

  &:active {
    ${shadow8dp};
  }

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

  render() {
    const { maps, value, thumbnailSize, canBrowseMaps } = this.props

    const isSelected = m =>
      value && (typeof value === 'string' ? value === m.hash : value.includes(m.hash))
    const mapElements = maps.map(map => (
      <MapThumbnail
        key={map.hash}
        map={map}
        showMapName={true}
        isSelected={isSelected(map)}
        selectedIcon={<SelectedIcon />}
        onClick={() => this.onMapSelect(map.hash)}
      />
    ))

    return (
      <ImageList
        columnCount={THUMBNAIL_SIZES[thumbnailSize].columnCount}
        padding={THUMBNAIL_SIZES[thumbnailSize].padding}>
        {mapElements}
        {MAP_UPLOADING && canBrowseMaps ? (
          <BrowseButton onClick={this.onMapBrowse}>
            <BrowseIcon />
            <BrowseText>Browse maps</BrowseText>
          </BrowseButton>
        ) : null}
      </ImageList>
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
}
