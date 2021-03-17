import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { goToIndex } from './action-creators'
import { push } from './routing'

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
