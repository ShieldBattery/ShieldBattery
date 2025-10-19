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
  const [value6, setValue6] = useState('')
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

  return (
    <Container>
      <StyledCard>
        <h3>Type some things</h3>
        <CheckBox
          checked={dense}
          label='Dense'
          onChange={event => setDense(event.target.checked)}
        />
        <TextField
          name='1'
          value={value1}
          floatingLabel={true}
          dense={dense}
          label='Label'
          onChange={event => setValue1(event.target.value)}
        />
        <TextField
          name='2'
          value={value2}
          floatingLabel={true}
          dense={dense}
          label='Disabled'
          disabled={true}
          onChange={event => setValue2(event.target.value)}
        />
        <TextField
          name='3'
          value={value3}
          floatingLabel={false}
          dense={dense}
          label='No float'
          onChange={event => setValue3(event.target.value)}
        />
        <TextField
          name='4'
          value={value4}
          floatingLabel={true}
          dense={dense}
          label='Error on change'
          errorText={changeError}
          onChange={event => {
            setValue4(event.target.value)
            setChangeError(event.target.value ? 'Omg error' : undefined)
          }}
        />
        <TextField
          name='5'
          value={value5}
          floatingLabel={true}
          dense={dense}
          label='Permanent error'
          errorText='hi'
          onChange={event => setValue5(event.target.value)}
        />
        <TextField
          name='very-long-error'
          value={value6}
          floatingLabel={true}
          dense={dense}
          label='Permanent long error'
          errorText={
            'hello this is a very long error message that extends across multiple ' +
            'lines so that we can make sure you can still see the whole thing properly.'
          }
          onChange={event => setValue6(event.target.value)}
        />
        <TextField
          name='6'
          value={'hi'}
          floatingLabel={true}
          dense={dense}
          label='Disabled with value'
          disabled={true}
        />
        <TextField
          name='7'
          value={value7}
          floatingLabel={true}
          dense={dense}
          label='Disabled with error'
          disabled={true}
          errorText={'hi'}
          onChange={event => setValue7(event.target.value)}
        />
        <TextField
          name='8'
          value={value8}
          floatingLabel={true}
          dense={dense}
          label='With leading icon'
          leadingIcons={[<MaterialIcon icon='view_list' key='view' />]}
          onChange={event => setValue8(event.target.value)}
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
                    onClick={() => {}}
                    key='1'
                  />,
                  <DenseIconButton
                    icon={<MaterialIcon icon='view_list' />}
                    title='Leading action 2'
                    onClick={() => {}}
                    key='2'
                  />,
                ]
              : [
                  <IconButton
                    icon={<MaterialIcon icon='view_list' />}
                    title='Leading action 1'
                    onClick={() => {}}
                    key='1'
                  />,
                  <IconButton
                    icon={<MaterialIcon icon='view_list' />}
                    title='Leading action 2'
                    onClick={() => {}}
                    key='2'
                  />,
                ]
          }
          onChange={event => setValue9(event.target.value)}
        />
        <TextField
          name='10'
          value={value10}
          floatingLabel={true}
          dense={dense}
          label='With trailing icon'
          trailingIcons={[<MaterialIcon icon='local_pizza' key='pizza' />]}
          onChange={event => setValue10(event.target.value)}
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
                    onClick={() => {}}
                    key='1'
                  />,
                  <DenseIconButton
                    icon={<MaterialIcon icon='magic_button' />}
                    title='Trailing action 2'
                    onClick={() => {}}
                    key='2'
                  />,
                ]
              : [
                  <IconButton
                    icon={<MaterialIcon icon='local_pizza' />}
                    title='Trailing action 1'
                    onClick={() => {}}
                    key='1'
                  />,
                  <IconButton
                    icon={<MaterialIcon icon='magic_button' />}
                    title='Trailing action 2'
                    onClick={() => {}}
                    key='2'
                  />,
                ]
          }
          onChange={event => setValue11(event.target.value)}
        />
        <TextField
          name='12'
          value={value12}
          floatingLabel={true}
          dense={dense}
          label='No errors'
          allowErrors={false}
          onChange={event => setValue12(event.target.value)}
        />
        <TextField
          name='13'
          value={value13}
          floatingLabel={false}
          dense={dense}
          label='No errors, no float'
          allowErrors={false}
          onChange={event => setValue13(event.target.value)}
        />
        <PasswordTextField
          name='14'
          value={value14}
          floatingLabel={true}
          dense={dense}
          label='Password text field'
          onChange={event => setValue14(event.target.value)}
        />
        <TextField
          name='15'
          value={value15}
          floatingLabel={true}
          dense={dense}
          label='Multi-line'
          multiline={true}
          maxRows={4}
          onChange={event => setValue15(event.target.value)}
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
          onChange={event => setValue16(event.target.value)}
        />
        <TextField
          name='17'
          value={value17}
          floatingLabel={false}
          dense={dense}
          label='Multi-line, no float'
          multiline={true}
          maxRows={4}
          onChange={event => setValue17(event.target.value)}
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
          onChange={event => setValue18(event.target.value)}
        />
        <TextField
          name='19'
          value={value19}
          floatingLabel={true}
          hasClearButton={true}
          dense={dense}
          label='With clear button'
          onChange={event => setValue19(event.target.value)}
        />
      </StyledCard>
    </Container>
  )
}
