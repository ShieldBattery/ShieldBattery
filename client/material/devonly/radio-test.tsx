import React, { useState } from 'react'
import styled from 'styled-components'
import { range } from '../../../common/range'
import { colorTextFaint, colorTextSecondary } from '../../styles/colors'
import { overline } from '../../styles/typography'
import { RadioButton, RadioGroup } from '../radio'

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px !important;
  padding-top: 64px !important;
`

const Content = styled.div`
  position: relative;
  height: 80%;
  max-width: 960px;
  min-height: 512px;
  margin: 0px auto;
  border-left: var(--pixel-shove-x, 0) solid transparent;
`

const RadioOverline = styled.div`
  ${overline};
  color: ${colorTextSecondary};

  padding: 8px 14px;
`

const CustomLargeLabel = styled.div`
  width: 100%;
  max-width: 600px;
  height: 140px;
  background-color: ${colorTextFaint};
  border-radius: 2px;
`

export function RadioTest() {
  const [selectedButton, setSelectedButton] = useState(0)

  return (
    <Container>
      <Content>
        <RadioOverline>Select a language</RadioOverline>
        <RadioGroup value={selectedButton} onChange={setSelectedButton}>
          <RadioButton label='English' value={0} />
          <RadioButton label='Spanish' value={1} />
          <RadioButton label='Korean' value={2} />
          <RadioButton label='Chinese' value={3} disabled={true} />
          <RadioButton label='German' value={4} />
          <RadioButton label='Russian' value={5} />
          <RadioButton label={Array.from(range(0, 100), () => 'Repeated').join(' ')} value={6} />
          <RadioButton label={<CustomLargeLabel />} value={7} />
        </RadioGroup>
      </Content>
    </Container>
  )
}
