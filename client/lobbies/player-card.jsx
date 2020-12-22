import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import Avatar from '../avatars/avatar.jsx'
import Card from '../material/card.jsx'
import ComputerAvatar from '../avatars/computer-avatar.jsx'
import RaceIcon from '../lobbies/race-icon.jsx'

import { fastOutSlowInShort } from '../material/curves'
import { alphaDisabled, colorTextFaint, colorTextPrimary } from '../styles/colors.ts'
import { Headline, singleLine, robotoCondensed } from '../styles/typography'

const Container = styled(Card)`
  display: flex;
  align-items: center;
  width: 100%;
  height: 88px;
  padding: 12px;
  overflow: hidden;

  color: ${props => (props.ready ? colorTextPrimary : colorTextFaint)};
  --player-component-opacity: ${props => (props.ready ? 1 : alphaDisabled)};
`

const StyledAvatar = styled(Avatar)`
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  opacity: ${props => (props.ready ? 1 : alphaDisabled)};
  ${fastOutSlowInShort};
`

const PlayerName = styled(Headline)`
  flex-grow: 1;
  font-weight: 700;
  margin: 0 16px;
  color: inherit;
  ${singleLine};
  ${robotoCondensed};
  ${fastOutSlowInShort};
`

const StyledRaceIcon = styled(RaceIcon)`
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  opacity: var(--player-component-opacity);
  ${fastOutSlowInShort};
`

export default class PlayerCard extends React.Component {
  static propTypes = {
    player: PropTypes.object.isRequired,
    isComputer: PropTypes.bool,
    isReady: PropTypes.bool,
  }

  static defaultProps = {
    isReady: true,
  }

  render() {
    const { player, isComputer, isReady } = this.props

    const avatar = isComputer ? (
      <StyledAvatar as={ComputerAvatar} ready={isReady} />
    ) : (
      <StyledAvatar user={player.name} ready={isReady} />
    )
    const displayName = isComputer ? 'Computer' : player.name

    return (
      <Container className={this.props.className} ready={isReady}>
        {avatar}
        <PlayerName>{displayName}</PlayerName>
        <StyledRaceIcon race={player.race} />
      </Container>
    )
  }
}
