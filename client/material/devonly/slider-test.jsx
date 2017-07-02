import React from 'react'
import Card from '../card.jsx'

import Slider from '../slider.jsx'

import Select from '../select/select.jsx'
import Option from '../select/option.jsx'

import TextField from '../text-field.jsx'

export default class SliderTest extends React.Component {
  render() {
    const containerStyle = {
      padding: 16,
      paddingTop: 64,
    }
    const cardStyle = {
      maxWidth: 640,
      paddingBottom: 32,
    }
    return (
      <div style={containerStyle}>
        <Card style={cardStyle}>
          <h3>Slide some things</h3>
          <TextField floatingLabel={true} label="Label" />
          <Slider min={0} max={4} defaultValue={0} step={1} />
          <Slider min={0} max={4} defaultValue={2} step={1} label="Slide this" />
          <Slider min={10} max={100} defaultvalue={40} step={5} />
          <Slider min={0} max={4} defaultValue={2} step={1} /> {/* TODO: disabled */}
          <TextField floatingLabel={true} label="Label 2" errorText="hi" />
          <Slider min={0} max={7} step={1} /> {/* TODO: no default value */}
          <Select defaultValue={2} label="First">
            <Option value={1} text="Menu option 1" />
            <Option value={2} text="Menu option 2" />
            <Option value={3} text="Menu option 3" />
            <Option value={4} text="Menu option 4" />
            <Option value={5} text="Menu option 5" />
            <Option value={6} text="Menu option 6" />
            <Option value={7} text="Menu option 7" />
            <Option value={8} text="Menu option 8" />
          </Select>
          <Slider min={0} max={4} defaultValue={2} />
          <Slider min={0} max={4} defaultValue={2} step={1} />
        </Card>
      </div>
    )
  }
}
