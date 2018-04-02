import React from 'react'
import styles from './activity-bar.css'

export default class ActivityBar extends React.Component {
  render() {
    return <div className={styles.activityBar}>{this.props.children}</div>
  }
}
