import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'

interface SlotActionsProps {
  slotActions: Array<[text: string, handler: () => void]>
}

export function SlotActions({ slotActions }: SlotActionsProps) {
  const { t } = useTranslation()
  const [overlayOpen, openOverlay, closeOverlay] = usePopoverController()
  const [anchorRef, anchorX, anchorY] = useAnchorPosition('right', 'top')

  const onActionClick = useCallback(
    (handler: () => void) => {
      handler()
      closeOverlay()
    },
    [closeOverlay],
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
        icon={<MaterialIcon icon='more_vert' />}
        title={t('lobbies.slots.slotActions', 'Slot actions')}
        ref={anchorRef}
        onClick={openOverlay}
      />
      <Popover
        open={overlayOpen}
        onDismiss={closeOverlay}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList>{actions}</MenuList>
      </Popover>
    </div>
  )
}
