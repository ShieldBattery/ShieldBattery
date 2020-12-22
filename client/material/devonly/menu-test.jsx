import React from 'react'
import styled from 'styled-components'

import Card from '../card.jsx'
import Divider from '../menu/divider.jsx'
import Menu from '../menu/menu.jsx'
import MenuItem from '../menu/item.jsx'
import RaisedButton from '../raised-button.jsx'
import SelectedMenuItem from '../menu/selected-item.jsx'

import { colorTextSecondary } from '../../styles/colors.ts'
import { Subheading } from '../../styles/typography.ts'

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

const Overline = styled(Subheading)`
  padding: 0 12px;
  margin: 8px 0;
  color: ${colorTextSecondary};
`

export default class MenuTest extends React.Component {
  state = {
    open: false,
    selectedIndex: 2,
  }

  _menu1 = React.createRef()
  _menu2 = React.createRef()
  _menu3 = React.createRef()
  _menu4 = React.createRef()
  _menu5 = React.createRef()
  _menu6 = React.createRef()

  render() {
    const { open } = this.state

    return (
      <Container>
        <StyledCard>
          <RaisedButton buttonRef={this._menu1} label='Open menu' onClick={this.onMenu1Open} />
          <RaisedButton buttonRef={this._menu2} label='Scrollable' onClick={this.onMenu2Open} />
          <RaisedButton buttonRef={this._menu3} label='Dense' onClick={this.onMenu3Open} />
          <RaisedButton
            buttonRef={this._menu4}
            label='Scrollable dense'
            onClick={this.onMenu4Open}
          />
          <RaisedButton buttonRef={this._menu5} label='Selection menu' onClick={this.onMenu5Open} />
          <RaisedButton buttonRef={this._menu6} label='Mixed' onClick={this.onMenu6Open} />

          <Menu
            open={open === 'menu1'}
            onDismiss={this.onDismiss}
            anchor={this._menu1.current}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            anchorOffsetVertical={36}
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'>
            <MenuItem text='Menu item 1' onClick={this.onDismiss} />
            <MenuItem text='Menu item 2' onClick={this.onDismiss} />
            <MenuItem text='Menu item 3' onClick={this.onDismiss} />
          </Menu>
          <StyledMenu
            open={open === 'menu2'}
            onDismiss={this.onDismiss}
            anchor={this._menu2.current}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            anchorOffsetVertical={36}
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'>
            <MenuItem text='Menu item 1' onClick={this.onDismiss} />
            <MenuItem text='Menu item 2' onClick={this.onDismiss} />
            <MenuItem text='Menu item 3' onClick={this.onDismiss} />
            <MenuItem text='Menu item 4' onClick={this.onDismiss} />
            <MenuItem text='Menu item 5' onClick={this.onDismiss} />
            <MenuItem text='Menu item 6' onClick={this.onDismiss} />
            <MenuItem text='Menu item 7' onClick={this.onDismiss} />
            <MenuItem text='Menu item 8' onClick={this.onDismiss} />
            <MenuItem text='Menu item 9' onClick={this.onDismiss} />
            <MenuItem text='Menu item 10' onClick={this.onDismiss} />
          </StyledMenu>
          <Menu
            open={open === 'menu3'}
            onDismiss={this.onDismiss}
            anchor={this._menu3.current}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            anchorOffsetVertical={36}
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'
            dense={true}>
            <MenuItem text='Menu item 1' onClick={this.onDismiss} />
            <MenuItem text='Menu item 2' onClick={this.onDismiss} />
            <MenuItem text='Menu item 3' onClick={this.onDismiss} />
            <MenuItem text='Menu item 4' onClick={this.onDismiss} />
            <MenuItem text='Menu item 5' onClick={this.onDismiss} />
          </Menu>
          <StyledMenu
            open={open === 'menu4'}
            onDismiss={this.onDismiss}
            anchor={this._menu4.current}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            anchorOffsetVertical={36}
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'
            dense={true}>
            <MenuItem text='Menu item 1' onClick={this.onDismiss} />
            <MenuItem text='Menu item 2' onClick={this.onDismiss} />
            <MenuItem text='Menu item 3' onClick={this.onDismiss} />
            <MenuItem text='Menu item 4' onClick={this.onDismiss} />
            <MenuItem text='Menu item 5' onClick={this.onDismiss} />
            <MenuItem text='Menu item 6' onClick={this.onDismiss} />
            <MenuItem text='Menu item 7' onClick={this.onDismiss} />
            <MenuItem text='Menu item 8' onClick={this.onDismiss} />
            <MenuItem text='Menu item 9' onClick={this.onDismiss} />
            <MenuItem text='Menu item 10' onClick={this.onDismiss} />
            <MenuItem text='Menu item 11' onClick={this.onDismiss} />
            <MenuItem text='Menu item 12' onClick={this.onDismiss} />
            <MenuItem text='Menu item 13' onClick={this.onDismiss} />
            <MenuItem text='Menu item 14' onClick={this.onDismiss} />
            <MenuItem text='Menu item 15' onClick={this.onDismiss} />
          </StyledMenu>
          <Menu
            open={open === 'menu5'}
            onDismiss={this.onDismiss}
            anchor={this._menu5.current}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            anchorOffsetVertical={36}
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'
            dense={true}
            selectedIndex={this.state.selectedIndex}
            onItemSelected={this.onSelected}>
            <SelectedMenuItem text='Menu item 1' />
            <SelectedMenuItem text='Menu item 2' />
            <SelectedMenuItem text='Menu item 3' />
            <SelectedMenuItem text='Menu item 4' />
            <SelectedMenuItem text='Menu item 5' />
          </Menu>
          <StyledMenu
            open={open === 'menu6'}
            onDismiss={this.onDismiss}
            anchor={this._menu6.current}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            anchorOffsetVertical={36}
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'
            dense={true}
            selectedIndex={this.state.selectedIndex}
            onItemSelected={this.onSelected}>
            <Overline>Subheading</Overline>
            <SelectedMenuItem text='Menu item 1' />
            <SelectedMenuItem text='Menu item 2' />
            <SelectedMenuItem text='Menu item 3' />
            <Divider />
            <MenuItem text='Menu item 4' onClick={this.onDismiss} />
            <MenuItem text='Menu item 5' onClick={this.onDismiss} />
          </StyledMenu>
        </StyledCard>
      </Container>
    )
  }

  onDismiss = () => {
    this.setState({ open: false })
  }
  onSelected = index => {
    this.setState({ selectedIndex: index })
    this.onDismiss()
  }
  onMenu1Open = () => {
    this.setState({ open: 'menu1' })
  }
  onMenu2Open = () => {
    this.setState({ open: 'menu2' })
  }
  onMenu3Open = () => {
    this.setState({ open: 'menu3' })
  }
  onMenu4Open = () => {
    this.setState({ open: 'menu4' })
  }
  onMenu5Open = () => {
    this.setState({ open: 'menu5' })
  }
  onMenu6Open = () => {
    this.setState({ open: 'menu6' })
  }
}
