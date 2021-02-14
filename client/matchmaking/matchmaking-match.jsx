import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import PlayerCard from '../lobbies/player-card'
import { MapThumbnail } from '../maps/map-thumbnail'
import { shadowDef2dp } from '../material/shadow-constants'
import { colorTextSecondary } from '../styles/colors'
import { Headline1, Headline3, Headline4, headline5 } from '../styles/typography'

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
  width: 320px;
  box-shadow: ${shadowDef2dp};
`

const StatusContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`

const StatusText = styled.div`
  ${headline5};
  color: ${colorTextSecondary};
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

export default class MatchmakingMatch extends React.Component {
  static propTypes = {
    isLaunching: PropTypes.bool,
    isCountingDown: PropTypes.bool,
    countdownTimer: PropTypes.number,
    isStarting: PropTypes.bool,
    map: PropTypes.object,
    players: PropTypes.array,
  }

  renderStatus() {
    const { isCountingDown, countdownTimer, isLaunching, isStarting } = this.props

    if (isLaunching) {
      return <StatusText>Game launching...</StatusText>
    } else if (isCountingDown) {
      return <Headline1>{countdownTimer}</Headline1>
    } else if (isStarting) {
      return <StatusText>Game starting...</StatusText>
    } else {
      return <StatusText>Game in progress...</StatusText>
    }
  }

  render() {
    const { map, players } = this.props
    // TODO(2Pac): Split the teams by their parties once we support team matchmaking
    const team1 = players
      .slice(0, players.length / 2)
      .map(p => <StyledPlayerCard key={p.id} player={p} />)
    const team2 = players
      .slice(players.length / 2)
      .map(p => <StyledPlayerCard key={p.id} player={p} />)

    return (
      <Container>
        <Headline3>{map.name}</Headline3>
        <TopHalfContainer>
          <Spacer />
          <StyledMapThumbnail map={map} size={320} />
          <StatusContainer>{this.renderStatus()}</StatusContainer>
        </TopHalfContainer>
        <PlayersContainer>
          <TeamContainer>{team1}</TeamContainer>
          <VsContainer>
            <Headline4>vs</Headline4>
          </VsContainer>
          <TeamContainer>{team2}</TeamContainer>
        </PlayersContainer>
      </Container>
    )
  }
}
