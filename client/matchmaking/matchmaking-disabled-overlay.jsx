import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import Popover from '../material/popover.jsx'
import { fastOutSlowIn } from '../material/curve-constants.js'
import { colorTextSecondary } from '../styles/colors'
import { Headline3, Headline5, Headline6, headline6, body1, overline } from '../styles/typography'

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const Contents = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 384px;
  padding: 16px;

  &.enter {
    opacity: 0;
    transform: translateY(-16px);
  }

  &.enterActive {
    opacity: 1;
    transform: translateY(0px);
    transition: ${props => `
      opacity ${props.transitionDuration}ms linear ${props.transitionDelay}ms,
      transform ${props.transitionDuration}ms ${fastOutSlowIn} ${props.transitionDelay}ms
    `};
  }

  &.exit {
    opacity: 1;
  }

  &.exitActive {
    opacity: 0;
    transition: ${props => `opacity ${props.transitionDuration}ms linear`};
  }
`

const DisabledText = styled.span`
  ${body1};
  margin: 24px 0 32px 0;
  overflow-wrap: break-word;
`

const ToText = styled.span`
  ${headline6};
  margin: 8px 0;
  color: ${colorTextSecondary};
`

const CountdownContainer = styled.div`
  display: flex;
  justify-content: center;
  margin: 48px 0 8px 0;
  padding: 0 16px;
`

const CountdownItemContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  &:not(:first-child) {
    margin-left: 32px;
  }
`

const CountdownItemText = styled.span`
  ${overline};
  color: ${colorTextSecondary};
`

export default class MatchmakingDisabledOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    anchor: PropTypes.object,
    matchmakingStatus: PropTypes.object,
    onDismiss: PropTypes.func.isRequired,
  }

  static defaultProps = {
    matchmakingStatus: {},
  }

  state = {
    days: '00',
    hours: '00',
    minutes: '00',
    seconds: '00',
  }

  _countdownTimer = null

  componentDidUpdate(prevProps) {
    if (!prevProps.open && this.props.open) {
      this._startCountdown()
    } else if (prevProps.open && !this.props.open) {
      this._stopCountdown()
    }
  }

  componentWillUnmount() {
    this._stopCountdown()
  }

  _startCountdown() {
    const {
      matchmakingStatus: { nextStartDate },
    } = this.props

    if (!nextStartDate || nextStartDate < Date.now()) {
      return
    }

    const calculate = () => {
      const diff = nextStartDate - Date.now()
      const oneMinute = 60 * 1000
      const oneHour = oneMinute * 60
      const oneDay = oneHour * 24

      const days = `${Math.max(Math.floor(diff / oneDay), 0)}`.padStart(2, 0)
      const hours = `${Math.max(Math.floor((diff % oneDay) / oneHour), 0)}`.padStart(2, 0)
      const minutes = `${Math.max(Math.floor((diff % oneHour) / oneMinute), 0)}`.padStart(2, 0)
      const seconds = `${Math.max(Math.floor((diff % oneMinute) / 1000), 0)}`.padStart(2, 0)

      if (diff < 0) {
        this._stopCountdown()
      }

      this.setState({ days, hours, minutes, seconds })
    }

    this._countdownTimer = setInterval(calculate, 1000)
    calculate()
  }

  _stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  }

  render() {
    const { open, anchor, matchmakingStatus, onDismiss } = this.props
    const { days, hours, minutes, seconds } = this.state
    const { nextStartDate, nextEndDate } = matchmakingStatus

    return (
      <Popover
        open={open}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginVertical='top'
        anchorOriginHorizontal='right'
        popoverOriginVertical='top'
        popoverOriginHorizontal='right'
        anchorOffsetVertical={8}
        anchorOffsetHorizontal={-16}>
        {(state, timings) => {
          const { openDelay, openDuration, closeDuration } = timings
          let transitionDuration = 0
          let transitionDelay = 0
          if (state === 'opening') {
            transitionDuration = openDuration
            transitionDelay = openDelay
          } else if (state === 'opened') {
            transitionDuration = closeDuration
          }

          return (
            <CSSTransition
              in={state === 'opening' || state === 'opened'}
              classNames={transitionNames}
              appear={true}
              timeout={{
                appear: openDelay + openDuration,
                enter: openDuration,
                exit: closeDuration,
              }}>
              <Contents
                key='contents'
                transitionDuration={transitionDuration}
                transitionDelay={transitionDelay}>
                <Headline5>Matchmaking Disabled</Headline5>
                <DisabledText>
                  Matchmaking is available at limited times throughout the week, and is currently
                  disabled. The next matchmaking period is:
                </DisabledText>
                {nextStartDate && nextStartDate > Date.now() ? (
                  <>
                    <Headline6>{dateFormat.format(nextStartDate)}</Headline6>
                    {nextEndDate && nextEndDate > nextStartDate ? (
                      <>
                        <ToText>to</ToText>
                        <Headline6>{dateFormat.format(nextEndDate)}</Headline6>
                      </>
                    ) : null}
                    <CountdownContainer>
                      <CountdownItemContainer>
                        <CountdownItemText>Days</CountdownItemText>
                        <Headline3>{days}</Headline3>
                      </CountdownItemContainer>
                      <CountdownItemContainer>
                        <CountdownItemText>Hours</CountdownItemText>
                        <Headline3>{hours}</Headline3>
                      </CountdownItemContainer>
                      <CountdownItemContainer>
                        <CountdownItemText>Minutes</CountdownItemText>
                        <Headline3>{minutes}</Headline3>
                      </CountdownItemContainer>
                      <CountdownItemContainer>
                        <CountdownItemText>Seconds</CountdownItemText>
                        <Headline3>{seconds}</Headline3>
                      </CountdownItemContainer>
                    </CountdownContainer>
                  </>
                ) : (
                  <Headline6>Soon™</Headline6>
                )}
              </Contents>
            </CSSTransition>
          )
        }}
      </Popover>
    )
  }
}
