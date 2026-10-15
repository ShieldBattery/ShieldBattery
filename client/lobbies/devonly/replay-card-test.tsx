import styled from 'styled-components'
import { MatchmakingDivision, MatchmakingType } from '../../../common/matchmaking'
import { ReplaySessionPlayer } from '../../../common/replay-sessions'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { bodyMedium, titleMedium } from '../../styles/typography'
import { ReplayCard } from '../lobby-replay'

const Container = styled.div`
  max-width: 700px;
  margin: 48px auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const Heading = styled.h1`
  ${titleMedium};
`

const Note = styled.p`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const players: ReplaySessionPlayer[] = [
  {
    name: 'claude-1',
    race: 'p',
    team: 1,
    userId: makeSbUserId(2),
    ranked: {
      matchmakingType: MatchmakingType.Match1v1,
      division: MatchmakingDivision.Gold2,
      mmr: 1654,
    },
  },
  {
    name: 'claude-2',
    race: 'z',
    team: 2,
    userId: makeSbUserId(3),
    ranked: {
      matchmakingType: MatchmakingType.Match1v1,
      division: MatchmakingDivision.Platinum1,
      mmr: 1723,
    },
  },
]

export function ReplayCardTest() {
  return (
    <Container>
      <Heading>Ranked replay card</Heading>
      <Note>Sample player standings for preview. A real replay uses recorded match data.</Note>
      <ReplayCard mapName='Fighting Spirit' durationFrames={15564} players={players} />
    </Container>
  )
}
