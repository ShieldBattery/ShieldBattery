import { useCallback, useState } from 'react'
import styled from 'styled-components'
import { labelMedium } from '../../styles/typography'
import { FilledButton } from '../button'
import { Card } from '../card'
import { Divider } from '../menu/divider'
import { MenuItem } from '../menu/item'
import { MenuList } from '../menu/menu'
import { SelectableMenuItem } from '../menu/selectable-item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../popover'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px !important;
`

const StyledCard = styled(Card)`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  max-width: 640px;
`

const StyledMenuList = styled(MenuList)`
  min-width: 256px;
`

const Overline = styled.div`
  ${labelMedium};
  padding: 0 12px;
  margin: 8px 0;
  color: var(--theme-on-surface-variant);
`

const makeArrayRange = (size: number) => Array.from(Array(size).keys())

export function MenuTest() {
  const [normalMenuOpen, openNormalMenu, closeNormalMenu] = usePopoverController()
  const [scrollableMenuOpen, openScrollableMenu, closeScrollableMenu] = usePopoverController()
  const [denseMenuOpen, openDenseMenu, closeDenseMenu] = usePopoverController()
  const [scrollableDenseMenuOpen, openScrollableDenseMenu, closeScrollableDenseMenu] =
    usePopoverController()
  const [selectionMenuOpen, openSelectionMenu, closeSelectionMenu] = usePopoverController()
  const [mixedMenuOpen, openMixedMenu, closeMixedMenu] = usePopoverController()

  const [normalAnchor, normalAnchorX, normalAnchorY] = useRefAnchorPosition('center', 'top')
  const [scrollableAnchor, scrollableAnchorX, scrollableAnchorY] = useRefAnchorPosition(
    'center',
    'top',
  )
  const [denseAnchor, denseAnchorX, denseAnchorY] = useRefAnchorPosition('center', 'top')
  const [scrollableDenseAnchor, scrollableDenseAnchorX, scrollableDenseAnchorY] =
    useRefAnchorPosition('center', 'top')
  const [selectionAnchor, selectionAnchorX, selectionAnchorY] = useRefAnchorPosition(
    'center',
    'top',
  )
  const [mixedAnchor, mixedAnchorX, mixedAnchorY] = useRefAnchorPosition('center', 'top')

  const [selectedIndex, setSelectedIndex] = useState(2)

  const onSelected = useCallback(
    (index: number) => {
      setSelectedIndex(index)
      closeSelectionMenu()
      closeMixedMenu()
    },
    [closeMixedMenu, closeSelectionMenu],
  )

  return (
    <Container>
      <StyledCard>
        <FilledButton ref={normalAnchor} label='Open menu' onClick={openNormalMenu} />
        <FilledButton ref={scrollableAnchor} label='Scrollable' onClick={openScrollableMenu} />
        <FilledButton ref={denseAnchor} label='Dense' onClick={openDenseMenu} />
        <FilledButton
          ref={scrollableDenseAnchor}
          label='Scrollable dense'
          onClick={openScrollableDenseMenu}
        />
        <FilledButton ref={selectionAnchor} label='Selection menu' onClick={openSelectionMenu} />
        <FilledButton ref={mixedAnchor} label='Mixed' onClick={openMixedMenu} />

        <Popover
          open={normalMenuOpen}
          onDismiss={closeNormalMenu}
          originX='center'
          originY='top'
          anchorX={normalAnchorX ?? 0}
          anchorY={(normalAnchorY ?? 0) + 36}>
          <MenuList>
            <MenuItem text='Menu item 1' onClick={closeNormalMenu} />
            <MenuItem text='Menu item 2' onClick={closeNormalMenu} />
            <MenuItem text='Menu item 3' onClick={closeNormalMenu} />
          </MenuList>
        </Popover>

        <Popover
          open={scrollableMenuOpen}
          onDismiss={closeScrollableMenu}
          originX='center'
          originY='top'
          anchorX={scrollableAnchorX ?? 0}
          anchorY={(scrollableAnchorY ?? 0) + 36}>
          <StyledMenuList>
            <MenuItem text='Menu item 1' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 2' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 3' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 4' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 5' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 6' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 7' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 8' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 9' onClick={closeScrollableMenu} />
            <MenuItem text='Menu item 10' onClick={closeScrollableMenu} />
          </StyledMenuList>
        </Popover>

        <Popover
          open={denseMenuOpen}
          onDismiss={closeDenseMenu}
          originX='center'
          originY='top'
          anchorX={denseAnchorX ?? 0}
          anchorY={(denseAnchorY ?? 0) + 36}>
          <MenuList dense={true}>
            <MenuItem text='Menu item 1' onClick={closeDenseMenu} />
            <MenuItem text='Menu item 2' onClick={closeDenseMenu} />
            <MenuItem text='Menu item 3' onClick={closeDenseMenu} />
            <MenuItem text='Menu item 4' onClick={closeDenseMenu} />
            <MenuItem text='Menu item 5' onClick={closeDenseMenu} />
          </MenuList>
        </Popover>

        <Popover
          open={scrollableDenseMenuOpen}
          onDismiss={closeScrollableDenseMenu}
          originX='center'
          originY='top'
          anchorX={scrollableDenseAnchorX ?? 0}
          anchorY={(scrollableDenseAnchorY ?? 0) + 36}>
          <StyledMenuList dense={true}>
            <MenuItem text='Menu item 1' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 2' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 3' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 4' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 5' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 6' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 7' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 8' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 9' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 10' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 11' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 12' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 13' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 14' onClick={closeScrollableDenseMenu} />
            <MenuItem text='Menu item 15' onClick={closeScrollableDenseMenu} />
          </StyledMenuList>
        </Popover>

        <Popover
          open={selectionMenuOpen}
          onDismiss={closeSelectionMenu}
          originX='center'
          originY='top'
          anchorX={selectionAnchorX ?? 0}
          anchorY={(selectionAnchorY ?? 0) + 36}>
          <MenuList dense={true}>
            {makeArrayRange(5).map(i => (
              <SelectableMenuItem
                key={i}
                text={`Menu item ${i + 1}`}
                selected={selectedIndex === i}
                onClick={() => onSelected(i)}
              />
            ))}
          </MenuList>
        </Popover>

        <Popover
          open={mixedMenuOpen}
          onDismiss={closeMixedMenu}
          originX='center'
          originY='top'
          anchorX={mixedAnchorX ?? 0}
          anchorY={(mixedAnchorY ?? 0) + 36}>
          <StyledMenuList dense={true}>
            <Overline>Subheading</Overline>
            {makeArrayRange(3).map(i => (
              <SelectableMenuItem
                key={i}
                text={`Menu item ${i + 1}`}
                selected={selectedIndex === i}
                onClick={() => onSelected(i)}
              />
            ))}
            <Divider />
            <MenuItem text='Menu item 4' onClick={closeMixedMenu} />
            <MenuItem text='Menu item 5' onClick={closeMixedMenu} />
          </StyledMenuList>
        </Popover>
      </StyledCard>
    </Container>
  )
}
