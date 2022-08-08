import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { GameSource, GameType } from '../../../common/games/configuration'
import { GameRecordJson } from '../../../common/games/games'
import {
  MatchmakingResult,
  MatchmakingType,
  PublicMatchmakingRatingChangeJson,
} from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { RaisedButton } from '../../material/button'
import Card from '../../material/card'
import CheckBox from '../../material/check-box'
import { NumberTextField } from '../../material/number-text-field'
import { useAppDispatch } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { Body1 } from '../../styles/typography'

const GAME_ID = 'asdf-1234'
const PLAYER_ID = makeSbUserId(1)
const OPPONENT_ID = makeSbUserId(2)

const GAME: GameRecordJson = {
  id: GAME_ID,
  startTime: Number(new Date()),
  mapId: 'asdf-1234',
  config: {
    gameSource: GameSource.Matchmaking,
    gameSourceExtra: {
      type: MatchmakingType.Match1v1,
    },
    gameType: GameType.OneVsOne,
    gameSubType: 0,
    teams: [
      [
        { id: PLAYER_ID, race: 'p', isComputer: false },
        { id: OPPONENT_ID, race: 'z', isComputer: false },
      ],
    ],
  },
  disputable: false,
  disputeRequested: false,
  disputeReviewed: false,
  gameLength: 2700,
  results: [
    [PLAYER_ID, { result: 'win', race: 'p', apm: 27 }],
    [OPPONENT_ID, { result: 'loss', race: 'z', apm: 350 }],
  ],
}

const ControlsCard = styled(Card)`
  max-width: 480px;
  margin: 16px;
`

export function PostMatchDialogTest() {
  const dispatch = useAppDispatch()

  const [outcome, setOutcome] = useState<MatchmakingResult>('win')
  const [startingRating, setStartingRating] = useState(1500)
  const [ratingChange, setRatingChange] = useState(75)
  const [startingPoints, setStartingPoints] = useState(200)
  const [pointsChange, setPointsChange] = useState(96)

  const mmrChange = useMemo<PublicMatchmakingRatingChangeJson>(() => {
    const signedRatingChange = outcome === 'win' ? ratingChange : -ratingChange
    const newRating = Math.max(startingRating + signedRatingChange, 0)

    const signedPointsChange = outcome === 'win' ? pointsChange : -pointsChange
    const newPoints = Math.max(startingPoints + signedPointsChange, 0)

    return {
      userId: PLAYER_ID,
      matchmakingType: MatchmakingType.Match1v1,
      gameId: GAME_ID,
      changeDate: GAME.startTime + GAME.gameLength!,
      outcome,
      rating: newRating,
      ratingChange: newRating - startingRating,
      points: newPoints,
      pointsChange: newPoints - startingPoints,
      bonusUsed: 0,
      bonusUsedChange: 0,
    }
  }, [outcome, ratingChange, startingRating, pointsChange, startingPoints])

  const onClick = useStableCallback(() => {
    dispatch(
      openDialog({
        type: DialogType.PostMatch,
        initData: {
          game: GAME,
          mmrChange,
          replayPath: undefined,
        },
      }),
    )
  })

  return (
    <div>
      <ControlsCard>
        <Body1>
          Input a desired MMR change to show a dialog for. Point/rating change values will
          automatically change their sign for win/loss, so always input positive amounts.
        </Body1>
        <CheckBox
          name='outcome'
          label='Win?'
          checked={outcome === 'win'}
          onChange={(event: React.ChangeEvent) =>
            setOutcome((event.currentTarget as HTMLInputElement).checked ? 'win' : 'loss')
          }
        />
        <NumberTextField
          label='Starting rating'
          floatingLabel={true}
          value={startingRating}
          onChange={setStartingRating}
        />
        <NumberTextField
          label='Rating change (always positive)'
          floatingLabel={true}
          value={ratingChange}
          onChange={setRatingChange}
        />
        <NumberTextField
          label='Starting points'
          floatingLabel={true}
          value={startingPoints}
          onChange={setStartingPoints}
        />
        <NumberTextField
          label='Points change (always positive)'
          floatingLabel={true}
          value={pointsChange}
          onChange={setPointsChange}
        />
        <RaisedButton label='Show dialog' onClick={onClick} />
      </ControlsCard>
    </div>
  )
}
