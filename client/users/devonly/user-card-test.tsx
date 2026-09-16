import { useState } from 'react'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { LadderPlayer } from '../../../common/ladder/ladder'
import { makeSeasonId, MatchmakingSeasonJson, MatchmakingType } from '../../../common/matchmaking'
import { RaceStats } from '../../../common/races'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { UserProfileJson } from '../../../common/users/user-network'
import { ScenarioPicker } from '../../lobbies/devonly/scenario-picker'
import { UserCardContent, UserCardState } from '../user-card'

type Scenario = 'loading' | 'loaded' | 'noSeason' | 'unranked' | 'error'

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: 'loading', label: 'Loading' },
  { id: 'loaded', label: 'Loaded' },
  { id: 'noSeason', label: 'Loaded, season unknown' },
  { id: 'unranked', label: 'No ranks, no games' },
  { id: 'error', label: 'Error' },
]

const MOCK_USER_ID = makeSbUserId(1)
const MOCK_USER_NAME = 'tec27'

const MOCK_SEASON: MatchmakingSeasonJson = {
  id: makeSeasonId(1),
  name: 'Beta Season 3',
  startDate: Date.now() - 1000 * 60 * 60 * 24 * 14,
  resetMmr: true,
}

const NO_RACE_STATS: RaceStats = {
  pWins: 0,
  pLosses: 0,
  tWins: 0,
  tLosses: 0,
  zWins: 0,
  zLosses: 0,
  rWins: 0,
  rLosses: 0,
  rPWins: 0,
  rPLosses: 0,
  rTWins: 0,
  rTLosses: 0,
  rZWins: 0,
  rZLosses: 0,
}

function makeLadderPlayer(
  matchmakingType: MatchmakingType,
  points: number,
  wins: number,
  losses: number,
): LadderPlayer {
  return {
    ...NO_RACE_STATS,
    rank: 12,
    userId: MOCK_USER_ID,
    matchmakingType,
    seasonId: MOCK_SEASON.id,
    rating: 1750,
    points,
    bonusUsed: 0,
    lifetimeGames: wins + losses,
    wins,
    losses,
    lastPlayedDate: Date.now() - 1000 * 60 * 60 * 3,
  }
}

const RANKED_PROFILE: UserProfileJson = {
  userId: MOCK_USER_ID,
  seasonId: MOCK_SEASON.id,
  ladder: {
    // Ordered by activity in the card, not by this object's key order.
    [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 940, 18, 21),
    [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1840, 74, 52),
  },
  userStats: {
    ...NO_RACE_STATS,
    userId: MOCK_USER_ID,
    pWins: 40,
    pLosses: 30,
    tWins: 20,
    tLosses: 18,
    zWins: 26,
    zLosses: 20,
    rWins: 6,
    rLosses: 5,
  },
}

const NEW_USER_PROFILE: UserProfileJson = {
  userId: MOCK_USER_ID,
  seasonId: MOCK_SEASON.id,
  ladder: {},
  userStats: { ...NO_RACE_STATS, userId: MOCK_USER_ID },
}

function scenarioToState(scenario: Scenario): UserCardState {
  switch (scenario) {
    case 'loading':
      return { status: 'loading' }
    case 'loaded':
      return { status: 'loaded', profile: RANKED_PROFILE, season: MOCK_SEASON }
    case 'noSeason':
      return { status: 'loaded', profile: RANKED_PROFILE, season: undefined }
    case 'unranked':
      return { status: 'loaded', profile: NEW_USER_PROFILE, season: MOCK_SEASON }
    case 'error':
      return { status: 'error' }
    default:
      return assertUnreachable(scenario)
  }
}

export function UserCardTest() {
  const [scenario, setScenario] = useState<Scenario>('loaded')

  return (
    <div>
      <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      <UserCardContent
        userId={MOCK_USER_ID}
        name={MOCK_USER_NAME}
        state={scenarioToState(scenario)}
        onProfileClick={() => {}}
      />
    </div>
  )
}
