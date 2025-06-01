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

export interface UserOverlays {
  profileOverlayProps: ConnectedUserProfileOverlayProps
  contextMenuProps: ConnectedUserContextMenuProps
  onClick: (event: React.MouseEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
  isOverlayOpen: boolean
}

/**
 * Returns nodes to render various types of user overlay UIs, and event handlers to attach to
 * elements that should trigger them. These can generally be used anywhere we display a username.
 * Overlays will be attached to whichever element the `onClick`/`onContextMenu` handlers are
 * attached to.
 */
export function useUserOverlays({
  userId,
  profileAnchorX = 'left',
  profileAnchorY = 'top',
  profileOriginX = 'right',
  profileOriginY = 'top',
  profileOffsetX = 0,
  profileOffsetY = 0,
  filterClick,
  UserMenu,
}: UserOverlaysProps): UserOverlays {
  const [clickableElem, setClickableElem] = useState<HTMLElement | null>(null)
  const [anchorX, anchorY] = useElemAnchorPosition(clickableElem, profileAnchorX, profileAnchorY)
  const [profileOverlayOpen, openProfileOverlay, closeProfileOverlay] = usePopoverController()
  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()

  return {
    onClick: e => {
      if (!filterClick || !filterClick(userId, e)) {
        setClickableElem(e.currentTarget as HTMLElement)
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
          setClickableElem(null)
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
