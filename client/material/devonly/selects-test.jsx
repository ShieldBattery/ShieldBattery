import React from 'react'
import styled from 'styled-components'
import Card from '../card'
import { SelectOption } from '../select/option'
import { Select } from '../select/select'
import { TextField } from '../text-field'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px !important;
`

const StyledCard = styled(Card)`
  width: 100%;
  max-width: 640px;
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
            <SelectOption value={1} text='Menu option 1' />
            <SelectOption value={2} text='Menu option 2' />
            <SelectOption value={3} text='Menu option 3' />
            <SelectOption value={4} text='Menu option 4' />
            <SelectOption value={5} text='Menu option 5' />
            <SelectOption value={6} text='Menu option 6' />
            <SelectOption value={7} text='Menu option 7' />
            <SelectOption value={8} text='Menu option 8' />
          </Select>

          <Select value={this.state.value2} disabled={true} label='Disabled'>
            <SelectOption value={1} text='Menu option 1' />
            <SelectOption value={2} text='Menu option 2' />
            <SelectOption value={3} text='Menu option 3' />
            <SelectOption value={4} text='Menu option 4' />
            <SelectOption value={5} text='This one is disabled' />
            <SelectOption value={6} text='Menu option 6' />
            <SelectOption value={7} text='Menu option 7' />
            <SelectOption value={8} text='Menu option 8' />
          </Select>

          <Select
            value={this.state.value3}
            label='No default value'
            onChange={value => this.onChange(3, value)}>
            <SelectOption value={1} text='Menu option 1' />
            <SelectOption value={2} text='Menu option 2' />
            <SelectOption value={3} text='Menu option 3' />
            <SelectOption value={4} text='Menu option 4' />
          </Select>

          <Select value={this.state.value4} onChange={value => this.onChange(4, value)}>
            <SelectOption value={1} text='No label' />
            <SelectOption value={2} text='Menu option 2' />
          </Select>

          <Select
            value={this.state.value5}
            allowErrors={false}
            onChange={value => this.onChange(5, value)}>
            <SelectOption value={1} text='No label, no allow errors' />
            <SelectOption value={2} text='Menu option 2' />
          </Select>

          <Select
            value={this.state.value6}
            label='No allow errors'
            allowErrors={false}
            onChange={value => this.onChange(6, value)}>
            <SelectOption value={1} text='Menu option 1' />
            <SelectOption value={2} text='Menu option 2' />
          </Select>

          <Select
            value={this.state.value7}
            label='With errors'
            errorText='Hi mom'
            onChange={value => this.onChange(7, value)}>
            <SelectOption value={1} text='Menu option 1' />
            <SelectOption value={2} text='Menu option 2' />
            <SelectOption value={3} text='Menu option 3' />
            <SelectOption value={4} text='Menu option 4' />
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
