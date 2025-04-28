import React, { useState } from 'react'
import { SbUserId } from '../../common/users/sb-user-id'
import { useContextMenu } from '../dom/use-context-menu'
import { OriginX, OriginY, useElemAnchorPosition, usePopoverController } from '../material/popover'
import { ConnectedUserContextMenuProps, UserMenuComponent } from './user-context-menu'
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
  UserMenu?: UserMenuComponent
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
  UserMenu,
}: UserOverlaysProps): UserOverlays<E> {
  const [clickableElem, setClickableElem] = useState<E | null>(null)
  const [anchorX, anchorY] = useElemAnchorPosition(clickableElem, profileAnchorX, profileAnchorY)
  const [profileOverlayOpen, openProfileOverlay, closeProfileOverlay] = usePopoverController()
  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()

  return {
    clickableElemRef: setClickableElem,
    onClick: e => {
      if (!filterClick || !filterClick(userId, e)) {
        openProfileOverlay(e)
      }
    },
    onContextMenu,
    isOverlayOpen: profileOverlayOpen || contextMenuPopoverProps.open,
    profileOverlayProps: {
      userId,
      popoverProps: {
        open: profileOverlayOpen,
        onDismiss: () => {
          closeProfileOverlay()
        },
        anchorX: (anchorX ?? 0) + profileOffsetX,
        anchorY: (anchorY ?? 0) + profileOffsetY,
        originX: profileOriginX,
        originY: profileOriginY,
      },
    },
    contextMenuProps: {
      userId,
      UserMenu,
      popoverProps: contextMenuPopoverProps,
    },
  }
}
