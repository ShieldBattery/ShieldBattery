import { Component } from 'react'
import { withTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DisplayLarge, titleLarge } from '../styles/typography'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 1140px;
  margin: 0 auto;
  padding: 24px 40px;
  border-left: var(--pixel-shove-x, 0px) solid transparent;
`

const StatusText = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface-variant);
`

@withTranslation()
export default class MatchmakingMatch extends Component {
  renderStatus() {
    const { isCountingDown, countdownTimer, isLaunching, t } = this.props

    if (isLaunching) {
      return <StatusText>{t('matchmaking.match.gameLoading', 'Game launching…')}</StatusText>
    } else if (isCountingDown) {
      return <DisplayLarge>{countdownTimer}</DisplayLarge>
    } else {
      return <StatusText>{t('matchmaking.match.gameInProgress', 'Game in progress…')}</StatusText>
    }
  }

  render() {
    // TODO(tec27): Re-implement this screen
    return <Container />

    /*
    const { map, players, t } = this.props
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
    */
  }
}
