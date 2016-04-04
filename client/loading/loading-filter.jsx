import React from 'react'
import { connect } from 'react-redux'

@connect(state => ({ loading: state.loading }))
export default class LoadingFilter extends React.Component {
  render() {
    // TODO(tec27): make a really awesome loading screen
    if (this.props.loading.some(v => v)) {
      return <div>Loading&hellip;</div>
    } else {
      return React.Children.only(this.props.children)
    }
  }
}
