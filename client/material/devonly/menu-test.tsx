import React, { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'
import { colorTextSecondary } from '../../styles/colors'
import { subtitle1 } from '../../styles/typography'
import { RaisedButton } from '../button'
import Card from '../card'
import { Divider } from '../menu/divider'
import { MenuItem } from '../menu/item'
import { MenuList } from '../menu/menu'
import { SelectableMenuItem } from '../menu/selectable-item'
import { OriginX, OriginY, Popover, useAnchorPosition } from '../popover'

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
  ${subtitle1};
  padding: 0 12px;
  margin: 8px 0;
  color: ${colorTextSecondary};
`

const makeArrayRange = (size: number) => Array.from(Array(size).keys())

export function MenuTest() {
  const [activeMenu, setActiveMenu] = useState<string>()
  const [anchorElem, setAnchorElem] = useState<HTMLElement>()
  const [selectedIndex, setSelectedIndex] = useState(2)
  const [, anchorX, anchorY] = useAnchorPosition('center', 'top', anchorElem ?? null)

  const onButtonClick = useCallback((event: React.MouseEvent) => {
    setAnchorElem(event.currentTarget as any)
  }, [])
  const onDismiss = useCallback(() => {
    setAnchorElem(undefined)
    setActiveMenu(undefined)
  }, [])
  const onSelected = useCallback(
    (index: number) => {
      setSelectedIndex(index)
      onDismiss()
    },
    [onDismiss],
  )

  const makeClickHandler = (name: string) => {
    return (event: React.MouseEvent) => {
      onButtonClick(event)
      setActiveMenu(name)
    }
  }

  const popoverProps = useMemo(
    () => ({
      onDismiss,
      originX: 'center' as OriginX,
      originY: 'top' as OriginY,
      anchorX: anchorX ?? 0,
      anchorY: (anchorY ?? 0) + 36,
    }),
    [anchorX, anchorY, onDismiss],
  )

  return (
    <Container>
      <StyledCard>
        <RaisedButton label='Open menu' onClick={makeClickHandler('normal')} />
        <RaisedButton label='Scrollable' onClick={makeClickHandler('scrollable')} />
        <RaisedButton label='Dense' onClick={makeClickHandler('dense')} />
        <RaisedButton label='Scrollable dense' onClick={makeClickHandler('scrollable-dense')} />
        <RaisedButton label='Selection menu' onClick={makeClickHandler('selection-menu')} />
        <RaisedButton label='Mixed' onClick={makeClickHandler('mixed')} />

        <Popover open={activeMenu === 'normal'} {...popoverProps}>
          <MenuList>
            <MenuItem text='Menu item 1' onClick={onDismiss} />
            <MenuItem text='Menu item 2' onClick={onDismiss} />
            <MenuItem text='Menu item 3' onClick={onDismiss} />
          </MenuList>
        </Popover>

        <Popover open={activeMenu === 'scrollable'} {...popoverProps}>
          <StyledMenuList>
            <MenuItem text='Menu item 1' onClick={onDismiss} />
            <MenuItem text='Menu item 2' onClick={onDismiss} />
            <MenuItem text='Menu item 3' onClick={onDismiss} />
            <MenuItem text='Menu item 4' onClick={onDismiss} />
            <MenuItem text='Menu item 5' onClick={onDismiss} />
            <MenuItem text='Menu item 6' onClick={onDismiss} />
            <MenuItem text='Menu item 7' onClick={onDismiss} />
            <MenuItem text='Menu item 8' onClick={onDismiss} />
            <MenuItem text='Menu item 9' onClick={onDismiss} />
            <MenuItem text='Menu item 10' onClick={onDismiss} />
          </StyledMenuList>
        </Popover>

        <Popover open={activeMenu === 'dense'} {...popoverProps}>
          <MenuList dense={true}>
            <MenuItem text='Menu item 1' onClick={onDismiss} />
            <MenuItem text='Menu item 2' onClick={onDismiss} />
            <MenuItem text='Menu item 3' onClick={onDismiss} />
            <MenuItem text='Menu item 4' onClick={onDismiss} />
            <MenuItem text='Menu item 5' onClick={onDismiss} />
          </MenuList>
        </Popover>

        <Popover open={activeMenu === 'scrollable-dense'} {...popoverProps}>
          <StyledMenuList dense={true}>
            <MenuItem text='Menu item 1' onClick={onDismiss} />
            <MenuItem text='Menu item 2' onClick={onDismiss} />
            <MenuItem text='Menu item 3' onClick={onDismiss} />
            <MenuItem text='Menu item 4' onClick={onDismiss} />
            <MenuItem text='Menu item 5' onClick={onDismiss} />
            <MenuItem text='Menu item 6' onClick={onDismiss} />
            <MenuItem text='Menu item 7' onClick={onDismiss} />
            <MenuItem text='Menu item 8' onClick={onDismiss} />
            <MenuItem text='Menu item 9' onClick={onDismiss} />
            <MenuItem text='Menu item 10' onClick={onDismiss} />
            <MenuItem text='Menu item 11' onClick={onDismiss} />
            <MenuItem text='Menu item 12' onClick={onDismiss} />
            <MenuItem text='Menu item 13' onClick={onDismiss} />
            <MenuItem text='Menu item 14' onClick={onDismiss} />
            <MenuItem text='Menu item 15' onClick={onDismiss} />
          </StyledMenuList>
        </Popover>

        <Popover open={activeMenu === 'selection-menu'} {...popoverProps}>
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

        <Popover open={activeMenu === 'mixed'} {...popoverProps}>
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
            <MenuItem text='Menu item 4' onClick={onDismiss} />
            <MenuItem text='Menu item 5' onClick={onDismiss} />
          </StyledMenuList>
        </Popover>
      </StyledCard>
    </Container>
  )
}
