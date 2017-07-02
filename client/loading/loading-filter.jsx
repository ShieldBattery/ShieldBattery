import React from 'react'
import { connect } from 'react-redux'
import styles from './loading-filter.css'

import LoadingIndicator from '../progress/dots.jsx'

@connect(state => ({ loading: state.loading }))
export default class LoadingFilter extends React.Component {
  render() {
    // TODO(tec27): make a really awesome loading screen
    if (this.props.loading.some(v => v)) {
      return (
        <div className={styles.loadingArea}>
          <LoadingIndicator />
        </div>
      )
    } else {
      return React.Children.only(this.props.children)
    }
  }
}
