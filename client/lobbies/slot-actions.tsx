import React, { useCallback, useMemo, useState } from 'react'
import SlotActionsIcon from '../icons/material/more_vert-24px.svg'
import { IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition } from '../material/popover'

interface SlotActionsProps {
  slotActions: Array<[text: string, handler: () => void]>
}

export function SlotActions({ slotActions }: SlotActionsProps) {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [anchorRef, anchorX, anchorY] = useAnchorPosition('right', 'top')

  const onOpenOverlay = useCallback(() => {
    setOverlayOpen(true)
  }, [])
  const onCloseOverlay = useCallback(() => {
    setOverlayOpen(false)
  }, [])
  const onActionClick = useCallback(
    (handler: () => void) => {
      handler()
      onCloseOverlay()
    },
    [onCloseOverlay],
  )

  const actions = useMemo(
    () =>
      slotActions.map(([text, handler], i) => (
        <MenuItem key={i} text={text} onClick={() => onActionClick(handler)} />
      )),
    [slotActions, onActionClick],
  )

  return (
    <div>
      <IconButton
        icon={<SlotActionsIcon />}
        title='Slot actions'
        ref={anchorRef}
        onClick={onOpenOverlay}
      />
      <Popover
        open={overlayOpen}
        onDismiss={onCloseOverlay}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList>{actions}</MenuList>
      </Popover>
    </div>
  )
}
