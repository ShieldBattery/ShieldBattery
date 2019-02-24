import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { push } from 'connected-react-router'
import { goToIndex } from './action-creators'

@connect()
export default class Index extends React.Component {
  static propTypes = {
    transitionFn: PropTypes.func,
  }

  static defaultProps = {
    transitionFn: push,
  }

  componentDidMount() {
    this.props.dispatch(goToIndex(this.props.transitionFn))
  }

  componentDidUpdate() {
    this.props.dispatch(goToIndex(this.props.transitionFn))
  }

  render() {
    return null
  }
}
