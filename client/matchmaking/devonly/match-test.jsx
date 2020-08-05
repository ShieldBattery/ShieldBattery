import React from 'react'

import MatchmakingMatch from '../matchmaking-match.jsx'
import { MapRecord } from '../../maps/maps-reducer'
import { Player } from '../matchmaking-reducer'

export default class MapSelectionTest extends React.Component {
  state = {
    isCountingDown: false,
    countdownTimer: -1,
    isStarting: false,
  }

  _loadingTimer = null
  _countdownTimer = null
  _startingTimer = null

  componentDidMount() {
    this._loadingTimer = setInterval(() => {
      this._startCountdown()
    }, 15000)
    this._startCountdown()
  }

  componentWillUnmount() {
    this._clearCountdownTimer()
    this._clearStartingTimer()
    this._clearLoadingTimer()
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
    const { isCountingDown, countdownTimer, isStarting } = this.state

    const map = new MapRecord({
      id: 1,
      name: 'Fighting Spirit',
    })
    const players = [
      new Player({ id: 1, name: 'tec27', race: 'p' }),
      new Player({ id: 2, name: 'Excalibur_Z', race: 'r' }),
    ]

    return (
      <MatchmakingMatch
        isCountingDown={isCountingDown}
        countdownTimer={countdownTimer}
        isStarting={isStarting}
        map={map}
        players={players}
      />
    )
  }
}
