import { useState } from 'react'
import styled from 'styled-components'
import { Card } from '../card'
import { Slider } from '../slider'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

const StyledCard = styled(Card)`
  width: 100%;
  max-width: 640px;
`

export function SliderTest() {
  const [value1, setValue1] = useState(0)
  const [value2, setValue2] = useState(2)
  const [value3, setValue3] = useState(40)
  const [value4, setValue4] = useState(2)
  const [value5, setValue5] = useState(0)
  const [value6, setValue6] = useState(2)
  const [value7, setValue7] = useState(2)
  const [value8, setValue8] = useState(2)
  const [value9, setValue9] = useState(2)

  const onChange = (name: string, value: number) => {
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
        break
      case '5':
        setValue5(value)
        break
      case '6':
        setValue6(value)
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
    }
  }

  return (
    <Container>
      <StyledCard>
        <h3>Slide some things</h3>
        <Slider min={0} max={4} value={value1} step={1} onChange={value => onChange('1', value)} />
        <Slider
          min={0}
          max={4}
          value={value2}
          step={1}
          label='Slide this'
          onChange={value => onChange('2', value)}
        />
        <Slider
          min={10}
          max={100}
          value={value3}
          step={5}
          onChange={value => onChange('3', value)}
        />
        <Slider
          min={10}
          max={100}
          value={50}
          step={5}
          disabled={true}
          onChange={value => onChange('3', value)}
        />
        <Slider min={0} max={4} value={value4} step={1} onChange={value => onChange('4', value)} />
        {/* TODO: no default value */}
        <Slider min={0} max={7} value={value5} step={1} onChange={value => onChange('5', value)} />

        <Slider min={0} max={4} value={value6} onChange={value => onChange('6', value)} />
        <Slider min={0} max={4} value={value7} step={1} onChange={value => onChange('7', value)} />
        <Slider
          min={0}
          max={4}
          value={value8}
          step={1}
          showBalloon={false}
          onChange={value => onChange('8', value)}
        />
        <Slider
          min={0}
          max={4}
          value={value9}
          step={1}
          label='Slide this'
          showBalloon={false}
          onChange={value => onChange('9', value)}
        />
      </StyledCard>
    </Container>
  )
}
