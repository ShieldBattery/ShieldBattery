import React from 'react'
import { connect } from 'react-redux'
import { push } from 'connected-react-router'

@connect(state => ({ activeGame: state.activeGame }))
export default class ActiveGameView extends React.Component {
  componentDidMount() {
    if (!this.props.activeGame.isActive) {
      this.props.dispatch(push('/'))
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.activeGame.isActive && !this.props.activeGame.isActive) {
      // TODO(tec27): redirect to game results page?
      this.props.dispatch(push('/'))
    }
  }

  render() {
    // TODO(tec27): render some data about who is in the game?
    return <span>Why are you looking here?</span>
  }
}
