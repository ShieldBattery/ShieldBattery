import { useState } from 'react'
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

export function TextFieldTest() {
  const [value1, setValue1] = useState('')
  const [value2, setValue2] = useState('')
  const [value3, setValue3] = useState('')
  const [value4, setValue4] = useState('')
  const [value5, setValue5] = useState('')
  const [value7, setValue7] = useState('')
  const [value8, setValue8] = useState('')
  const [value9, setValue9] = useState('')
  const [value10, setValue10] = useState('')
  const [value11, setValue11] = useState('')
  const [value12, setValue12] = useState('')
  const [value13, setValue13] = useState('')
  const [value14, setValue14] = useState('')
  const [value15, setValue15] = useState('')
  const [value16, setValue16] = useState('')
  const [value17, setValue17] = useState('')
  const [value18, setValue18] = useState('')
  const [value19, setValue19] = useState('')
  const [changeError, setChangeError] = useState<string>()
  const [dense, setDense] = useState(false)

  const onDenseChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDense(event.target.checked)
  }

  const onChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { value } = event.target
    const name = event.currentTarget.getAttribute('name')

    switch (name) {
      case '1':
        setValue1(value)
        break
      case '2':
        setValue2(value)
        break
      case '3':
        setValue3(value)
        break
      case '4':
        setValue4(value)
        setChangeError(value ? 'Omg error' : undefined)
        break
      case '5':
      case 'very-long-error':
        setValue5(value)
        break
      case '7':
        setValue7(value)
        break
      case '8':
        setValue8(value)
        break
      case '9':
        setValue9(value)
        break
      case '10':
        setValue10(value)
        break
      case '11':
        setValue11(value)
        break
      case '12':
        setValue12(value)
        break
      case '13':
        setValue13(value)
        break
      case '14':
        setValue14(value)
        break
      case '15':
        setValue15(value)
        break
      case '16':
        setValue16(value)
        break
      case '17':
        setValue17(value)
        break
      case '18':
        setValue18(value)
        break
      case '19':
        setValue19(value)
        break
    }
  }

  const onActionClick = () => {
    console.log('Action clicked')
  }

  return (
    <Container>
      <StyledCard>
        <h3>Type some things</h3>
        <CheckBox checked={dense} label='Dense' onChange={onDenseChange} />
        <TextField
          name='1'
          value={value1}
          floatingLabel={true}
          dense={dense}
          label='Label'
          onChange={onChange}
        />
        <TextField
          name='2'
          value={value2}
          floatingLabel={true}
          dense={dense}
          label='Disabled'
          disabled={true}
          onChange={onChange}
        />
        <TextField
          name='3'
          value={value3}
          floatingLabel={false}
          dense={dense}
          label='No float'
          onChange={onChange}
        />
        <TextField
          name='4'
          value={value4}
          floatingLabel={true}
          dense={dense}
          label='Error on change'
          errorText={changeError}
          onChange={onChange}
        />
        <TextField
          name='5'
          value={value5}
          floatingLabel={true}
          dense={dense}
          label='Permanent error'
          errorText='hi'
          onChange={onChange}
        />
        <TextField
          name='very-long-error'
          value={value5}
          floatingLabel={true}
          dense={dense}
          label='Permanent long error'
          errorText={
            'hello this is a very long error message that extends across multiple ' +
            'lines so that we can make sure you can still see the whole thing properly.'
          }
          onChange={onChange}
        />
        <TextField
          name='6'
          value={'hi'}
          floatingLabel={true}
          dense={dense}
          label='Disabled with value'
          disabled={true}
          onChange={onChange}
        />
        <TextField
          name='7'
          value={value7}
          floatingLabel={true}
          dense={dense}
          label='Disabled with error'
          disabled={true}
          errorText={'hi'}
          onChange={onChange}
        />
        <TextField
          name='8'
          value={value8}
          floatingLabel={true}
          dense={dense}
          label='With leading icon'
          leadingIcons={[<MaterialIcon icon='view_list' key='view' />]}
          onChange={onChange}
        />
        <TextField
          name='9'
          value={value9}
          floatingLabel={true}
          dense={dense}
          label='With leading icon buttons'
          leadingIcons={
            dense
              ? [
                  <DenseIconButton
                    icon={<MaterialIcon icon='view_list' />}
                    title='Leading action 1'
                    onClick={onActionClick}
                    key='1'
                  />,
                  <DenseIconButton
                    icon={<MaterialIcon icon='view_list' />}
                    title='Leading action 2'
                    onClick={onActionClick}
                    key='2'
                  />,
                ]
              : [
                  <IconButton
                    icon={<MaterialIcon icon='view_list' />}
                    title='Leading action 1'
                    onClick={onActionClick}
                    key='1'
                  />,
                  <IconButton
                    icon={<MaterialIcon icon='view_list' />}
                    title='Leading action 2'
                    onClick={onActionClick}
                    key='2'
                  />,
                ]
          }
          onChange={onChange}
        />
        <TextField
          name='10'
          value={value10}
          floatingLabel={true}
          dense={dense}
          label='With trailing icon'
          trailingIcons={[<MaterialIcon icon='local_pizza' key='pizza' />]}
          onChange={onChange}
        />
        <TextField
          name='11'
          value={value11}
          floatingLabel={true}
          dense={dense}
          label='With trailing icon buttons'
          trailingIcons={
            dense
              ? [
                  <DenseIconButton
                    icon={<MaterialIcon icon='local_pizza' />}
                    title='Trailing action 1'
                    onClick={onActionClick}
                    key='1'
                  />,
                  <DenseIconButton
                    icon={<MaterialIcon icon='magic_button' />}
                    title='Trailing action 2'
                    onClick={onActionClick}
                    key='2'
                  />,
                ]
              : [
                  <IconButton
                    icon={<MaterialIcon icon='local_pizza' />}
                    title='Trailing action 1'
                    onClick={onActionClick}
                    key='1'
                  />,
                  <IconButton
                    icon={<MaterialIcon icon='magic_button' />}
                    title='Trailing action 2'
                    onClick={onActionClick}
                    key='2'
                  />,
                ]
          }
          onChange={onChange}
        />
        <TextField
          name='12'
          value={value12}
          floatingLabel={true}
          dense={dense}
          label='No errors'
          allowErrors={false}
          onChange={onChange}
        />
        <TextField
          name='13'
          value={value13}
          floatingLabel={false}
          dense={dense}
          label='No errors, no float'
          allowErrors={false}
          onChange={onChange}
        />
        <PasswordTextField
          name='14'
          value={value14}
          floatingLabel={true}
          dense={dense}
          label='Password text field'
          onChange={onChange}
        />
        <TextField
          name='15'
          value={value15}
          floatingLabel={true}
          dense={dense}
          label='Multi-line'
          multiline={true}
          maxRows={4}
          onChange={onChange}
        />
        <TextField
          name='16'
          value={value16}
          floatingLabel={true}
          dense={dense}
          label='Text area'
          multiline={true}
          rows={4}
          maxRows={4}
          onChange={onChange}
        />
        <TextField
          name='17'
          value={value17}
          floatingLabel={false}
          dense={dense}
          label='Multi-line, no float'
          multiline={true}
          maxRows={4}
          onChange={onChange}
        />
        <TextField
          name='18'
          value={value18}
          floatingLabel={false}
          dense={dense}
          label='Text area, no float'
          multiline={true}
          rows={4}
          maxRows={4}
          onChange={onChange}
        />
        <TextField
          name='19'
          value={value19}
          floatingLabel={true}
          hasClearButton={true}
          dense={dense}
          label='With clear button'
          onChange={onChange}
        />
      </StyledCard>
    </Container>
  )
}
