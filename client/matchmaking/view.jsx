import React from 'react'
import { connect } from 'react-redux'
import { Route, Switch } from 'react-router-dom'
import { replace } from 'connected-react-router'

import Index from '../navigation/index.jsx'
import MapSelection from './map-selection.jsx'
import MatchmakingMatch from './matchmaking-match.jsx'

@connect(state => ({ hasActiveGame: state.activeGame.isActive, matchmaking: state.matchmaking }))
export default class MatchmakingView extends React.Component {
  componentDidMount() {
    if (!this.props.matchmaking.isLoading && !this.props.hasActiveGame) {
      this.props.dispatch(replace('/'))
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.hasActiveGame && !this.props.hasActiveGame) {
      // TODO(2Pac): handle this in socket-handlers once we start tracking game ending on the server
      this.props.dispatch(replace('/'))
    }
  }

  renderMapSelection = () => {
    const { isLoading, match } = this.props.matchmaking
    if (!isLoading) return null

    return (
      <MapSelection
        preferredMaps={match.preferredMaps.toJS()}
        randomMaps={match.randomMaps.toJS()}
        chosenMap={match.chosenMap}
      />
    )
  }

  renderMatchmakingMatch = () => {
    const { isLoading, isCountingDown, countdownTimer, isStarting, match } = this.props.matchmaking
    if (!isLoading && !match) return null

    return (
      <MatchmakingMatch
        isLoading={isLoading}
        isCountingDown={isCountingDown}
        countdownTimer={countdownTimer}
        isStarting={isStarting}
        map={match.chosenMap}
        players={match.players.toJS()}
      />
    )
  }

  render() {
    return (
      <Switch>
        <Route path='/matchmaking/map-selection' render={this.renderMapSelection} />
        <Route path='/matchmaking/countdown' render={this.renderMatchmakingMatch} />
        <Route path='/matchmaking/game-starting' render={this.renderMatchmakingMatch} />
        <Route path='/matchmaking/active-game' render={this.renderMatchmakingMatch} />
        <Index transitionFn={replace} />
      </Switch>
    )
  }
}
