import { Component } from 'react'
import { withTranslation } from 'react-i18next'
import styled from 'styled-components'
import PlayerCard from '../lobbies/player-card'
import { MapThumbnail } from '../maps/map-thumbnail'
import { elevationPlus1 } from '../material/shadows'
import { DisplayLarge, DisplaySmall, HeadlineMedium, titleLarge } from '../styles/typography'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 1140px;
  margin: 0 auto;
  padding: 24px 40px;
  border-left: var(--pixel-shove-x, 0px) solid transparent;
`

const TopHalfContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-gap: 16px;
  max-width: calc(3 * 320px);
  margin-top: 32px;
`

const Spacer = styled.div``

const StyledMapThumbnail = styled(MapThumbnail)`
  ${elevationPlus1};
  width: 320px;
`

const StatusContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`

const StatusText = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface-variant);
`

const PlayersContainer = styled.div`
  display: flex;
  width: 100%;
  margin-top: 32px;
`

const TeamContainer = styled.div`
  flex: 1 1 0;
  display: flex;
  flex-direction: column;

  &:first-child {
    align-items: flex-end;
  }
  &:last-child {
    align-items: flex-start;
  }
`

const StyledPlayerCard = styled(PlayerCard)`
  max-width: 360px;

  &:not(:first-child) {
    margin-top: 16px;
  }
`

const VsContainer = styled.div`
  flex: 0 0 220px;
  display: flex;
  justify-content: center;
  align-items: center;
`

@withTranslation()
export default class MatchmakingMatch extends Component {
  renderStatus() {
    const { isCountingDown, countdownTimer, isLaunching, isStarting, t } = this.props

    if (isLaunching) {
      return <StatusText>{t('matchmaking.match.gameLoading', 'Game launching…')}</StatusText>
    } else if (isCountingDown) {
      return <DisplayLarge>{countdownTimer}</DisplayLarge>
    } else if (isStarting) {
      return <StatusText>{t('matchmaking.match.gameStarting', 'Game starting…')}</StatusText>
    } else {
      return <StatusText>{t('matchmaking.match.gameInProgress', 'Game in progress…')}</StatusText>
    }
  }

  render() {
    const { map, players, t } = this.props
    // TODO(2Pac): Split the teams by their parties once we support team matchmaking
    const team1 = players
      .slice(0, players.length / 2)
      .map(p => <StyledPlayerCard key={p.id} player={p} />)
    const team2 = players
      .slice(players.length / 2)
      .map(p => <StyledPlayerCard key={p.id} player={p} />)

    return (
      <Container>
        <DisplaySmall>{map?.name ?? ''}</DisplaySmall>
        <TopHalfContainer>
          <Spacer />
          <StyledMapThumbnail map={map} size={320} />
          <StatusContainer>{this.renderStatus()}</StatusContainer>
        </TopHalfContainer>
        <PlayersContainer>
          <TeamContainer>{team1}</TeamContainer>
          <VsContainer>
            <HeadlineMedium>{t('matchmaking.match.playerVsPlayer', 'vs')}</HeadlineMedium>
          </VsContainer>
          <TeamContainer>{team2}</TeamContainer>
        </PlayersContainer>
      </Container>
    )
  }
}
