import { useState } from 'react'
import styled from 'styled-components'
import { FilledButton } from '../../material/button'
import { Card } from '../../material/card'
import {
  colorContainer,
  colorContainerHighest,
  colorContainerLowest,
  grey10,
} from '../../styles/colors'
import { headlineSmall, labelMedium } from '../../styles/typography'
import { DotsIndicator, LoadingDotsArea } from '../dots'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 800px;
  padding: 24px;
`

const SectionTitle = styled.div`
  ${headlineSmall};
`

const SurfaceRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
`

const Surface = styled.div<{ $color: string }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px;
  background-color: ${props => props.$color};
  border-radius: 8px;
`

const SurfaceLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const Magnified = styled.div`
  display: flex;
  justify-content: center;
  padding: 64px 0;

  & > * {
    transform: scale(4);
  }
`

const DelayedDemo = styled(Card)`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
`

export function DotsTest() {
  const [mountKey, setMountKey] = useState(0)

  return (
    <Root>
      <SectionTitle>On surfaces</SectionTitle>
      <SurfaceRow>
        <Surface $color={grey10}>
          <SurfaceLabel>app background</SurfaceLabel>
          <DotsIndicator showImmediately={true} />
        </Surface>
        <Surface $color={colorContainerLowest}>
          <SurfaceLabel>container lowest</SurfaceLabel>
          <DotsIndicator showImmediately={true} />
        </Surface>
        <Surface $color={colorContainer}>
          <SurfaceLabel>container</SurfaceLabel>
          <DotsIndicator showImmediately={true} />
        </Surface>
        <Surface $color={colorContainerHighest}>
          <SurfaceLabel>container highest</SurfaceLabel>
          <DotsIndicator showImmediately={true} />
        </Surface>
      </SurfaceRow>

      <SectionTitle>Magnified (4x)</SectionTitle>
      <Magnified>
        <DotsIndicator showImmediately={true} />
      </Magnified>

      <SectionTitle>LoadingDotsArea</SectionTitle>
      <Card>
        <LoadingDotsArea showImmediately={true} />
      </Card>

      <SectionTitle>Delayed reveal</SectionTitle>
      <DelayedDemo>
        <FilledButton label='Remount' onClick={() => setMountKey(k => k + 1)} />
        <DotsIndicator key={mountKey} />
      </DelayedDemo>
    </Root>
  )
}
