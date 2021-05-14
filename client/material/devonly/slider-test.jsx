import React from 'react'
import styled from 'styled-components'

import Card from '../card'
import Slider from '../slider'
import { Select } from '../select/select'
import { Option } from '../select/option'
import TextField from '../text-field'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

const StyledCard = styled(Card)`
  width: 100%;
  max-width: 640px;
`

export default class SliderTest extends React.Component {
  state = {
    value1: 0,
    value2: 2,
    value3: 40,
    value4: 2,
    value5: 0,
    value6: 2,
    value7: 2,
  }

  render() {
    return (
      <Container>
        <StyledCard>
          <h3>Slide some things</h3>
          <TextField floatingLabel={true} label='Label' />
          <Slider
            min={0}
            max={4}
            value={this.state.value1}
            step={1}
            onChange={value => this.onChange('1', value)}
          />
          <Slider
            min={0}
            max={4}
            value={this.state.value2}
            step={1}
            label='Slide this'
            onChange={value => this.onChange('2', value)}
          />
          <Slider
            min={10}
            max={100}
            value={this.state.value3}
            step={5}
            onChange={value => this.onChange('3', value)}
          />
          <Slider
            min={10}
            max={100}
            value={50}
            step={5}
            disabled={true}
            onChange={value => this.onChange('3', value)}
          />
          <Slider
            min={0}
            max={4}
            value={this.state.value4}
            step={1}
            onChange={value => this.onChange('4', value)}
          />
          <TextField floatingLabel={true} label='Label 2' errorText='hi' />
          {/* TODO: no default value */}
          <Slider
            min={0}
            max={7}
            value={this.state.value5}
            step={1}
            onChange={value => this.onChange('5', value)}
          />
          <Select value={2} label='First'>
            <Option value={1} text='Menu option 1' />
            <Option value={2} text='Menu option 2' />
            <Option value={3} text='Menu option 3' />
            <Option value={4} text='Menu option 4' />
            <Option value={5} text='Menu option 5' />
            <Option value={6} text='Menu option 6' />
            <Option value={7} text='Menu option 7' />
            <Option value={8} text='Menu option 8' />
          </Select>
          <Slider
            min={0}
            max={4}
            value={this.state.value6}
            onChange={value => this.onChange('6', value)}
          />
          <Slider
            min={0}
            max={4}
            value={this.state.value7}
            step={1}
            onChange={value => this.onChange('7', value)}
          />
        </StyledCard>
      </Container>
    )
  }

  onChange = (name, value) => {
    this.setState({
      [`value${name}`]: value,
    })
  }
}
