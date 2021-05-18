import { rgba } from 'polished'
import PropTypes from 'prop-types'
import React, { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'
import { MapInfo } from '../../common/maps'
import ImageIcon from '../icons/material/baseline-image-24px.svg'
import FavoritedIcon from '../icons/material/baseline-star-24px.svg'
import UnfavoritedIcon from '../icons/material/baseline-star_border-24px.svg'
import MapActionsIcon from '../icons/material/ic_more_vert_black_24px.svg'
import ZoomInIcon from '../icons/material/zoom_in-24px.svg'
import { IconButton } from '../material/button'
import MenuItem from '../material/menu/item'
import Menu from '../material/menu/menu'
import { useAnchorPosition } from '../material/popover'
import { amberA100, colorTextPrimary, grey800 } from '../styles/colors'
import { singleLine, subtitle2 } from '../styles/typography'
import MapImage from './map-image'

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 2px;
  overflow: hidden;
  contain: strict;
`

const StyledMapImage = styled(MapImage)`
  padding-bottom: 100%; // Force 1:1 aspect ratio
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

const Overlay = styled.div<{ $isSelected?: boolean; $isFocused?: boolean }>`
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
    if (props.$isFocused) opacity = 0.12
    if (props.$isSelected) opacity = 0.36
    const style = rgba(amberA100, opacity)

    return props.$isSelected || props.$isFocused ? style + ' !important' : style
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
`

const FavoriteActionIcon = styled(IconButton)`
  position: absolute;
  top: 4px;
  right: 4px;
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

const MapName = styled.div`
  ${subtitle2};
  ${singleLine};
  color: ${colorTextPrimary};
`

const MapActionButton = styled(IconButton)`
  flex-shrink: 0;
  min-height: 40px;
  width: 40px;
  padding: 0;
  line-height: 40px;
  margin-left: 4px;
`

const NoImage = () => (
  <NoImageContainer>
    <ImageIcon />
  </NoImageContainer>
)

export interface MapThumbnailProps {
  map: Readonly<MapInfo>
  className?: string
  size?: number
  showMapName?: boolean
  isFavoriting?: boolean
  isSelected?: boolean
  isFocused?: boolean
  selectedIcon?: React.ReactNode
  onClick?: (event: React.MouseEvent) => void
  onPreview?: () => void
  onToggleFavorite?: () => void
  onMapDetails?: () => void
  onRemove?: () => void
  onRegenMapImage?: () => void
}

export function MapThumbnail({
  map,
  className,
  size,
  showMapName,
  isFavoriting,
  isSelected,
  isFocused,
  selectedIcon,
  onClick,
  onPreview,
  onToggleFavorite,
  onMapDetails,
  onRemove,
  onRegenMapImage,
}: MapThumbnailProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [anchorRef, anchorX, anchorY] = useAnchorPosition('right', 'top')

  const onOpenMenu = useCallback(() => {
    setMenuOpen(true)
  }, [])
  const onCloseMenu = useCallback(() => {
    setMenuOpen(false)
  }, [])
  const onActionClick = useCallback(
    (handler: () => void) => {
      handler()
      onCloseMenu()
    },
    [onCloseMenu],
  )

  const actions = useMemo(() => {
    const mapActions: Array<[text: string, handler: () => void]> = []
    if (onMapDetails) {
      mapActions.push(['View map details', onMapDetails])
    }
    if (onRegenMapImage) {
      mapActions.push(['Regenerate image', onRegenMapImage])
    }
    if (onRemove) {
      mapActions.push(['Remove', onRemove])
    }

    return mapActions.map(([text, handler], i) => (
      <MenuItem key={i} text={text} onClick={() => onActionClick(handler)} />
    ))
  }, [onMapDetails, onRegenMapImage, onRemove, onActionClick])

  return (
    <Container className={className}>
      <StyledMapImage map={map} size={size} noImageElem={<NoImage />} />
      {onClick ? (
        <Overlay $isSelected={isSelected} $isFocused={isFocused} onClick={onClick}>
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
          {actions.length ? (
            <>
              <MapActionButton
                ref={anchorRef}
                icon={<MapActionsIcon />}
                title='Map actions'
                onClick={onOpenMenu}
              />
              <Menu
                open={menuOpen}
                onDismiss={onCloseMenu}
                anchorX={anchorX ?? 0}
                anchorY={anchorY ?? 0}
                originX='right'
                originY='top'>
                {actions}
              </Menu>
            </>
          ) : null}
        </TextProtection>
      ) : null}
    </Container>
  )
}

MapThumbnail.propTypes = {
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
  onRegenMapImage: PropTypes.func,
}
