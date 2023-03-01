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
