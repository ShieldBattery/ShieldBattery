import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import { colorTextSecondary } from '../../styles/colors'
import { subtitle1 } from '../../styles/typography'
import { RaisedButton } from '../button'
import Card from '../card'
import { Divider } from '../menu/divider'
import { MenuItem } from '../menu/item'
import { Menu } from '../menu/menu'
import { SelectedItem as SelectedMenuItem } from '../menu/selected-item'
import { useAnchorPosition } from '../popover'

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

const StyledMenu = styled(Menu)`
  min-width: 256px;
`

const Overline = styled.div`
  ${subtitle1};
  padding: 0 12px;
  margin: 8px 0;
  color: ${colorTextSecondary};
`

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

  return (
    <Container>
      <StyledCard>
        <RaisedButton label='Open menu' onClick={makeClickHandler('normal')} />
        <RaisedButton label='Scrollable' onClick={makeClickHandler('scrollable')} />
        <RaisedButton label='Dense' onClick={makeClickHandler('dense')} />
        <RaisedButton label='Scrollable dense' onClick={makeClickHandler('scrollable-dense')} />
        <RaisedButton label='Selection menu' onClick={makeClickHandler('selection-menu')} />
        <RaisedButton label='Mixed' onClick={makeClickHandler('mixed')} />

        <Menu
          open={activeMenu === 'normal'}
          onDismiss={onDismiss}
          originX='center'
          originY='top'
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) + 36}>
          <MenuItem text='Menu item 1' onClick={onDismiss} />
          <MenuItem text='Menu item 2' onClick={onDismiss} />
          <MenuItem text='Menu item 3' onClick={onDismiss} />
        </Menu>
        <StyledMenu
          open={activeMenu === 'scrollable'}
          onDismiss={onDismiss}
          originX='center'
          originY='top'
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) + 36}>
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
        </StyledMenu>
        <Menu
          open={activeMenu === 'dense'}
          onDismiss={onDismiss}
          originX='center'
          originY='top'
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) + 36}
          dense={true}>
          <MenuItem text='Menu item 1' onClick={onDismiss} />
          <MenuItem text='Menu item 2' onClick={onDismiss} />
          <MenuItem text='Menu item 3' onClick={onDismiss} />
          <MenuItem text='Menu item 4' onClick={onDismiss} />
          <MenuItem text='Menu item 5' onClick={onDismiss} />
        </Menu>
        <StyledMenu
          open={activeMenu === 'scrollable-dense'}
          onDismiss={onDismiss}
          originX='center'
          originY='top'
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) + 36}
          dense={true}>
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
        </StyledMenu>
        <Menu
          open={activeMenu === 'selection-menu'}
          onDismiss={onDismiss}
          originX='center'
          originY='top'
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) + 36}
          dense={true}
          selectedIndex={selectedIndex}
          onItemSelected={onSelected}>
          <SelectedMenuItem text='Menu item 1' />
          <SelectedMenuItem text='Menu item 2' />
          <SelectedMenuItem text='Menu item 3' />
          <SelectedMenuItem text='Menu item 4' />
          <SelectedMenuItem text='Menu item 5' />
        </Menu>
        <StyledMenu
          open={activeMenu === 'mixed'}
          onDismiss={onDismiss}
          originX='center'
          originY='top'
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) + 36}
          dense={true}
          selectedIndex={selectedIndex}
          onItemSelected={onSelected}>
          <Overline>Subheading</Overline>
          <SelectedMenuItem text='Menu item 1' />
          <SelectedMenuItem text='Menu item 2' />
          <SelectedMenuItem text='Menu item 3' />
          <Divider />
          <MenuItem text='Menu item 4' onClick={onDismiss} />
          <MenuItem text='Menu item 5' onClick={onDismiss} />
        </StyledMenu>
      </StyledCard>
    </Container>
  )
}
