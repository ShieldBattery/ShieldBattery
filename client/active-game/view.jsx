import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import ContentLayout from '../content/content-layout.jsx'

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
    return (
      <ContentLayout title={"You're in a game"}>
        <span>Why are you looking here?</span>
      </ContentLayout>
    )
  }
}
