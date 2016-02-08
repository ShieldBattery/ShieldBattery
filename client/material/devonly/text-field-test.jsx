
import React from 'react'
import Card from '../card.jsx'

import TextField from '../text-field.jsx'

export default class TextFieldTest extends React.Component {
  render() {
    const containerStyle = {
      padding: 16,
    }
    const cardStyle = {
      maxWidth: 640,
    }
    return (<div style={containerStyle}>
      <Card style={cardStyle}>
        <h3>Type some things</h3>
        <TextField floatingLabel={true} label='Label' />
        <TextField floatingLabel={true} label='Disabled' disabled={true} />
        <TextField floatingLabel={false} label='No float' errorText='hi' />
        <TextField floatingLabel={true} label='Label 2' errorText='hi' />
        <TextField floatingLabel={true} label='Disabled with value' disabled={true} value={'hi'}/>
        <TextField floatingLabel={true} label='No errors' allowErrors={false} />
        <TextField floatingLabel={false} label='No errors, no float' allowErrors={false} />
      </Card>
    </div>)
  }
}
