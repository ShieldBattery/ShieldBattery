import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import Avatar from '../avatars/avatar.jsx'
import Card from '../material/card.jsx'
import MapThumbnail from '../maps/map-thumbnail.jsx'
import RaceIcon from '../lobbies/race-icon.jsx'

import { shadowDef2dp } from '../material/shadow-constants'
import { colorTextSecondary } from '../styles/colors'
import { Display1, Display3, Display4, Headline, robotoCondensed } from '../styles/typography'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 1140px;
  margin: 0 auto;
  padding: 24px 40px;
`

const TopHalfContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-gap: 16px;
  max-width: calc(3 * 320px);
  margin-top: 16px;
`

const Spacer = styled.div``

const MapContainer = styled.div`
  width: 320px;
  height: 320px;
  border-radius: 2px;
  box-shadow: ${shadowDef2dp};
`

const StatusContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`

const CountdownText = styled(Display4)`
  ${robotoCondensed};
  font-weight: 700;
`

const StatusText = styled(Display1)`
  ${robotoCondensed};
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

const PlayerCard = styled(Card)`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 360px;
  height: 88px;
  padding: 12px;

  &:not(:first-child) {
    margin-top: 16px;
  }
`

const StyledAvatar = styled(Avatar)`
  flex-shrink: 0;
  width: 64px;
  height: 64px;
`

const PlayerName = styled(Headline)`
  flex-grow: 1;
  ${robotoCondensed};
  font-weight: 700;
  margin: 0 12px;
`

const StyledRaceIcon = styled(RaceIcon)`
  flex-shrink: 0;
  width: 48px;
  height: 48px;
`

const VsContainer = styled.div`
  flex: 0 0 220px;
  display: flex;
  justify-content: center;
  align-items: center;
`

const VsText = styled(Display1)`
  ${robotoCondensed};
  font-weight: 700;
`

export default class MatchmakingMatch extends React.Component {
  static propTypes = {
    isLoading: PropTypes.bool,
    isCountingDown: PropTypes.bool,
    countdownTimer: PropTypes.number,
    isStarting: PropTypes.bool,
    map: PropTypes.object,
    players: PropTypes.array,
  }

  renderStatus() {
    const { isLoading, isCountingDown, countdownTimer, isStarting } = this.props

    if (isLoading && isCountingDown) {
      return <CountdownText>{countdownTimer}</CountdownText>
    } else if (isLoading && isStarting) {
      return <StatusText>Game starting...</StatusText>
    } else {
      return <StatusText>Game in progress...</StatusText>
    }
  }

  renderPlayerCard(player) {
    return (
      <PlayerCard key={player.id}>
        <StyledAvatar user={player.name} />
        <PlayerName>{player.name}</PlayerName>
        <StyledRaceIcon race={player.race} />
      </PlayerCard>
    )
  }

  render() {
    const { map, players } = this.props
    // TODO(2Pac): Split the teams by their parties once we support team matchmaking
    const team1 = players.slice(0, players.length / 2).map(p => this.renderPlayerCard(p))
    const team2 = players.slice(players.length / 2).map(p => this.renderPlayerCard(p))

    return (
      <Container>
        <Display3>{map.name}</Display3>
        <TopHalfContainer>
          <Spacer />
          <MapContainer>
            <MapThumbnail map={map} />
          </MapContainer>
          <StatusContainer>{this.renderStatus()}</StatusContainer>
        </TopHalfContainer>
        <PlayersContainer>
          <TeamContainer>{team1}</TeamContainer>
          <VsContainer>
            <VsText>vs</VsText>
          </VsContainer>
          <TeamContainer>{team2}</TeamContainer>
        </PlayersContainer>
      </Container>
    )
  }
}
