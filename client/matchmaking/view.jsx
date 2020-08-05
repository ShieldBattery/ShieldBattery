import React from 'react'
import { connect } from 'react-redux'
import { Route, Switch } from 'react-router-dom'
import { replace } from 'connected-react-router'

import Index from '../navigation/index.jsx'
import MapSelection from './map-selection.jsx'
import MatchmakingMatch from './matchmaking-match.jsx'

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

  renderMapSelection = () => {
    const { isSelectingMap, match } = this.props.matchmaking
    if (!isSelectingMap || !match) return null

    return (
      <MapSelection
        preferredMaps={match.preferredMaps.toJS()}
        randomMaps={match.randomMaps.toJS()}
        chosenMap={match.chosenMap}
      />
    )
  }

  renderMatchmakingMatch = () => {
    const {
      activeGame: { isActive: hasActiveGame, info: gameInfo },
      matchmaking: { isCountingDown, countdownTimer, isStarting, match },
    } = this.props

    if (!hasActiveGame && !match) return null

    const chosenMap = hasActiveGame ? gameInfo.extra.match.chosenMap : match.chosenMap
    const players = hasActiveGame ? gameInfo.extra.match.players : match.players

    return (
      <MatchmakingMatch
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
        <Route path='/matchmaking/map-selection' render={this.renderMapSelection} />
        <Route path='/matchmaking/countdown' render={this.renderMatchmakingMatch} />
        <Route path='/matchmaking/game-starting' render={this.renderMatchmakingMatch} />
        <Route path='/matchmaking/active-game' render={this.renderMatchmakingMatch} />
        <Index transitionFn={replace} />
      </Switch>
    )
  }
}
