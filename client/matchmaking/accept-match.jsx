import React from 'react'
import { connect } from 'react-redux'
import { Range } from 'immutable'
import styled from 'styled-components'

import Avatar from '../avatars/avatar.jsx'
import Dialog from '../material/dialog.jsx'
import KeyListener from '../keyboard/key-listener.jsx'
import RaisedButton from '../material/raised-button.jsx'

import { closeDialog } from '../dialogs/action-creators'
import { acceptMatch } from './action-creators'

import { MATCHMAKING_ACCEPT_MATCH_TIME } from '../../common/constants'

import { amberA400, grey700 } from '../styles/colors.ts'
import { Body1 } from '../styles/typography.ts'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const StyledDialog = styled(Dialog)`
  width: 384px;
`

const CenteredContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin: 32px 0;
`

const AcceptMatchButton = styled(RaisedButton)`
  width: 162px;
`

const StyledAvatar = styled(Avatar)`
  &:not(:first-child) {
    margin-left: 8px;
  }
`

const TimerBarContainer = styled.div`
  position: relative;
  width: 100%;
  height: 8px;
  background-color: ${grey700};
`

const FilledTimerBar = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 8px;
  background-color: ${amberA400};
  transform: ${props => `scaleX(${props.filledScale})`};
  transform-origin: 0% 50%;
  transition: transform 1000ms linear;
  will-change: transform;
`

@connect(state => ({ matchmaking: state.matchmaking }))
export default class AcceptMatch extends React.Component {
  componentDidMount() {
    this.maybeClose()
  }

  componentDidUpdate() {
    this.maybeClose()
  }

  maybeClose() {
    const {
      matchmaking: { isFinding, failedToAccept, match },
    } = this.props
    if (!isFinding && !failedToAccept && !match) {
      this.props.dispatch(closeDialog())
    }
  }

  renderDialogContents() {
    const {
      matchmaking: { isFinding, hasAccepted, acceptTime, failedToAccept, match },
    } = this.props

    if (isFinding) {
      return (
        <p>Some players failed to accept the match. Returning to the matchmaking queue&hellip;</p>
      )
    } else if (failedToAccept) {
      return (
        <div>
          <KeyListener onKeyDown={this.onFailedKeyDown} />
          <p>You failed to accept the match and have been removed from the queue.</p>
          <RaisedButton label='Ok' onClick={this.onFailedClick} />
        </div>
      )
    } else if (!match) {
      // In this case, the dialog is about to close anyway
      return null
    } else {
      // TODO(2Pac): Display actual user's avatars for themselves / their party members, while
      // leaving the default avatar for opponents (though maybe it's fine to show opponents too at
      // this point?).
      const acceptedAvatars = Range(0, match.acceptedPlayers).map(i => (
        <StyledAvatar key={i} color={amberA400} glowing={true} />
      ))
      const unacceptedAvatars = Range(match.acceptedPlayers, match.numPlayers).map(i => (
        <StyledAvatar key={i} />
      ))

      return (
        <div>
          <KeyListener onKeyDown={this.onAcceptKeyDown} />
          <Body1>All players must accept the match to begin.</Body1>
          <CenteredContainer>
            {hasAccepted ? (
              [...acceptedAvatars, ...unacceptedAvatars]
            ) : (
              <AcceptMatchButton label='Accept match' onClick={this.onAcceptClick} />
            )}
          </CenteredContainer>
          <TimerBarContainer>
            <FilledTimerBar filledScale={(acceptTime / MATCHMAKING_ACCEPT_MATCH_TIME) * 1000} />
          </TimerBarContainer>
        </div>
      )
    }
  }

  render() {
    const {
      matchmaking: { isFinding, failedToAccept },
    } = this.props

    const title = isFinding || failedToAccept ? 'Failed to accept' : 'Your game is ready'
    return (
      <StyledDialog title={title} showCloseButton={false}>
        {this.renderDialogContents()}
      </StyledDialog>
    )
  }

  onAcceptClick = () => {
    this.props.dispatch(acceptMatch())
  }

  onFailedClick = () => {
    this.props.dispatch(closeDialog())
  }

  onAcceptKeyDown = event => {
    if (event.code === ENTER || event.code === ENTER_NUMPAD) {
      this.onAcceptClick()
      return true
    }

    return false
  }

  onFailedKeyDown = event => {
    if (event.code === ENTER || event.code === ENTER_NUMPAD) {
      this.onFailedClick()
      return true
    }

    return false
  }
}
