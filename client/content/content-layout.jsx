import React from 'react'
import { connect } from 'react-redux'
import styles from './content-layout.css'

import AppBar from '../material/app-bar.jsx'

@connect()
export default class ContentLayout extends React.Component {
  static propTypes = {
    actions: React.PropTypes.arrayOf(React.PropTypes.element),
    title: React.PropTypes.string,
  }

  render() {
    return (<div className={styles.content}>
      <AppBar title={this.props.title}>
        {this.props.actions}
      </AppBar>
      { this.props.children }
    </div>)
  }
}
