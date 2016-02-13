import React from 'react'
import Card from '../card.jsx'

import IconButton from '../icon-button.jsx'
import Select from '../select/select.jsx'
import Option from '../select/option.jsx'

export default class OverflowTest extends React.Component {
  render() {
    const containerStyle = {
      padding: 16,
      // TODO(tec27): need to make the select not go off-screen?
      paddingTop: 64,
    }
    const cardStyle = {
      maxWidth: 640,
      paddingBottom: 32,
      margin: '0px auto',
    }
    return (<div style={containerStyle}>
      <Card style={cardStyle}>
        <h3>Test the menus</h3>
        <IconButton icon='more_vert' onClick={() => this.onFirstClick()} />
        <Select defaultValue={2} label='First'>
          <Option value={1} text='Menu option 1' />
          <Option value={2} text='Menu option 2' />
          <Option value={3} text='Menu option 3' />
          <Option value={4} text='Menu option 4' />
          <Option value={5} text='Menu option 5' />
          <Option value={6} text='Menu option 6' />
          <Option value={7} text='Menu option 7' />
          <Option value={8} text='Menu option 8' />
        </Select>
      </Card>
    </div>)
  }

  onFirstClick() {
  }
}
