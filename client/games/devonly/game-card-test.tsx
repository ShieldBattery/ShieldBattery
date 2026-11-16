import styled from 'styled-components'
import { MatchmakingDivision } from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { titleMedium } from '../../styles/typography'
import { GameCardLayout, GameCardPlayer, GameCardSize } from '../game-card'

const Root = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Heading = styled.div`
  ${titleMedium};
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
`

// Placeholder players: no account behind them, so the cards show the computer avatar space.
const p = (name: string, race: RaceChar, division?: MatchmakingDivision): GameCardPlayer => ({
  name,
  race,
  division,
})

const ONE_V_ONE = [
  [p('Pylonless', 'p', MatchmakingDivision.Diamond2)],
  [p('Brambleback', 't', MatchmakingDivision.Champion)],
]
const TWO_V_TWO = [
  [
    p('nydusnomad', 'z', MatchmakingDivision.Gold3),
    p('OvermindJr', 'z', MatchmakingDivision.Gold1),
  ],
  [
    p('Reaverdrop', 'p', MatchmakingDivision.Platinum2),
    p('vespene_', 't', MatchmakingDivision.Silver3),
  ],
]
const THREE_V_THREE = [
  [
    p('Noctilux', 'z', MatchmakingDivision.Diamond1),
    p('gg_no_re', 'p', MatchmakingDivision.Platinum3),
    p('Kohaku', 't', MatchmakingDivision.Gold2),
  ],
  [
    p('Wraithlike', 'z', MatchmakingDivision.Diamond3),
    p('Brambleback', 'p', MatchmakingDivision.Platinum1),
    p('Tidewalker', 't', MatchmakingDivision.Unrated),
  ],
]
const CUSTOM = [
  [p('Larvae', 'z'), p('Juniper', 'p')],
  [p('Sorrel', 't'), p('Petrichor', 'p')],
]

/** The sample games' start times are relative to when this page loaded. */
const PAGE_LOADED = Date.now()

function CardRow({ size }: { size: GameCardSize }) {
  const common = { size, mapImageUrl: undefined, mapName: 'Fighting Spirit 1.4' }
  return (
    <Row>
      <GameCardLayout
        {...common}
        modeLabel='Ranked 1v1'
        sides={ONE_V_ONE}
        lengthText='12:44'
        startTime={PAGE_LOADED - 4 * 60 * 60 * 1000}
      />
      <GameCardLayout
        {...common}
        modeLabel='Ranked 1v1'
        result='loss'
        sides={ONE_V_ONE}
        lengthText='8:02'
        startTime={PAGE_LOADED - 26 * 60 * 60 * 1000}
      />
      <GameCardLayout
        {...common}
        modeLabel='Ranked 2v2'
        live={true}
        sides={TWO_V_TWO}
        lengthText='16:00'
      />
      <GameCardLayout
        {...common}
        modeLabel='Ranked 3v3 BGH'
        mapName='Big Game Hunters'
        sides={THREE_V_THREE}
        lengthText='24:05'
        startTime={PAGE_LOADED - 20 * 60 * 1000}
      />
      <GameCardLayout
        {...common}
        modeLabel='Custom game'
        result='win'
        sides={CUSTOM}
        lengthText='31:10'
        startTime={PAGE_LOADED - 3 * 24 * 60 * 60 * 1000}
      />
    </Row>
  )
}

export function GameCardTest() {
  return (
    <Root>
      <Heading>Large</Heading>
      <CardRow size='large' />
      <Heading>Regular</Heading>
      <CardRow size='regular' />
    </Root>
  )
}
