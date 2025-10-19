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
  const [value3, setValue3] = useState<number>()
  const [value4, setValue4] = useState(1)
  const [value5, setValue5] = useState(1)
  const [value6, setValue6] = useState(1)
  const [value7, setValue7] = useState(1)
  const [dense, setDense] = useState(false)

  return (
    <Container>
      <StyledCard>
        <CheckBox
          checked={dense}
          label='Dense'
          onChange={event => setDense(event.target.checked)}
        />
        <h3>Select some things</h3>
        <Select dense={dense} value={value1} label='First' onChange={value => setValue1(value)}>
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
          onChange={value => setValue2(value)}>
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
          onChange={value => setValue3(value)}>
          <SelectOption value={1} text='Menu option 1' />
          <SelectOption value={2} text='Menu option 2' />
          <SelectOption value={3} text='Menu option 3' />
          <SelectOption value={4} text='Menu option 4' />
        </Select>

        <Select dense={dense} value={value4} onChange={value => setValue4(value)}>
          <SelectOption value={1} text='No label' />
          <SelectOption value={2} text='Menu option 2' />
        </Select>

        <Select
          dense={dense}
          value={value5}
          allowErrors={false}
          onChange={value => setValue5(value)}>
          <SelectOption value={1} text='No label, no allow errors' />
          <SelectOption value={2} text='Menu option 2' />
        </Select>

        <Select
          dense={dense}
          value={value6}
          label='No allow errors'
          allowErrors={false}
          onChange={value => setValue6(value)}>
          <SelectOption value={1} text='Menu option 1' />
          <SelectOption value={2} text='Menu option 2' />
        </Select>

        <Select
          dense={dense}
          value={value7}
          label='With errors'
          errorText='Hi mom'
          onChange={value => setValue7(value)}>
          <SelectOption value={1} text='Menu option 1' />
          <SelectOption value={2} text='Menu option 2' />
          <SelectOption value={3} text='Menu option 3' />
          <SelectOption value={4} text='Menu option 4' />
        </Select>
      </StyledCard>
    </Container>
  )
}
