import React from 'react'
import styled from 'styled-components'

import Card from '../card.jsx'
import IconButton from '../icon-button.jsx'
import TextField from '../text-field.jsx'

import LeadingIcon from '../../icons/material/baseline-view_list-24px.svg'
import TrailingIcon from '../../icons/material/baseline-check_circle-24px.svg'

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

export default class TextFieldTest extends React.Component {
  state = {
    value1: '',
    value2: '',
    value3: '',
    value4: '',
    value5: '',
    value6: '',
    value7: '',
    value8: '',
    value9: '',
    value10: '',
    value11: '',
    value12: '',
    value13: '',
    value14: '',
    value15: '',
    value16: '',
    value17: '',
    changeError: null,
  }

  render() {
    return (
      <Container>
        <StyledCard>
          <h3>Type some things</h3>
          <TextField
            name='1'
            value={this.state.value1}
            floatingLabel={true}
            label='Label'
            onChange={this.onChange}
          />
          <TextField
            name='2'
            value={this.state.value2}
            floatingLabel={true}
            label='Disabled'
            disabled={true}
            onChange={this.onChange}
          />
          <TextField
            name='3'
            value={this.state.value3}
            floatingLabel={false}
            label='No float'
            onChange={this.onChange}
          />
          <TextField
            name='4'
            value={this.state.value4}
            floatingLabel={true}
            label='Error on change'
            errorText={this.state.changeError}
            onChange={this.onChange}
          />
          <TextField
            name='5'
            value={this.state.value5}
            floatingLabel={true}
            label='Permanent error'
            errorText='hi'
            onChange={this.onChange}
          />
          <TextField
            name='6'
            value={'hi'}
            floatingLabel={true}
            label='Disabled with value'
            disabled={true}
            onChange={this.onChange}
          />
          <TextField
            name='7'
            value={this.state.value7}
            floatingLabel={true}
            label='Disabled with error'
            disabled={true}
            errorText={'hi'}
            onChange={this.onChange}
          />
          <TextField
            name='8'
            value={this.state.value8}
            floatingLabel={true}
            label='With leading icon'
            leadingIcons={[<LeadingIcon />]}
            onChange={this.onChange}
          />
          <TextField
            name='9'
            value={this.state.value9}
            floatingLabel={true}
            label='With leading icon buttons'
            leadingIcons={[
              <IconButton
                icon={<LeadingIcon />}
                title='Leading action 1'
                onClick={this.onActionClick}
              />,
              <IconButton
                icon={<LeadingIcon />}
                title='Leading action 2'
                onClick={this.onActionClick}
              />,
            ]}
            onChange={this.onChange}
          />
          <TextField
            name='10'
            value={this.state.value10}
            floatingLabel={true}
            label='With trailing icon'
            trailingIcons={[<TrailingIcon />]}
            onChange={this.onChange}
          />
          <TextField
            name='11'
            value={this.state.value11}
            floatingLabel={true}
            label='With trailing icon buttons'
            trailingIcons={[
              <IconButton
                icon={<TrailingIcon />}
                title='Trailing action 1'
                onClick={this.onActionClick}
              />,
              <IconButton
                icon={<TrailingIcon />}
                title='Trailing action 2'
                onClick={this.onActionClick}
              />,
            ]}
            onChange={this.onChange}
          />
          <TextField
            name='12'
            value={this.state.value12}
            floatingLabel={true}
            label='No errors'
            allowErrors={false}
            onChange={this.onChange}
          />
          <TextField
            name='13'
            value={this.state.value13}
            floatingLabel={false}
            label='No errors, no float'
            allowErrors={false}
            onChange={this.onChange}
          />
          <TextField
            name='14'
            value={this.state.value14}
            floatingLabel={true}
            label='Multi-line'
            multiline={true}
            maxRows={4}
            onChange={this.onChange}
          />
          <TextField
            name='15'
            value={this.state.value15}
            floatingLabel={true}
            label='Text area'
            multiline={true}
            rows={4}
            maxRows={4}
            onChange={this.onChange}
          />
          <TextField
            name='16'
            value={this.state.value16}
            floatingLabel={false}
            label='Multi-line, no float'
            multiline={true}
            maxRows={4}
            onChange={this.onChange}
          />
          <TextField
            name='17'
            value={this.state.value17}
            floatingLabel={false}
            label='Text area, no float'
            multiline={true}
            rows={4}
            maxRows={4}
            onChange={this.onChange}
          />
        </StyledCard>
      </Container>
    )
  }

  onChange = event => {
    const { value } = event.target
    const name = event.currentTarget.getAttribute('name')
    const valueKey = `value${name}`

    this.setState({
      [valueKey]: value,
      changeError: name === '4' && value ? 'Omg error' : null,
    })
  }

  onActionClick = () => {
    console.log('Action clicked')
  }
}
