import React from 'react'
import styled from 'styled-components'

import Card from '../card.jsx'
import Select from '../select/select.jsx'
import Option from '../select/option.jsx'
import TextField from '../text-field.jsx'

import { grey850 } from '../../styles/colors'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px !important;
`

const StyledCard = styled(Card)`
  width: 100%;
  max-width: 640px;
  background-color: ${grey850};
`

export default class SelectsTest extends React.Component {
  state = {
    value1: 2,
    value2: 5,
    value3: undefined,
    value4: 1,
    value5: 1,
    value6: 1,
    value7: 1,
  }

  render() {
    return (
      <Container>
        <StyledCard>
          <h3>Select some things</h3>
          <TextField floatingLabel={true} label='Label' />
          <Select
            value={this.state.value1}
            label='First'
            onChange={value => this.onChange(1, value)}>
            <Option value={1} text='Menu option 1' />
            <Option value={2} text='Menu option 2' />
            <Option value={3} text='Menu option 3' />
            <Option value={4} text='Menu option 4' />
            <Option value={5} text='Menu option 5' />
            <Option value={6} text='Menu option 6' />
            <Option value={7} text='Menu option 7' />
            <Option value={8} text='Menu option 8' />
          </Select>

          <Select value={this.state.value2} disabled={true} label='Disabled'>
            <Option value={1} text='Menu option 1' />
            <Option value={2} text='Menu option 2' />
            <Option value={3} text='Menu option 3' />
            <Option value={4} text='Menu option 4' />
            <Option value={5} text='This one is disabled' />
            <Option value={6} text='Menu option 6' />
            <Option value={7} text='Menu option 7' />
            <Option value={8} text='Menu option 8' />
          </Select>

          <Select
            value={this.state.value3}
            label='No default value'
            onChange={value => this.onChange(3, value)}>
            <Option value={1} text='Menu option 1' />
            <Option value={2} text='Menu option 2' />
            <Option value={3} text='Menu option 3' />
            <Option value={4} text='Menu option 4' />
          </Select>

          <Select value={this.state.value4} onChange={value => this.onChange(4, value)}>
            <Option value={1} text='No label' />
            <Option value={2} text='Menu option 2' />
          </Select>

          <Select
            value={this.state.value5}
            allowErrors={false}
            onChange={value => this.onChange(5, value)}>
            <Option value={1} text='No label, no allow errors' />
            <Option value={2} text='Menu option 2' />
          </Select>

          <Select
            value={this.state.value6}
            label='No allow errors'
            allowErrors={false}
            onChange={value => this.onChange(6, value)}>
            <Option value={1} text='Menu option 1' />
            <Option value={2} text='Menu option 2' />
          </Select>

          <Select
            value={this.state.value7}
            label='With errors'
            errorText='Hi mom'
            onChange={value => this.onChange(7, value)}>
            <Option value={1} text='Menu option 1' />
            <Option value={2} text='Menu option 2' />
            <Option value={3} text='Menu option 3' />
            <Option value={4} text='Menu option 4' />
          </Select>

          <TextField floatingLabel={true} label='Label 2' errorText='hi' />
        </StyledCard>
      </Container>
    )
  }

  onChange = (key, value) => {
    const valueKey = `value${key}`

    this.setState({
      [valueKey]: value,
    })
  }
}
