import { useState } from 'react'
import styled from 'styled-components'
import { Card } from '../card'
import { CheckBox } from '../check-box'
import { SelectOption } from '../select/option'
import { Select } from '../select/select'

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

export function SelectsTest() {
  const [value1, setValue1] = useState(2)
  const [value2, setValue2] = useState(5)
  const [value3, setValue3] = useState<number | undefined>(undefined)
  const [value4, setValue4] = useState(1)
  const [value5, setValue5] = useState(1)
  const [value6, setValue6] = useState(1)
  const [value7, setValue7] = useState(1)
  const [dense, setDense] = useState(false)

  const onChange = (key: number, value: number) => {
    switch (key) {
      case 1:
        setValue1(value)
        break
      case 2:
        setValue2(value)
        break
      case 3:
        setValue3(value)
        break
      case 4:
        setValue4(value)
        break
      case 5:
        setValue5(value)
        break
      case 6:
        setValue6(value)
        break
      case 7:
        setValue7(value)
        break
    }
  }

  const onDenseChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDense(event.target.checked)
  }

  return (
    <Container>
      <StyledCard>
        <CheckBox checked={dense} label='Dense' onChange={onDenseChange} />
        <h3>Select some things</h3>
        <Select dense={dense} value={value1} label='First' onChange={value => onChange(1, value)}>
          <SelectOption value={1} text='Menu option 1' />
          <SelectOption value={2} text='Menu option 2' />
          <SelectOption value={3} text='Menu option 3' />
          <SelectOption value={4} text='Menu option 4' />
          <SelectOption value={5} text='Menu option 5' />
          <SelectOption value={6} text='Menu option 6' />
          <SelectOption value={7} text='Menu option 7' />
          <SelectOption value={8} text='Menu option 8' />
        </Select>

        <Select
          dense={dense}
          value={value2}
          disabled={true}
          label='Disabled'
          onChange={value => onChange(2, value)}>
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
          dense={dense}
          value={value3}
          label='No default value'
          onChange={value => onChange(3, value)}>
          <SelectOption value={1} text='Menu option 1' />
          <SelectOption value={2} text='Menu option 2' />
          <SelectOption value={3} text='Menu option 3' />
          <SelectOption value={4} text='Menu option 4' />
        </Select>

        <Select dense={dense} value={value4} onChange={value => onChange(4, value)}>
          <SelectOption value={1} text='No label' />
          <SelectOption value={2} text='Menu option 2' />
        </Select>

        <Select
          dense={dense}
          value={value5}
          allowErrors={false}
          onChange={value => onChange(5, value)}>
          <SelectOption value={1} text='No label, no allow errors' />
          <SelectOption value={2} text='Menu option 2' />
        </Select>

        <Select
          dense={dense}
          value={value6}
          label='No allow errors'
          allowErrors={false}
          onChange={value => onChange(6, value)}>
          <SelectOption value={1} text='Menu option 1' />
          <SelectOption value={2} text='Menu option 2' />
        </Select>

        <Select
          dense={dense}
          value={value7}
          label='With errors'
          errorText='Hi mom'
          onChange={value => onChange(7, value)}>
          <SelectOption value={1} text='Menu option 1' />
          <SelectOption value={2} text='Menu option 2' />
          <SelectOption value={3} text='Menu option 3' />
          <SelectOption value={4} text='Menu option 4' />
        </Select>
      </StyledCard>
    </Container>
  )
}
