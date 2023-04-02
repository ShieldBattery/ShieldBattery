import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { MapThumbnail } from '../maps/map-thumbnail'
import { shadowDef2dp } from '../material/shadow-constants'
import { colorTextSecondary } from '../styles/colors'
import { Headline3, Headline4, headline5 } from '../styles/typography'
import PlayerCard from './player-card'
import { useTranslation } from 'react-i18next'

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
  border-radius: 2px;
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

const TeamsContainer = styled.div`
  display: flex;
  width: 100%;
  margin-top: 32px;
`

// Create a Styled component out of PlayerCard, so it can be referenced below.
const StyledPlayerCard = styled(PlayerCard)``

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

  & ${StyledPlayerCard} {
    max-width: 360px;

    &:not(:first-child) {
      margin-top: 16px;
    }
  }
`

const VsContainer = styled.div`
  flex: 0 0 220px;
  display: flex;
  justify-content: center;
  align-items: center;
`

const PlayersContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-top: 32px;

  & ${StyledPlayerCard} {
    max-width: 320px;
    margin: 8px;
  }
`

// TODO(tec27): Merge all of this and the matchmaking ones, they're all basically the same
// structure and they keep getting out of sync :(

export default class ActiveLobby extends React.Component {
  static propTypes = {
    lobby: PropTypes.object.isRequired,
  }

  render() {
    const { lobby } = this.props
    // TODO(2Pac): For now we're special-casing only TvB lobbies and using default display for all
    // other game types. I doubt there's a generic way to support all game types at once, so we'll
    // probably have to figure out a special way to display other game types too (e.g. FFA, UMS).
    const isTvB = lobby.gameType === 'topVBottom'
    const { t } = useTranslation()
    const teams = lobby.teams
      .filter(team => !team.isObserver)
      .map(team =>
        team.slots
          .filter(s => s.type === 'human' || s.type === 'computer' || s.type === 'umsComputer')
          .map(p => <StyledPlayerCard key={p.id} player={p} />),
      )

    return (
      <Container>
        <Headline3>{lobby.map.name}</Headline3>
        <TopHalfContainer>
          <Spacer />
          <StyledMapThumbnail map={lobby.map} size={320} />
          <StatusContainer>
            <StatusText>{t('lobbies.activeLobby.gameInProgressStatusText', 'Game in progress\u2026')}</StatusText>
          </StatusContainer>
        </TopHalfContainer>
        {isTvB ? (
          <TeamsContainer>
            <TeamContainer>{teams.get(0)}</TeamContainer>
            <VsContainer>
              <Headline4>vs</Headline4>
            </VsContainer>
            <TeamContainer>{teams.get(1)}</TeamContainer>
          </TeamsContainer>
        ) : (
          <PlayersContainer>{teams.get(0)}</PlayersContainer>
        )}
      </Container>
    )
  }
}
