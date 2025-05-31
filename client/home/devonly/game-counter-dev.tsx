import React, { useState } from 'react'
import styled from 'styled-components'
import { CenteredContentContainer } from '../../styles/centered-container'
import { headlineLarge } from '../../styles/typography'
import { GameCountNumber } from '../game-counter'

const Root = styled(CenteredContentContainer)`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
`

const CountRoot = styled.div`
  ${headlineLarge};
  display: flex;
  align-items: flex-end;
  gap: 4px;
`

const GamesPlayedText = styled.span`
  padding-bottom: 2px;
`

export function GameCounterDev() {
  const [count, setCount] = useState(0)
  return (
    <Root>
      <input type='number' value={count} onChange={e => setCount(e.target.valueAsNumber)} />
      <CountRoot>
        <GameCountNumber value={count} height={44} />
        <GamesPlayedText>games played</GamesPlayedText>
      </CountRoot>
    </Root>
  )
}
