import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { rgba } from 'polished'

import IconButton from '../material/icon-button.jsx'
import { Label } from '../material/button.jsx'
import MapImage from './map-image.jsx'
import Menu from '../material/menu/menu.jsx'
import MenuItem from '../material/menu/item.jsx'

import { colorTextPrimary, colorTextSecondary, amberA100, grey800 } from '../styles/colors.ts'
import { Subheading, singleLine } from '../styles/typography.ts'

import FavoritedIcon from '../icons/material/baseline-star-24px.svg'
import ImageIcon from '../icons/material/baseline-image-24px.svg'
import MapActionsIcon from '../icons/material/ic_more_vert_black_24px.svg'
import UnfavoritedIcon from '../icons/material/baseline-star_border-24px.svg'
import ZoomInIcon from '../icons/material/zoom_in-24px.svg'

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 2px;
  overflow: hidden;
`

const StyledMapImage = styled(MapImage)`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const NoImageContainer = styled.div`
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
    opacity: 0.5;
    margin-bottom: 24px;
  }
`

const Overlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: ${props => {
    let opacity = 0
    if (props.isFocused) opacity = 0.12
    if (props.isSelected) opacity = 0.36
    const style = rgba(amberA100, opacity)

    return props.isSelected || props.isFocused ? style + ' !important' : style
  }};
  transition: background-color 150ms linear;

  &:hover {
    background-color: ${rgba(amberA100, 0.12)};
    cursor: pointer;
  }

  & > svg {
    width: 64px;
    height: 64px;
    opacity: 0.5;
  }
`

const MapPreviewIcon = styled(IconButton)`
  position: absolute;
  top: 4px;
  left: 4px;

  & ${Label} {
    color: ${colorTextSecondary};
  }
`

const FavoriteActionIcon = styled(IconButton)`
  position: absolute;
  top: 4px;
  right: 4px;

  & ${Label} {
    color: ${colorTextSecondary};
  }
`

const TextProtection = styled.div`
  position: absolute;
  bottom: 0;
  width: 100%;
  height: 48px;
  padding: 0 4px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: rgba(0, 0, 0, 0.7);
`

const MapName = styled(Subheading)`
  color: ${colorTextPrimary};
  ${singleLine};
`

const MapActionButton = styled(IconButton)`
  flex-shrink: 0;
  min-height: 40px;
  width: 40px;
  padding: 0;
  line-height: 40px;
  margin-left: 4px;

  & ${Label} {
    color: ${colorTextSecondary};
    line-height: 40px;
  }
`

const NoImage = () => (
  <NoImageContainer>
    <ImageIcon />
  </NoImageContainer>
)

export default class MapThumbnail extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
    size: PropTypes.number,
    showMapName: PropTypes.bool,
    isFavoriting: PropTypes.bool,
    isSelected: PropTypes.bool,
    isFocused: PropTypes.bool,
    selectedIcon: PropTypes.element,
    onClick: PropTypes.func,
    onPreview: PropTypes.func,
    onToggleFavorite: PropTypes.func,
    onMapDetails: PropTypes.func,
    onRemove: PropTypes.func,
  }

  state = {
    actionsOverlayOpen: false,
  }

  _actionsButtonRef = React.createRef()

  renderActionsMenu(mapActions) {
    if (mapActions.length < 1) {
      return null
    }

    const actions = mapActions.map(([text, handler], i) => (
      <MenuItem key={i} text={text} onClick={() => this.onMapActionClick(handler)} />
    ))

    return (
      <>
        <MapActionButton
          icon={<MapActionsIcon />}
          title='Map actions'
          buttonRef={this._actionsButtonRef}
          onClick={this.onActionsOverlayOpen}
        />
        <Menu
          open={this.state.actionsOverlayOpen}
          onDismiss={this.onActionsOverlayClose}
          anchor={this._actionsButtonRef.current}
          anchorOriginVertical='top'
          anchorOriginHorizontal='right'
          popoverOriginVertical='top'
          popoverOriginHorizontal='right'>
          {actions}
        </Menu>
      </>
    )
  }

  render() {
    const {
      map,
      size,
      showMapName,
      isFavoriting,
      isSelected,
      selectedIcon,
      isFocused,
      onClick,
      onPreview,
      onToggleFavorite,
      onMapDetails,
      onRemove,
    } = this.props

    const mapActions = []
    if (onMapDetails) {
      mapActions.push(['View map details', onMapDetails])
    }
    if (onRemove) {
      mapActions.push(['Remove', onRemove])
    }

    return (
      <Container className={this.props.className}>
        <StyledMapImage map={map} size={size} noImageElem={<NoImage />} />
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
            {this.renderActionsMenu(mapActions)}
          </TextProtection>
        ) : null}
      </Container>
    )
  }

  onActionsOverlayOpen = () => {
    this.setState({ actionsOverlayOpen: true })
  }

  onActionsOverlayClose = () => {
    this.setState({ actionsOverlayOpen: false })
  }

  onMapActionClick = handler => {
    handler()
    this.onActionsOverlayClose()
  }
}
