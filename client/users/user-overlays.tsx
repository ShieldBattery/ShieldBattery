import React, { useCallback, useState } from 'react'
import { SbUserId } from '../../common/users/sb-user-id'
import { useContextMenu } from '../dom/use-context-menu'
import { OriginX, OriginY, useAnchorPosition, usePopoverController } from '../material/popover'
import { ConnectedUserContextMenuProps, MenuItemCategory } from './user-context-menu'
import { ConnectedUserProfileOverlayProps } from './user-profile-overlay'

export interface UserOverlaysProps {
  userId: SbUserId
  profileAnchorX?: OriginX
  profileAnchorY?: OriginY
  profileOriginX?: OriginX
  profileOriginY?: OriginY
  profileOffsetX?: number
  profileOffsetY?: number
  filterClick?: (userId: SbUserId, e: React.MouseEvent) => boolean
  modifyMenuItems?: (
    userId: SbUserId,
    items: Map<MenuItemCategory, React.ReactNode[]>,
    onMenuClose: (event?: MouseEvent) => void,
  ) => Map<MenuItemCategory, React.ReactNode[]>
}

export interface UserOverlays<E extends HTMLElement = HTMLElement> {
  clickableElemRef: React.RefCallback<E | null>
  profileOverlayProps: ConnectedUserProfileOverlayProps
  contextMenuProps: ConnectedUserContextMenuProps
  onClick: (event: React.MouseEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
  isOverlayOpen: boolean
}

/**
 * Returns nodes to render various types of user overlay UIs, and event handlers to attach to
 * elements that should trigger them. These can generally be used anywhere we display a username.
 */
export function useUserOverlays<E extends HTMLElement = HTMLElement>({
  userId,
  profileAnchorX = 'left',
  profileAnchorY = 'top',
  profileOriginX = 'right',
  profileOriginY = 'top',
  profileOffsetX = 0,
  profileOffsetY = 0,
  filterClick,
  modifyMenuItems,
}: UserOverlaysProps): UserOverlays<E> {
  const [clickableElem, setClickableElem] = useState<E | null>(null)
  const [, anchorX, anchorY] = useAnchorPosition(profileAnchorX, profileAnchorY, clickableElem)
  const [profileOverlayOpen, openProfileOverlay, closeProfileOverlay] = usePopoverController()
  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (!filterClick || !filterClick(userId, e)) {
        openProfileOverlay(e)
      }
    },
    [filterClick, userId, openProfileOverlay],
  )
  const onCloseProfileOverlay = useCallback(() => {
    closeProfileOverlay()
  }, [closeProfileOverlay])

  return {
    clickableElemRef: setClickableElem,
    onClick,
    onContextMenu,
    isOverlayOpen: profileOverlayOpen || contextMenuPopoverProps.open,
    profileOverlayProps: {
      userId,
      popoverProps: {
        open: profileOverlayOpen,
        onDismiss: onCloseProfileOverlay,
        anchorX: (anchorX ?? 0) + profileOffsetX,
        anchorY: (anchorY ?? 0) + profileOffsetY,
        originX: profileOriginX,
        originY: profileOriginY,
      },
    },
    contextMenuProps: {
      userId,
      modifyMenuItems,
      popoverProps: contextMenuPopoverProps,
    },
  }
}
