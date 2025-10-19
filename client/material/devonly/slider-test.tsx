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
  const [value4, setValue4] = useState(50)
  const [value5, setValue5] = useState(0)
  const [value6, setValue6] = useState(2)
  const [value7, setValue7] = useState(2)
  const [value8, setValue8] = useState(2)
  const [value9, setValue9] = useState(2)

  return (
    <Container>
      <StyledCard>
        <h3>Slide some things</h3>
        <Slider min={0} max={4} value={value1} step={1} onChange={value => setValue1(value)} />
        <Slider
          min={0}
          max={4}
          value={value2}
          step={1}
          label='Slide this'
          onChange={value => setValue2(value)}
        />
        <Slider min={10} max={100} value={value3} step={5} onChange={value => setValue3(value)} />
        <Slider
          min={10}
          max={100}
          value={value4}
          step={5}
          disabled={true}
          onChange={value => setValue4(value)}
        />
        <Slider min={0} max={4} value={value5} step={1} onChange={value => setValue5(value)} />
        {/* TODO: no default value */}
        <Slider min={0} max={7} value={value6} step={1} onChange={value => setValue6(value)} />

        <Slider min={0} max={4} value={value7} step={1} onChange={value => setValue7(value)} />
        <Slider
          min={0}
          max={4}
          value={value8}
          step={1}
          showBalloon={false}
          onChange={value => setValue8(value)}
        />
        <Slider
          min={0}
          max={4}
          value={value9}
          step={1}
          label='Slide this'
          showBalloon={false}
          onChange={value => setValue9(value)}
        />
      </StyledCard>
    </Container>
  )
}
