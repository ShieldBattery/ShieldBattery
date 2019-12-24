import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import MapActions, { MapActionButton } from './map-actions.jsx'

import { fastOutSlowIn } from '../material/curve-constants'
import { colorTextSecondary, grey800 } from '../styles/colors'
import { Subheading, singleLine } from '../styles/typography'

import ImageIcon from '../icons/material/baseline-image-24px.svg'
import FavoritedIcon from '../icons/material/baseline-star-24px.svg'
import UnfavoritedIcon from '../icons/material/baseline-star_border-24px.svg'
import ZoomInIcon from '../icons/material/zoom_in-24px.svg'

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 2px;
  overflow: hidden;
`

const MapImage = styled.img`
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const NoImage = styled.div`
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: ${grey800};

  & > svg {
    width: 90px;
    height: 90px;
    margin-bottom: 48px;
    opacity: 0.5;
  }
`

const Overlay = styled.div`
  position: absolute;
  width: 100%;
  height: ${props => (props.showMapName ? 'calc(100% - 48px)' : '100%')};
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: ${props => {
    let opacity = 0
    if (props.isFocused) opacity = '0.12'
    if (props.isSelected) opacity = '0.36'
    const style = `rgba(255, 229, 127, ${opacity})` /* amberA100 */

    return props.isSelected || props.isFocused ? style + ' !important' : style
  }};
  transition: background-color 150ms ${fastOutSlowIn};

  &:hover {
    background-color: rgba(255, 229, 127, 0.12); /* amberA100 */
    cursor: pointer;
  }

  & > svg {
    width: 64px;
    height: 64px;
    opacity: 0.5;
  }
`

const MapPreviewIcon = styled(MapActionButton)`
  position: absolute;
  top: 8px;
  left: 8px;
`

const FavoriteActionIcon = styled(MapActionButton)`
  position: absolute;
  top: 8px;
  right: 8px;
  pointer-events: ${props => (props.isFavoriting ? 'none' : 'auto')};
`

const TextProtection = styled.div`
  position: absolute;
  bottom: 0;
  width: 100%;
  height: 48px;
  padding: 0 12px 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: rgba(0, 0, 0, 0.6);
`

const MapName = styled(Subheading)`
  color: ${colorTextSecondary};
  ${singleLine};
`

export default class MapThumbnail extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
    showMapName: PropTypes.bool,
    isFavoriting: PropTypes.bool,
    isSelected: PropTypes.bool,
    isFocused: PropTypes.bool,
    selectedIcon: PropTypes.element,
    onClick: PropTypes.func,
    onMapPreview: PropTypes.func,
    onToggleFavorite: PropTypes.func,
    onRemove: PropTypes.func,
  }

  render() {
    const {
      map,
      showMapName,
      isFavoriting,
      isSelected,
      selectedIcon,
      isFocused,
      onClick,
      onPreview,
      onToggleFavorite,
      onRemove,
    } = this.props

    const mapActions = []
    if (onRemove) {
      mapActions.push(['Remove', onRemove])
    }

    return (
      <Container>
        {map.imageUrl ? (
          <picture>
            <MapImage src={map.imageUrl} alt={map.name} draggable={false} />
          </picture>
        ) : (
          <NoImage>
            <ImageIcon />
          </NoImage>
        )}
        {onClick ? (
          <Overlay
            isSelected={isSelected}
            isFocused={isFocused}
            showMapName={showMapName}
            onClick={onClick}>
            {isSelected && selectedIcon ? selectedIcon : null}
          </Overlay>
        ) : null}
        {onPreview ? (
          <MapPreviewIcon icon={<ZoomInIcon />} title={'Show map preview'} onClick={onPreview} />
        ) : null}
        {onToggleFavorite ? (
          <FavoriteActionIcon
            disabled={isFavoriting}
            icon={map.isFavorited ? <FavoritedIcon /> : <UnfavoritedIcon />}
            title={map.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            onClick={onToggleFavorite}
          />
        ) : null}
        {showMapName ? (
          <TextProtection>
            <MapName title={map.name}>{map.name}</MapName>
            {mapActions.length > 0 ? <MapActions mapActions={mapActions} /> : null}
          </TextProtection>
        ) : null}
      </Container>
    )
  }
}
