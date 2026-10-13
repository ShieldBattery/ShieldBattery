import { useState } from 'react'
import styled from 'styled-components'
import { OnOffSegmentedButtons, SegmentedButtonGroup } from '../segmented-button'

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px !important;
  padding-top: 64px !important;
`

const Content = styled.div`
  max-width: 960px;
  margin: 0px auto;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
`

enum Speed {
  Slow = 'slow',
  Normal = 'normal',
  Fast = 'fast',
  Fastest = 'fastest',
}

export function SegmentedButtonTest() {
  const [on, setOn] = useState(true)
  const [speed, setSpeed] = useState(Speed.Fastest)

  return (
    <Container>
      <Content>
        <OnOffSegmentedButtons value={on} onChange={setOn} ariaLabel='Enabled' />
        <OnOffSegmentedButtons
          value={on}
          onChange={setOn}
          ariaLabel='Enabled (disabled)'
          disabled={true}
        />
        <SegmentedButtonGroup
          ariaLabel='Game speed'
          value={speed}
          onChange={setSpeed}
          segments={[
            { value: Speed.Slow, label: 'Slow' },
            { value: Speed.Normal, label: 'Normal' },
            { value: Speed.Fast, label: 'Fast' },
            { value: Speed.Fastest, label: 'Fastest' },
          ]}
        />
      </Content>
    </Container>
  )
}
