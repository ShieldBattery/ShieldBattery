import { useState } from 'react'
import styled from 'styled-components'
import { RadioCard, RadioCardGroup } from '../radio-card'

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px !important;
  padding-top: 64px !important;
`

const Content = styled.div`
  max-width: 760px;
  margin: 0px auto;
`

const Illustration = styled.span`
  display: block;
  height: 44px;
  border-radius: 4px;
  background-color: var(--theme-skeleton);
`

export function RadioCardTest() {
  const [value, setValue] = useState('ladder')

  return (
    <Container>
      <Content>
        <RadioCardGroup value={value} onChange={setValue} ariaLabel='Game type'>
          <RadioCard
            value='ladder'
            title='Ladder'
            subtitle='Ranked'
            description='Matched against players near your rating. Results count toward your rank.'
            badge='Recommended'
            media={<Illustration />}
          />
          <RadioCard
            value='custom'
            title='Custom'
            subtitle='Unranked'
            description='Pick your own map and settings, and invite whoever you like.'
            media={<Illustration />}
          />
          <RadioCard
            value='practice'
            title='Practice'
            subtitle='Unavailable'
            description='Play against computers on your own.'
            media={<Illustration />}
            disabled={true}
          />
        </RadioCardGroup>
      </Content>
    </Container>
  )
}
