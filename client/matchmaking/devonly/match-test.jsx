import React from 'react'
import { FightingSpirit } from '../../maps/devonly/maps-for-testing'
import MatchmakingMatch from '../matchmaking-match'
import { MatchmakingPlayerRecord } from '../matchmaking-reducer'

export default class MapSelectionTest extends React.Component {
  state = {
    isLaunching: true,
    isCountingDown: false,
    countdownTimer: -1,
    isStarting: false,
  }

  _launchingTimer = null
  _loadingTimer = null
  _countdownTimer = null
  _startingTimer = null

  componentDidMount() {
    this._loadingTimer = setInterval(() => {
      this._startGameLaunch()
    }, 20000)
    this._startGameLaunch()
  }

  componentWillUnmount() {
    this._clearCountdownTimer()
    this._clearStartingTimer()
    this._clearLoadingTimer()
  }

  _startGameLaunch() {
    this.setState({ isLaunching: true })
    this._launchingTimer = setTimeout(() => {
      this.setState({ isLaunching: false })
      this._startCountdown()
    }, 5000)
  }

  _clearGameLaunchTimer() {
    if (this._launchingTimer) {
      clearTimeout(this._launchingTimer)
      this._launchingTimer = null
    }
  }

  _startCountdown() {
    this._clearCountdownTimer()
    let tick = 5
    this.setState({ isCountingDown: true, countdownTimer: tick })

    this._countdownTimer = setInterval(() => {
      tick -= 1
      this.setState({ countdownTimer: tick })
      if (!tick) {
        this._clearCountdownTimer()
        this.setState({ isCountingDown: false, isStarting: true })
        this._startGameStarting()
      }
    }, 1000)
  }

  _startGameStarting() {
    this._startingTimer = setTimeout(() => this.setState({ isStarting: false }), 5000)
  }

  _clearCountdownTimer() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  }

  _clearStartingTimer() {
    if (this._startingTimer) {
      clearTimeout(this._startingTimer)
      this._startingTimer = null
    }
  }

  _clearLoadingTimer() {
    if (this._loadingTimer) {
      clearInterval(this._loadingTimer)
      this._loadingTimer = null
    }
  }

  render() {
    const { isLaunching, isCountingDown, countdownTimer, isStarting } = this.state

    const players = [
      new MatchmakingPlayerRecord({ id: 1, name: 'tec27', race: 'p' }),
      new MatchmakingPlayerRecord({ id: 2, name: 'Excalibur_Z', race: 'r' }),
    ]

    return (
      <MatchmakingMatch
        isLaunching={isLaunching}
        isCountingDown={isCountingDown}
        countdownTimer={countdownTimer}
        isStarting={isStarting}
        map={FightingSpirit}
        players={players}
      />
    )
  }
}
