import React from 'react'
import { connect } from 'react-redux'
import { Route, Switch } from 'react-router-dom'
import { replace } from 'connected-react-router'

import Index from '../navigation/index'
import MatchmakingMatch from './matchmaking-match'

@connect(state => ({ activeGame: state.activeGame, matchmaking: state.matchmaking }))
export default class MatchmakingView extends React.Component {
  componentDidMount() {
    if (!this.props.matchmaking.isLoading && !this.props.activeGame.isActive) {
      this.props.dispatch(replace('/'))
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.activeGame.isActive && !this.props.activeGame.isActive) {
      // TODO(2Pac): handle this in socket-handlers once we start tracking game ending on the server
      this.props.dispatch(replace('/'))
    }
  }

  renderMatchmakingMatch = () => {
    const {
      activeGame: { isActive: hasActiveGame, info: gameInfo },
      matchmaking: { isLaunching, isCountingDown, countdownTimer, isStarting, match },
    } = this.props

    if (!hasActiveGame && !match) return null

    const chosenMap = hasActiveGame ? gameInfo.extra.match.chosenMap : match.chosenMap
    const players = hasActiveGame ? gameInfo.extra.match.players : match.players

    return (
      <MatchmakingMatch
        isLaunching={isLaunching}
        isCountingDown={isCountingDown}
        countdownTimer={countdownTimer}
        isStarting={isStarting}
        map={chosenMap}
        players={players.toJS()}
      />
    )
  }

  render() {
    return (
      <Switch>
        <Route path='/matchmaking/countdown' render={this.renderMatchmakingMatch} />
        <Route path='/matchmaking/game-starting' render={this.renderMatchmakingMatch} />
        <Route path='/matchmaking/active-game' render={this.renderMatchmakingMatch} />
        <Index transitionFn={replace} />
      </Switch>
    )
  }
}
