import React, { useCallback, useState } from 'react'
import { OriginX, OriginY, PopoverProps, usePopoverController } from '../material/popover'

interface UseContextMenuProps {
  originX?: OriginX
  originY?: OriginY
}

/**
 * React hook that can be used to setup context menu on any element.
 *
 * @example
 *
 * const Component = () => {
 *   const { onContextMenu, contextMenuPopoverProps} = useContextMenu()
 *   return (
 *     <>
 *       <Popover {...contextMenuPopoverProps}>
 *         <span>Hi, I'm in context menu!</span>
 *       </Popover>
 *       <span onContextMenu={onContextMenu}>Hello world!</span>
 *     </>
 *   )
 * }
 */
export function useContextMenu(props?: UseContextMenuProps): {
  onContextMenu: (event: React.MouseEvent) => void
  contextMenuPopoverProps: Omit<PopoverProps, 'children'>
} {
  const [anchor, setAnchor] = useState<Element>()
  const [anchorX, setAnchorX] = useState(0)
  const [anchorY, setAnchorY] = useState(0)

  const [isContextMenuOpen, openContextMenu, closeContextMenu] = usePopoverController()

  const onOpen = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()

      // NOTE(2Pac): This callback will be called each time user right-clicks inside an anchor, even
      // if the menu was already open. This makes it possible for us to save the new x/y position of
      // where the user clicked and move the menu to the new position, instead of just leaving it
      // open where it was.
      setAnchorX(event.pageX)
      setAnchorY(event.pageY)
      setAnchor(event.currentTarget)
      openContextMenu(event)
    },
    [openContextMenu],
  )
  const onDismiss = useCallback(
    (event?: MouseEvent) => {
      if (
        !anchor ||
        event?.button !== 2 ||
        !event?.target ||
        !anchor.contains(event.target as Node)
      ) {
        setAnchor(undefined)
        closeContextMenu()
      }
    },
    [anchor, closeContextMenu],
  )

  return {
    onContextMenu: onOpen,
    contextMenuPopoverProps: {
      open: isContextMenuOpen,
      onDismiss,
      anchorX,
      anchorY,
      originX: props?.originX ?? 'left',
      originY: props?.originY ?? 'top',
    },
  }
}
