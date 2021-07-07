import { Immutable } from 'immer'
import React, { useMemo } from 'react'
import styled from 'styled-components'
import { GameRecordJson } from '../../common/games/games'
import { ReconciledResult } from '../../common/games/results'
import { useSelfUser } from '../auth/state-hooks'
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

export interface MiniMatchHistoryProps {
  games: Immutable<GameRecordJson[]>
}

export function MiniMatchHistory({ games }: MiniMatchHistoryProps) {
  return (
    <MatchHistoryRoot>
      <GameList>
        {games.map((g, i) => (
          <ConnectedGameListEntry key={i} game={g} />
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

const GameListEntryResult = styled.div<{ $result: ReconciledResult }>`
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

export function ConnectedGameListEntry({ game }: { game: Immutable<GameRecordJson> }) {
  const mapName = 'Fighting Spirit 1.3' // This should cover every match :)
  const selfUser = useSelfUser()
  const [buttonProps, rippleRef] = useButtonState({})

  const { results, startTime, config } = game
  const result = useMemo(() => {
    if (!results) {
      return 'unknown'
    }

    for (const [userId, r] of results) {
      if (userId === selfUser.id) {
        return r.result
      }
    }

    return 'unknown'
  }, [results, selfUser])

  // TODO(tec27): Handle more ranked types, show mode (UMS, Top v Bottom, etc.?)
  const matchType = config.gameSource === 'MATCHMAKING' ? 'Ranked 1v1' : 'Custom game'

  return (
    <GameListEntryRoot {...buttonProps}>
      <GameListEntryTextRow $color='primary'>
        <Body2>{mapName}</Body2>
        <GameListEntryResult $result={result}>{result}</GameListEntryResult>
      </GameListEntryTextRow>

      <GameListEntryTextRow $color='secondary'>
        <Body1>{matchType}</Body1>
        <Body1>{timeAgo(Date.now() - startTime)}</Body1>
      </GameListEntryTextRow>

      <Ripple ref={rippleRef} />
    </GameListEntryRoot>
  )
}
