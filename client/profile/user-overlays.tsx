import React, { useCallback, useRef, useState } from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { OriginX, OriginY, useAnchorPosition } from '../material/popover'
import { ConnectedUserContextMenu } from './user-context-menu'
import { ConnectedUserProfileOverlay } from './user-profile-overlay'

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
}: {
  userId: SbUserId
  profileAnchorX?: OriginX
  profileAnchorY?: OriginY
  profileOriginX?: OriginX
  profileOriginY?: OriginY
  profileOffsetX?: number
  profileOffsetY?: number
}): {
  clickableElemRef: React.RefObject<E>
  overlayNodes: React.ReactFragment
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

  const overlayNodes = (
    <>
      <ConnectedUserProfileOverlay
        key='profile-overlay'
        userId={userId}
        popoverProps={{
          open: profileOverlayOpen,
          onDismiss: onCloseProfileOverlay,
          anchorX: (anchorX ?? 0) + profileOffsetX,
          anchorY: (anchorY ?? 0) + profileOffsetY,
          originX: profileOriginX,
          originY: profileOriginY,
        }}
      />
      <ConnectedUserContextMenu
        key='context-menu'
        userId={userId}
        popoverProps={{
          open: contextMenuOpen,
          onDismiss: onCloseContextMenu,
          anchorX: contextMenuAnchorX,
          anchorY: contextMenuAnchorY,
          originX: 'left',
          originY: 'top',
        }}
      />
    </>
  )

  return {
    clickableElemRef,
    overlayNodes,
    onClick: onOpenProfileOverlay,
    onContextMenu: onOpenContextMenu,
    isOverlayOpen: profileOverlayOpen || contextMenuOpen,
  }
}
