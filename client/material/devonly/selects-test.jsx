import React from 'react'
import Card from '../card.jsx'

import Select from '../select.jsx'
import { MenuItem } from '../common/menu-utils.jsx'

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
        <Select defaultValue={2} label='First'>
          <MenuItem value={1} text='Menu option 1' />
          <MenuItem value={2} text='Menu option 2' />
          <MenuItem value={3} text='Menu option 3' />
          <MenuItem value={4} text='Menu option 4' />
          <MenuItem value={5} text='Menu option 5' />
          <MenuItem value={6} text='Menu option 6' />
          <MenuItem value={7} text='Menu option 7' />
          <MenuItem value={8} text='Menu option 8' />
        </Select>

        <Select defaultValue={5} disabled={true} label='Disabled'>
          <MenuItem value={1} text='Menu option 1' />
          <MenuItem value={2} text='Menu option 2' />
          <MenuItem value={3} text='Menu option 3' />
          <MenuItem value={4} text='Menu option 4' />
          <MenuItem value={5} text='This one is disabled' />
          <MenuItem value={6} text='Menu option 6' />
          <MenuItem value={7} text='Menu option 7' />
          <MenuItem value={8} text='Menu option 8' />
        </Select>

        <Select label='No default value'>
          <MenuItem value={1} text='Menu option 1' />
          <MenuItem value={2} text='Menu option 2' />
          <MenuItem value={3} text='Menu option 3' />
          <MenuItem value={4} text='Menu option 4' />
        </Select>

        <Select defaultValue={1}>
          <MenuItem value={1} text='No label' />
          <MenuItem value={2} text='Menu option 2' />
        </Select>

        <Select defaultValue={1} allowErrors={false}>
          <MenuItem value={1} text='No label, no allow errors' />
          <MenuItem value={2} text='Menu option 2' />
        </Select>

        <Select defaultValue={1} label='No allow errors' allowErrors={false}>
          <MenuItem value={1} text='Menu option 1' />
          <MenuItem value={2} text='Menu option 2' />
        </Select>

        <Select defaultValue={1} label='With errors' errorText='Hi mom'>
          <MenuItem value={1} text='Menu option 1' />
          <MenuItem value={2} text='Menu option 2' />
          <MenuItem value={3} text='Menu option 3' />
          <MenuItem value={4} text='Menu option 4' />
        </Select>

        <TextField floatingLabel={true} label='Label 2' errorText='hi' />
      </Card>
    </div>)
  }
}
