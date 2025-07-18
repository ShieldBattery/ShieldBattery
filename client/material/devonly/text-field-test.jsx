import { Component } from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { IconButton } from '../button'
import { Card } from '../card'
import { CheckBox } from '../check-box'
import { PasswordTextField } from '../password-text-field'
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

const DenseIconButton = styled(IconButton)`
  width: 32px;
  height: 32px;
  min-height: 32px;
  padding: 0;
`

export default class TextFieldTest extends Component {
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
    value18: '',
    value19: '',
    changeError: null,
    dense: false,
  }

  render() {
    return (
      <Container>
        <StyledCard>
          <h3>Type some things</h3>
          <CheckBox checked={this.state.dense} label='Dense' onChange={this.onDenseChange} />
          <TextField
            name='1'
            value={this.state.value1}
            floatingLabel={true}
            dense={this.state.dense}
            label='Label'
            onChange={this.onChange}
          />
          <TextField
            name='2'
            value={this.state.value2}
            floatingLabel={true}
            dense={this.state.dense}
            label='Disabled'
            disabled={true}
            onChange={this.onChange}
          />
          <TextField
            name='3'
            value={this.state.value3}
            floatingLabel={false}
            dense={this.state.dense}
            label='No float'
            onChange={this.onChange}
          />
          <TextField
            name='4'
            value={this.state.value4}
            floatingLabel={true}
            dense={this.state.dense}
            label='Error on change'
            errorText={this.state.changeError}
            onChange={this.onChange}
          />
          <TextField
            name='5'
            value={this.state.value5}
            floatingLabel={true}
            dense={this.state.dense}
            label='Permanent error'
            errorText='hi'
            onChange={this.onChange}
          />
          <TextField
            name='very-long-error'
            value={this.state.value5}
            floatingLabel={true}
            dense={this.state.dense}
            label='Permanent long error'
            errorText={
              'hello this is a very long error message that extends across multiple ' +
              'lines so that we can make sure you can still see the whole thing properly.'
            }
            onChange={this.onChange}
          />
          <TextField
            name='6'
            value={'hi'}
            floatingLabel={true}
            dense={this.state.dense}
            label='Disabled with value'
            disabled={true}
            onChange={this.onChange}
          />
          <TextField
            name='7'
            value={this.state.value7}
            floatingLabel={true}
            dense={this.state.dense}
            label='Disabled with error'
            disabled={true}
            errorText={'hi'}
            onChange={this.onChange}
          />
          <TextField
            name='8'
            value={this.state.value8}
            floatingLabel={true}
            dense={this.state.dense}
            label='With leading icon'
            leadingIcons={[<MaterialIcon icon='view_list' key='view' />]}
            onChange={this.onChange}
          />
          <TextField
            name='9'
            value={this.state.value9}
            floatingLabel={true}
            dense={this.state.dense}
            label='With leading icon buttons'
            leadingIcons={
              this.state.dense
                ? [
                    <DenseIconButton
                      icon={<MaterialIcon icon='view_list' />}
                      title='Leading action 1'
                      onClick={this.onActionClick}
                      key='1'
                    />,
                    <DenseIconButton
                      icon={<MaterialIcon icon='view_list' />}
                      title='Leading action 2'
                      onClick={this.onActionClick}
                      key='2'
                    />,
                  ]
                : [
                    <IconButton
                      icon={<MaterialIcon icon='view_list' />}
                      title='Leading action 1'
                      onClick={this.onActionClick}
                      key='1'
                    />,
                    <IconButton
                      icon={<MaterialIcon icon='view_list' />}
                      title='Leading action 2'
                      onClick={this.onActionClick}
                      key='2'
                    />,
                  ]
            }
            onChange={this.onChange}
          />
          <TextField
            name='10'
            value={this.state.value10}
            floatingLabel={true}
            dense={this.state.dense}
            label='With trailing icon'
            trailingIcons={[<MaterialIcon icon='local_pizza' key='pizza' />]}
            onChange={this.onChange}
          />
          <TextField
            name='11'
            value={this.state.value11}
            floatingLabel={true}
            dense={this.state.dense}
            label='With trailing icon buttons'
            trailingIcons={
              this.state.dense
                ? [
                    <DenseIconButton
                      icon={<MaterialIcon icon='local_pizza' />}
                      title='Trailing action 1'
                      onClick={this.onActionClick}
                      key='1'
                    />,
                    <DenseIconButton
                      icon={<MaterialIcon icon='magic_button' />}
                      title='Trailing action 2'
                      onClick={this.onActionClick}
                      key='2'
                    />,
                  ]
                : [
                    <IconButton
                      icon={<MaterialIcon icon='local_pizza' />}
                      title='Trailing action 1'
                      onClick={this.onActionClick}
                      key='1'
                    />,
                    <IconButton
                      icon={<MaterialIcon icon='magic_button' />}
                      title='Trailing action 2'
                      onClick={this.onActionClick}
                      key='2'
                    />,
                  ]
            }
            onChange={this.onChange}
          />
          <TextField
            name='12'
            value={this.state.value12}
            floatingLabel={true}
            dense={this.state.dense}
            label='No errors'
            allowErrors={false}
            onChange={this.onChange}
          />
          <TextField
            name='13'
            value={this.state.value13}
            floatingLabel={false}
            dense={this.state.dense}
            label='No errors, no float'
            allowErrors={false}
            onChange={this.onChange}
          />
          <PasswordTextField
            name='14'
            value={this.state.value14}
            floatingLabel={true}
            dense={this.state.dense}
            label='Password text field'
            onChange={this.onChange}
          />
          <TextField
            name='15'
            value={this.state.value15}
            floatingLabel={true}
            dense={this.state.dense}
            label='Multi-line'
            multiline={true}
            maxRows={4}
            onChange={this.onChange}
          />
          <TextField
            name='16'
            value={this.state.value16}
            floatingLabel={true}
            dense={this.state.dense}
            label='Text area'
            multiline={true}
            rows={4}
            maxRows={4}
            onChange={this.onChange}
          />
          <TextField
            name='17'
            value={this.state.value17}
            floatingLabel={false}
            dense={this.state.dense}
            label='Multi-line, no float'
            multiline={true}
            maxRows={4}
            onChange={this.onChange}
          />
          <TextField
            name='18'
            value={this.state.value18}
            floatingLabel={false}
            dense={this.state.dense}
            label='Text area, no float'
            multiline={true}
            rows={4}
            maxRows={4}
            onChange={this.onChange}
          />
          <TextField
            name='19'
            value={this.state.value19}
            floatingLabel={true}
            hasClearButton={true}
            dense={this.state.dense}
            label='With clear button'
            onChange={this.onChange}
          />
        </StyledCard>
      </Container>
    )
  }

  onDenseChange = event => {
    this.setState({ dense: event.target.checked })
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
