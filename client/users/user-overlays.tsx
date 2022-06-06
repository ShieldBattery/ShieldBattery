import React, { useCallback, useRef, useState } from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { OriginX, OriginY, useAnchorPosition } from '../material/popover'
import { ConnectedUserContextMenuProps } from './user-context-menu'
import { ConnectedUserProfileOverlayProps } from './user-profile-overlay'

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
}: {
  userId: SbUserId
  profileAnchorX?: OriginX
  profileAnchorY?: OriginY
  profileOriginX?: OriginX
  profileOriginY?: OriginY
  profileOffsetX?: number
  profileOffsetY?: number
  filterClick?: (userId: SbUserId, e: React.MouseEvent) => boolean
  modifyMenuItems?: (userId: SbUserId, items: React.ReactNode[]) => React.ReactNode[]
}): {
  clickableElemRef: React.RefObject<E>
  profileOverlayProps: ConnectedUserProfileOverlayProps
  contextMenuProps: ConnectedUserContextMenuProps
  onClick: (event?: React.MouseEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
  isOverlayOpen: boolean
} {
  const clickableElemRef = useRef<E>(null)
  const [, anchorX, anchorY] = useAnchorPosition(
    profileAnchorX,
    profileAnchorY,
    clickableElemRef.current ?? null,
  )
  const [profileOverlayOpen, setProfileOverlayOpen] = useState(false)
  const [contextMenuEl, setContextMenuEl] = useState<Element | null>(null)
  const [contextMenuAnchorX, setContextMenuAnchorX] = useState(0)
  const [contextMenuAnchorY, setContextMenuAnchorY] = useState(0)
  const contextMenuOpen = Boolean(contextMenuEl)

  const onOpenProfileOverlay = useCallback(() => {
    setProfileOverlayOpen(true)
  }, [])
  const onCloseProfileOverlay = useCallback(() => {
    setProfileOverlayOpen(false)
  }, [])
  const onClick = useCallback(
    (e?: React.MouseEvent) => {
      if (!e || !filterClick || !filterClick(userId, e)) {
        onOpenProfileOverlay()
      }
    },
    [userId, onOpenProfileOverlay, filterClick],
  )

  const onOpenContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()

    setContextMenuAnchorX(event.pageX)
    setContextMenuAnchorY(event.pageY)
    setContextMenuEl(event.currentTarget)
  }, [])
  const onCloseContextMenu = useCallback(
    (event?: MouseEvent) => {
      if (
        !contextMenuEl ||
        event?.button !== 2 ||
        !event?.target ||
        !contextMenuEl.contains(event.target as Node)
      ) {
        setContextMenuEl(null)
      }
    },
    [contextMenuEl],
  )

  return {
    clickableElemRef,
    onClick,
    onContextMenu: onOpenContextMenu,
    isOverlayOpen: profileOverlayOpen || contextMenuOpen,
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
      popoverProps: {
        open: contextMenuOpen,
        onDismiss: onCloseContextMenu,
        anchorX: contextMenuAnchorX,
        anchorY: contextMenuAnchorY,
        originX: 'left',
        originY: 'top',
      },
    },
  }
}
