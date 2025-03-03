import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecordJson } from '../../../common/games/games'
import {
  ClientLeagueUserChangeJson,
  LeagueJson,
  makeLeagueId,
} from '../../../common/leagues/leagues'
import {
  makeSeasonId,
  MatchmakingResult,
  MatchmakingSeasonJson,
  MatchmakingType,
  NUM_PLACEMENT_MATCHES,
  PublicMatchmakingRatingChangeJson,
} from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { RaisedButton } from '../../material/button'
import Card from '../../material/card'
import { CheckBox } from '../../material/check-box'
import { NumberTextField } from '../../material/number-text-field'
import { useAppDispatch } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { BodyMedium } from '../../styles/typography'

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

const SEASON: MatchmakingSeasonJson = {
  id: makeSeasonId(1),
  name: 'My Cool Season',
  startDate: Date.now() - 1000 * 60 * 60 * 24 * 7,
  resetMmr: true,
}

const LEAGUES: LeagueJson[] = [
  {
    id: makeLeagueId('arto'),
    name: 'Arto League',
    description: 'The Arto League',
    matchmakingType: MatchmakingType.Match1v1,
    signupsAfter: Date.now(),
    startAt: Date.now(),
    endAt: Date.now(),
  },
  {
    id: makeLeagueId('long'),
    name: 'Very Super Long League Name For Ultimate Testing Thank You',
    description: "Yep, it's long",
    matchmakingType: MatchmakingType.Match1v1,
    signupsAfter: Date.now(),
    startAt: Date.now(),
    endAt: Date.now(),
  },
  {
    id: makeLeagueId('early'),
    name: 'Early League',
    description: 'First in!',
    matchmakingType: MatchmakingType.Match1v1,
    signupsAfter: Date.now() - 1000 * 60 * 60,
    startAt: Date.now() - 1000 * 60 * 60,
    endAt: Date.now() - 1000 * 60 * 60,
  },
  {
    id: makeLeagueId('another'),
    name: 'Yet Another League',
    description: 'Another one',
    matchmakingType: MatchmakingType.Match1v1,
    signupsAfter: Date.now(),
    startAt: Date.now(),
    endAt: Date.now(),
  },
]

const ControlsCard = styled(Card)`
  max-width: 480px;
  margin: 16px;
`

export function PostMatchDialogTest() {
  const dispatch = useAppDispatch()

  const [outcome, setOutcome] = useState<MatchmakingResult>('win')
  const [startingRating, setStartingRating] = useState(1500)
  const [ratingChange, setRatingChange] = useState(75)
  const [startingPoints, setStartingPoints] = useState(6000)
  const [pointsChange, setPointsChange] = useState(96)
  const [bonusPointsUsed, setBonusPointsUsed] = useState(0)
  const [lifetimeGames, setLifetimeGames] = useState(10)
  const [artoLeague, setArtoLeague] = useState(false)
  const [longLeague, setLongLeague] = useState(false)
  const [earlyLeague, setEarlyLeague] = useState(false)
  const [anotherLeague, setAnotherLeague] = useState(false)

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
      rating: lifetimeGames < NUM_PLACEMENT_MATCHES ? 0 : newRating,
      ratingChange: lifetimeGames < NUM_PLACEMENT_MATCHES ? 0 : newRating - startingRating,
      points: newPoints,
      pointsChange: newPoints - startingPoints,
      bonusUsed: bonusPointsUsed,
      bonusUsedChange: -bonusPointsUsed,
      lifetimeGames,
    }
  }, [
    outcome,
    ratingChange,
    startingRating,
    pointsChange,
    startingPoints,
    lifetimeGames,
    bonusPointsUsed,
  ])

  const onClick = useStableCallback(() => {
    const leagueChanges: ClientLeagueUserChangeJson[] = []

    if (artoLeague) {
      leagueChanges.push({
        userId: PLAYER_ID,
        leagueId: makeLeagueId('arto'),
        gameId: GAME_ID,
        changeDate: GAME.startTime + GAME.gameLength!,
        outcome,
        points: startingPoints * 0.85 + mmrChange.pointsChange * 0.85,
        pointsChange: mmrChange.pointsChange * 0.85,
      })
    }
    if (longLeague) {
      leagueChanges.push({
        userId: PLAYER_ID,
        leagueId: makeLeagueId('long'),
        gameId: GAME_ID,
        changeDate: GAME.startTime + GAME.gameLength!,
        outcome,
        points: startingPoints * 0.55 + mmrChange.pointsChange * 0.55,
        pointsChange: mmrChange.pointsChange * 0.55,
      })
    }
    if (earlyLeague) {
      leagueChanges.push({
        userId: PLAYER_ID,
        leagueId: makeLeagueId('early'),
        gameId: GAME_ID,
        changeDate: GAME.startTime + GAME.gameLength!,
        outcome,
        points: startingPoints * 0.15 + mmrChange.pointsChange * 0.15,
        pointsChange: mmrChange.pointsChange * 0.15,
      })
    }
    if (anotherLeague) {
      leagueChanges.push({
        userId: PLAYER_ID,
        leagueId: makeLeagueId('another'),
        gameId: GAME_ID,
        changeDate: GAME.startTime + GAME.gameLength!,
        outcome,
        points: startingPoints * 1.15 + mmrChange.pointsChange * 1.15,
        pointsChange: mmrChange.pointsChange * 1.15,
      })
    }

    dispatch(
      openDialog({
        type: DialogType.PostMatch,
        initData: {
          game: GAME,
          mmrChange,
          leagueChanges,
          leagues: LEAGUES,
          replayPath: undefined,
          season: SEASON,
        },
      }),
    )
  })

  return (
    <div>
      <ControlsCard>
        <BodyMedium>
          Input a desired MMR change to show a dialog for. Point/rating change values will
          automatically change their sign for win/loss, so always input positive amounts.
        </BodyMedium>
        <CheckBox
          name='outcome'
          label='Win?'
          checked={outcome === 'win'}
          onChange={(event: React.ChangeEvent) =>
            setOutcome((event.currentTarget as HTMLInputElement).checked ? 'win' : 'loss')
          }
        />
        <CheckBox
          name='artoleague'
          label='Include Arto League?'
          checked={artoLeague}
          onChange={(event: React.ChangeEvent) =>
            setArtoLeague((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <CheckBox
          name='longleague'
          label='Include Long League?'
          checked={longLeague}
          onChange={(event: React.ChangeEvent) =>
            setLongLeague((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <CheckBox
          name='earlyleague'
          label='Include Early League?'
          checked={earlyLeague}
          onChange={(event: React.ChangeEvent) =>
            setEarlyLeague((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <CheckBox
          name='anotherleague'
          label='Include Another League?'
          checked={anotherLeague}
          onChange={(event: React.ChangeEvent) =>
            setAnotherLeague((event.currentTarget as HTMLInputElement).checked)
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
        <NumberTextField
          label='Bonus points used'
          floatingLabel={true}
          value={bonusPointsUsed}
          onChange={setBonusPointsUsed}
        />
        <NumberTextField
          label='Lifetime games'
          floatingLabel={true}
          value={lifetimeGames}
          onChange={setLifetimeGames}
        />
        <RaisedButton label='Show dialog' onClick={onClick} />
      </ControlsCard>
    </div>
  )
}
