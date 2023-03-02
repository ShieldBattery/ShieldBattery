import { Immutable } from 'immer'
import { rgba } from 'polished'
import React, { useCallback, useMemo } from 'react'
import styled from 'styled-components'
import { MapInfoJson } from '../../common/maps'
import ImageIcon from '../icons/material/image-24px.svg'
import MapActionsIcon from '../icons/material/more_vert-24px.svg'
import FavoritedIcon from '../icons/material/star-24px.svg'
import UnfavoritedIcon from '../icons/material/star_border-24px.svg'
import ZoomInIcon from '../icons/material/zoom_in-24px.svg'
import { IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import { amberA100, background700, background900, colorTextPrimary } from '../styles/colors'
import { singleLine, subtitle2 } from '../styles/typography'
import MapImage from './map-image'

const Container = styled.div`
  position: relative;
  width: 100%;
  height: auto;
  border-radius: 2px;
  contain: content;
`

const NoImageContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: ${background700};

  & > svg {
    width: 96px;
    height: 96px;
    opacity: 0.5;
    margin-bottom: 24px;
  }
`

const TEXT_PROTECTION_HEIGHT_PX = 48

const Overlay = styled.div<{
  $isSelected?: boolean
  $isFocused?: boolean
  $textProtection?: boolean
}>`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;

  & > svg {
    width: var(--sb-map-thumbnail-selected-icon-size, 64px);
    height: var(--sb-map-thumbnail-selected-icon-size, 64px);
    margin-bottom: ${props =>
      props.$textProtection ? Math.floor(TEXT_PROTECTION_HEIGHT_PX / 2) : 0}px;
    opacity: ${props => (props.$isSelected ? 0.5 : 0)};

    transition: opacity 100ms linear;
  }

  &:hover {
    cursor: pointer;

    & > svg {
      opacity: 0.25;
    }
  }

  &::before {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    content: '';
    pointer-events: none;

    background-color: var(--sb-map-thumbnail-selected-color, ${amberA100});
    opacity: ${props => {
      // TODO(tec27): These seem backwards? Focused should generally be more prominent than
      // selected.
      if (props.$isSelected) {
        return 0.36
      } else if (props.$isFocused) {
        return 0.16
      } else {
        return 0
      }
    }};
    transition: opacity 100ms linear;
  }

  &:hover::before {
    opacity: ${props => {
      // TODO(tec27): These seem backwards? Focused should generally be more prominent than
      // selected.
      if (props.$isSelected) {
        return 0.24
      } else if (props.$isFocused) {
        return 0.16
      } else {
        return 0.12
      }
    }};
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
  height: ${TEXT_PROTECTION_HEIGHT_PX}px;
  padding: 0 4px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: ${rgba(background900, 0.6)};
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
  map: Immutable<MapInfoJson>
  className?: string
  style?: React.CSSProperties
  forceAspectRatio?: number
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
  style,
  forceAspectRatio,
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
  const [menuOpen, openMenu, closeMenu] = usePopoverController()
  const [anchorRef, anchorX, anchorY] = useAnchorPosition('right', 'top')

  const onActionClick = useCallback(
    (handler: () => void) => {
      handler()
      closeMenu()
    },
    [closeMenu],
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
    <Container className={className} style={style}>
      <MapImage
        map={map}
        size={size}
        noImageElem={<NoImage />}
        forceAspectRatio={forceAspectRatio}
      />
      {onClick ? (
        <Overlay
          $isSelected={isSelected}
          $isFocused={isFocused}
          $textProtection={showMapName}
          onClick={onClick}>
          {selectedIcon}
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
                onClick={openMenu}
              />
              <Popover
                open={menuOpen}
                onDismiss={closeMenu}
                anchorX={anchorX ?? 0}
                anchorY={anchorY ?? 0}
                originX='right'
                originY='top'>
                <MenuList>{actions}</MenuList>
              </Popover>
            </>
          ) : null}
        </TextProtection>
      ) : null}
    </Container>
  )
}
