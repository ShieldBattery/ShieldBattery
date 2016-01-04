import React from 'react'
import { connect } from 'react-redux'
import styles from './content-layout.css'

import AppBar from '../material/app-bar.jsx'
import IconButton from '../material/icon-button.jsx'

@connect()
export default class ContentLayout extends React.Component {
  static propTypes = {
    title: React.PropTypes.string,
  }

  render() {
    return (<div className={styles.content}>
      <AppBar title={this.props.title}>
        <IconButton icon='more_vert' title='More options' />
      </AppBar>
      { this.props.children }
    </div>)
  }
}
