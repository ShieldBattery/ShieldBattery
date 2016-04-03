import React from 'react'
import styles from './content-layout.css'

import AppBar from '../material/app-bar.jsx'

export default class ContentLayout extends React.Component {
  static propTypes = {
    actions: React.PropTypes.arrayOf(React.PropTypes.element),
    title: React.PropTypes.string,
  };

  render() {
    return (<div className={styles.content}>
      <AppBar title={this.props.title}>
        {this.props.actions}
      </AppBar>
      { this.props.children }
    </div>)
  }
}
