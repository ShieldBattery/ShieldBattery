import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'

@connect(state => ({ activeGame: state.activeGame }))
export default class ActiveGameView extends React.Component {
  componentDidMount() {
    if (!this.props.activeGame.isActive) {
      this.props.dispatch(routerActions.push('/'))
    }
  }

  componentWillReceiveProps(nextProps) {
    if (this.props.activeGame.isActive && !nextProps.activeGame.isActive) {
      // TODO(tec27): redirect to game results page?
      this.props.dispatch(routerActions.push('/'))
    }
  }

  render() {
    // TODO(tec27): render some data about who is in the game?
    return <span>Why are you looking here?</span>
  }
}
