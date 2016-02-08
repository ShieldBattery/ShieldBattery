import React from 'react'
import Card from '../card.jsx'

import Select from '../select/select.jsx'
import Option from '../select/option.jsx'

import TextField from '../text-field.jsx'

export default class SelectsTest extends React.Component {
  render() {
    const containerStyle = {
      padding: 16,
      // TODO(tec27): need to make the select not go off-screen?
      paddingTop: 64,
    }
    const cardStyle = {
      maxWidth: 640,
      paddingBottom: 32,
    }
    return (<div style={containerStyle}>
      <Card style={cardStyle}>
        <h3>Select some things</h3>
        <TextField floatingLabel={true} label='Label' />
        <Select defaultValue={2}>
          <Option value={1} text='Menu option 1' />
          <Option value={2} text='Menu option 2' />
          <Option value={3} text='Menu option 3' />
          <Option value={4} text='Menu option 4' />
          <Option value={5} text='Menu option 5' />
          <Option value={6} text='Menu option 6' />
          <Option value={7} text='Menu option 7' />
          <Option value={8} text='Menu option 8' />
        </Select>

        <Select defaultValue={5} disabled={true}>
          <Option value={1} text='Menu option 1' />
          <Option value={2} text='Menu option 2' />
          <Option value={3} text='Menu option 3' />
          <Option value={4} text='Menu option 4' />
          <Option value={5} text='This one is disabled' />
          <Option value={6} text='Menu option 6' />
          <Option value={7} text='Menu option 7' />
          <Option value={8} text='Menu option 8' />
        </Select>

        <Select>
          <Option value={1} text='Menu option 1' />
          <Option value={2} text='Menu option 2' />
          <Option value={3} text='Menu option 3' />
          <Option value={4} text='Menu option 4' />
        </Select>

        <TextField floatingLabel={true} label='Label 2' errorText='hi' />
      </Card>
    </div>)
  }
}
