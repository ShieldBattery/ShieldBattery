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

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const CompactSlider = styled(Slider)`
  width: 156px;
`

export function SliderTest() {
  const [value1, setValue1] = useState(2)
  const [value2, setValue2] = useState(0)
  const [value3, setValue3] = useState(3)
  const [value4, setValue4] = useState(0.5)
  const [value5, setValue5] = useState(40)
  const [value6, setValue6] = useState(240)
  const [value7, setValue7] = useState(1.5)

  return (
    <Container>
      <StyledCard>
        <h3>Slide some things</h3>
        <Slider
          min={0}
          max={4}
          value={value1}
          label='Discrete'
          onChange={value => setValue1(value)}
        />
        <Slider min={0} max={4} value={value2} onChange={value => setValue2(value)} />
        <Slider
          min={0}
          max={6}
          value={value3}
          label='Discrete, 7 stops'
          onChange={value => setValue3(value)}
        />
        <Slider
          min={0.25}
          max={1}
          step={0.125}
          value={value4}
          label='Fractional steps, no stop labels'
          showStopLabels={false}
          formatValue={value => `${value * 100}%`}
          onChange={value => setValue4(value)}
        />
        <Slider
          min={0}
          max={100}
          step={5}
          value={value5}
          label='Continuous'
          onChange={value => setValue5(value)}
        />
        <Slider
          min={100}
          max={1000}
          value={value6}
          label='Continuous, many steps'
          formatValue={value => `${value} fps`}
          onChange={value => setValue6(value)}
        />
        <Slider
          min={0}
          max={4}
          value={2}
          label='Disabled discrete'
          disabled={true}
          onChange={() => {}}
        />
        <Slider
          min={0}
          max={100}
          step={5}
          value={50}
          label='Disabled continuous'
          disabled={true}
          onChange={() => {}}
        />
        <CompactSlider
          min={1}
          max={4}
          step={0.1}
          value={value7}
          size='compact'
          ariaLabel='Compact'
          onChange={value => setValue7(value)}
        />
      </StyledCard>
    </Container>
  )
}
