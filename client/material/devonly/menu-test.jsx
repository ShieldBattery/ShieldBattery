import React from 'react'
import styled from 'styled-components'

import Card from '../card.jsx'
import Menu from '../menu/menu.jsx'
import MenuItem from '../menu/item.jsx'
import RaisedButton from '../raised-button.jsx'

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

export default class MenuTest extends React.Component {
  state = {
    open: false,
  }

  _menu1 = React.createRef()
  _menu2 = React.createRef()

  render() {
    const { open } = this.state

    return (
      <Container>
        <StyledCard>
          <RaisedButton buttonRef={this._menu1} label='Open menu' onClick={this.onMenu1Open} />
          <RaisedButton buttonRef={this._menu2} label='Scrollable' onClick={this.onMenu2Open} />

          <Menu
            open={open === 'menu1'}
            onDismiss={this.onDismiss}
            anchor={this._menu1.current}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            anchorOffsetVertical={36}
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'
            onItemSelected={this.onDismiss}>
            <MenuItem key='1' text='Menu item 1' onClick={this.onDismiss} />
            <MenuItem key='2' text='Menu item 2' onClick={this.onDismiss} />
            <MenuItem key='3' text='Menu item 3' onClick={this.onDismiss} />
          </Menu>
          <StyledMenu
            open={open === 'menu2'}
            onDismiss={this.onDismiss}
            anchor={this._menu2.current}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            anchorOffsetVertical={36}
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'
            onItemSelected={this.onDismiss}>
            <MenuItem key='1' text='Menu item 1' onClick={this.onDismiss} />
            <MenuItem key='2' text='Menu item 2' onClick={this.onDismiss} />
            <MenuItem key='3' text='Menu item 3' onClick={this.onDismiss} />
            <MenuItem key='4' text='Menu item 4' onClick={this.onDismiss} />
            <MenuItem key='5' text='Menu item 5' onClick={this.onDismiss} />
            <MenuItem key='6' text='Menu item 6' onClick={this.onDismiss} />
            <MenuItem key='7' text='Menu item 7' onClick={this.onDismiss} />
            <MenuItem key='8' text='Menu item 8' onClick={this.onDismiss} />
            <MenuItem key='9' text='Menu item 9' onClick={this.onDismiss} />
            <MenuItem key='10' text='Menu item 10' onClick={this.onDismiss} />
          </StyledMenu>
        </StyledCard>
      </Container>
    )
  }

  onDismiss = () => {
    this.setState({ open: false })
  }
  onMenu1Open = () => {
    this.setState({ open: 'menu1' })
  }
  onMenu2Open = () => {
    this.setState({ open: 'menu2' })
  }
}
