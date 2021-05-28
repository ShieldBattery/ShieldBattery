import React, { useMemo } from 'react'
import styled from 'styled-components'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import {
  background700,
  colorNegative,
  colorPositive,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { Body1, Body2, body2 } from '../styles/typography'
import { timeAgo } from '../time/time-ago'

const MatchHistoryRoot = styled.div`
  margin-bottom: 48px;
  /** 8 + 16px of internal padding in list = 24px */
  padding: 0 24px 0 8px;

  display: flex;
`

const GameList = styled.div`
  margin-right: 8px;
  flex-grow: 1;
`

const GamePreview = styled.div`
  width: 276px;
  flex-shrink: 0;

  background-color: ${background700};
  border-radius: 4px;
`

interface DummyGameReplaceWithRealThing {
  mapName: string
  matchType: string
  result: 'win' | 'loss' | 'unknown'
  date: Date
}

export function MatchHistory() {
  const games: DummyGameReplaceWithRealThing[] = useMemo(
    () => [
      { mapName: 'Bluebastic Demon', matchType: 'Ranked 1v1', result: 'win', date: new Date() },
      {
        mapName: 'Lost Temple',
        matchType: 'Ranked 2v2',
        result: 'loss',
        date: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        mapName: 'Micro Tournament 2.7',
        matchType: 'Custom Lobby',
        result: 'win',
        date: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        mapName: 'Fighting Spirit',
        matchType: 'Ranked 1v1',
        result: 'loss',
        date: new Date(Date.now() - 27 * 60 * 60 * 1000),
      },
      {
        mapName: 'Big Game Hunters',
        matchType: 'Ranked 3v3',
        result: 'unknown',
        date: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    ],
    [],
  )

  return (
    <MatchHistoryRoot>
      <GameList>
        {games.map((g, i) => (
          <GameListEntry key={i} {...g} />
        ))}
      </GameList>
      <GamePreview></GamePreview>
    </MatchHistoryRoot>
  )
}

const GameListEntryRoot = styled.button`
  ${buttonReset};

  width: 100%;
  height: 64px;
  padding: 12px 16px;

  border-radius: 4px;
  text-align: left;

  & + & {
    margin-top: 8px;
  }
`

const GameListEntryTextRow = styled.div<{ $color?: 'primary' | 'secondary' }>`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: ${props => (props.$color === 'secondary' ? colorTextSecondary : colorTextPrimary)};
`

const GameListEntryResult = styled.div<{ $result: 'win' | 'loss' | 'unknown' }>`
  ${body2};
  color: ${props => {
    switch (props.$result) {
      case 'win':
        return colorPositive
      case 'loss':
        return colorNegative
      default:
        return colorTextFaint
    }
  }};
  text-transform: capitalize;
`

export function GameListEntry({ mapName, matchType, result, date }: DummyGameReplaceWithRealThing) {
  const [buttonProps, rippleRef] = useButtonState({})

  return (
    <GameListEntryRoot {...buttonProps}>
      <GameListEntryTextRow $color='primary'>
        <Body2>{mapName}</Body2>
        <GameListEntryResult $result={result}>{result}</GameListEntryResult>
      </GameListEntryTextRow>

      <GameListEntryTextRow $color='secondary'>
        <Body1>{matchType}</Body1>
        <Body1>{timeAgo(Date.now() - Number(date))}</Body1>
      </GameListEntryTextRow>

      <Ripple ref={rippleRef} />
    </GameListEntryRoot>
  )
}
