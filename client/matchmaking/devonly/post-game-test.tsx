import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameSource, MatchmakingGameConfig } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecordJson, getGameDurationString } from '../../../common/games/games'
import { makeMatchupString } from '../../../common/games/matchups'
import {
  ClientLeagueUserChangeJson,
  LeagueJson,
  makeLeagueId,
} from '../../../common/leagues/leagues'
import { makeSbMapId, MapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  makeSeasonId,
  MatchmakingResult,
  MatchmakingSeasonJson,
  MatchmakingType,
  matchmakingTypeToLabel,
  NUM_PLACEMENT_MATCHES,
  PublicMatchmakingRatingChangeJson,
} from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { PostGameHero } from '../../games/post-game-hero'
import { getPostGameMatchup } from '../../games/post-game-matchup'
import { FilledButton } from '../../material/button'
import { Card } from '../../material/card'
import { CheckBox } from '../../material/check-box'
import { NumberTextField } from '../../material/number-text-field'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { BodyMedium } from '../../styles/typography'
import { PostGameRating } from '../post-game-rating'

const GAME_ID = 'asdf-1234'
const PLAYER_ID = makeSbUserId(1)
const OPPONENT_ID = makeSbUserId(2)

const GAME_CONFIG: MatchmakingGameConfig = {
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
}

const GAME: GameRecordJson = {
  id: GAME_ID,
  startTime: Number(new Date()),
  mapId: makeSbMapId('asdf-1234'),
  config: GAME_CONFIG,
  disputable: false,
  disputeRequested: false,
  disputeReviewed: false,
  gameLength: 2700,
  results: [
    [PLAYER_ID, { result: 'win', race: 'p', apm: 27 }],
    [OPPONENT_ID, { result: 'loss', race: 'z', apm: 350 }],
  ],
  selectedMatchup: makeMatchupString('p-z'),
  assignedMatchup: makeMatchupString('p-z'),
  manuallyResolved: false,
}

const SEASON: MatchmakingSeasonJson = {
  id: makeSeasonId(1),
  name: 'My Cool Season',
  startDate: Date.now() - 1000 * 60 * 60 * 24 * 7,
  resetMmr: true,
  divisionTableVersion: 2,
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

const MAP_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'>
      <rect width='1024' height='1024' fill='#3a6b35'/>
      <circle cx='256' cy='256' r='180' fill='#8a7a4a'/>
      <circle cx='768' cy='768' r='180' fill='#8a7a4a'/>
      <rect x='420' y='0' width='180' height='1024' fill='#4a7a8a'/>
    </svg>`,
  )

const MAP = {
  id: makeSbMapId('asdf-1234'),
  name: 'Fighting Spirit',
  image1024Url: MAP_IMAGE,
} as unknown as MapInfoJson

const ControlsCard = styled(Card)`
  max-width: 480px;
  margin: 16px;
`

const Preview = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

export function PostGameTest() {
  const { t } = useTranslation()

  const [playCount, setPlayCount] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [showMapImage, setShowMapImage] = useState(true)
  const [matchmakingType, setMatchmakingType] = useState(MatchmakingType.Match1v1)
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
      matchmakingType,
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
    matchmakingType,
    outcome,
    ratingChange,
    startingRating,
    pointsChange,
    startingPoints,
    lifetimeGames,
    bonusPointsUsed,
  ])

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

  return (
    <div>
      <ControlsCard>
        <BodyMedium>
          Input a desired MMR change to show the post-game page's header and rating for.
          Point/rating change values will automatically change their sign for win/loss, so always
          input positive amounts.
        </BodyMedium>
        <Select
          value={matchmakingType}
          label='Matchmaking type'
          allowErrors={false}
          onChange={(value: MatchmakingType) => setMatchmakingType(value)}>
          {ALL_MATCHMAKING_TYPES.map(type => (
            <SelectOption key={type} value={type} text={matchmakingTypeToLabel(type, t)} />
          ))}
        </Select>
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
        <CheckBox
          name='revealed'
          label='Already revealed?'
          checked={revealed}
          onChange={(event: React.ChangeEvent) =>
            setRevealed((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <CheckBox
          name='mapimage'
          label='Show a map image?'
          checked={showMapImage}
          onChange={(event: React.ChangeEvent) =>
            setShowMapImage((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <FilledButton label='Show results' onClick={() => setPlayCount(count => count + 1)} />
      </ControlsCard>
      {playCount > 0 ? (
        <Preview key={playCount}>
          <PostGameHero
            map={showMapImage ? MAP : undefined}
            modeLabel={matchmakingTypeToLabel(matchmakingType, t)}
            outcomeText={outcome === 'win' ? 'Victory!' : 'Defeat!'}
            result={outcome}
            matchup={getPostGameMatchup(GAME, PLAYER_ID)}
            duration={getGameDurationString(GAME.gameLength!)}
          />
          <PostGameRating
            gameId={GAME_ID}
            mmrChange={mmrChange}
            leagueChanges={leagueChanges}
            leagues={LEAGUES}
            season={SEASON}
            revealed={revealed}
          />
        </Preview>
      ) : null}
    </div>
  )
}
