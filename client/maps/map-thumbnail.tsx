import { Immutable } from 'immer'
import { rgba } from 'polished'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MapInfoJson } from '../../common/maps'
import { IconRoot, MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import {
  amberA100,
  background700,
  background900,
  colorTextFaint,
  colorTextPrimary,
} from '../styles/colors'
import { singleLine, subtitle2 } from '../styles/typography'
import MapImage from './map-image'

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 2px;
  contain: content;
`

const TEXT_PROTECTION_HEIGHT_PX = 48

const SelectedIcon = styled.span<{ $isSelected?: boolean; $textProtection?: boolean }>`
  width: var(--sb-map-thumbnail-selected-icon-size, 64px);
  height: var(--sb-map-thumbnail-selected-icon-size, 64px);
  margin-bottom: ${props =>
    props.$textProtection ? Math.floor(TEXT_PROTECTION_HEIGHT_PX / 2) : 0}px;
  opacity: ${props => (props.$isSelected ? 0.5 : 0)};

  transition: opacity 100ms linear;

  & > svg {
    width: 100%;
    height: 100%;
  }

  & > ${IconRoot} {
    width: 100%;
    height: 100%;
    font-size: var(--sb-map-thumbnail-selected-icon-size, 64px);
  }
`

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

  &:hover {
    cursor: pointer;

    & > ${SelectedIcon} {
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

const NoImageContainer = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  background-color: ${background700};
  color: ${colorTextFaint};
`

const NoImageIcon = styled(MaterialIcon).attrs({ icon: 'image', size: 96 })`
  margin-bottom: 24px;
`

const NoImage = () => (
  <NoImageContainer>
    <NoImageIcon />
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
  const { t } = useTranslation()
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
      mapActions.push([t('maps.thumbnail.viewMapDetails', 'View map details'), onMapDetails])
    }
    if (onRegenMapImage) {
      mapActions.push([t('maps.thumbnail.regenerateImage', 'Regenerate image'), onRegenMapImage])
    }
    if (onRemove) {
      mapActions.push([t('common.actions.remove', 'Remove'), onRemove])
    }

    return mapActions.map(([text, handler], i) => (
      <MenuItem key={i} text={text} onClick={() => onActionClick(handler)} />
    ))
  }, [onMapDetails, onRegenMapImage, onRemove, t, onActionClick])

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
          <SelectedIcon $isSelected={isSelected} $textProtection={showMapName}>
            {selectedIcon}
          </SelectedIcon>
        </Overlay>
      ) : null}
      {onPreview ? (
        <MapPreviewIcon
          icon={<MaterialIcon icon='zoom_in' />}
          title={t('maps.thumbnail.showMapPreview', 'Show map preview')}
          onClick={onPreview}
        />
      ) : null}
      {onToggleFavorite ? (
        <FavoriteActionIcon
          disabled={isFavoriting}
          icon={<MaterialIcon icon='star' filled={map.isFavorited} />}
          title={
            map.isFavorited
              ? t('maps.thumbnail.removeFromFavorites', 'Remove from favorites')
              : t('maps.thumbnail.addToFavorites', 'Add to favorites')
          }
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
                icon={<MaterialIcon icon='more_vert' />}
                title={t('maps.thumbnail.mapActions', 'Map actions')}
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
