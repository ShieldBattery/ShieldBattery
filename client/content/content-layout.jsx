import React from 'react'
import PropTypes from 'prop-types'
import styles from './content-layout.css'

import AppBar from '../material/app-bar.jsx'

export default class ContentLayout extends React.Component {
  static propTypes = {
    actions: PropTypes.arrayOf(PropTypes.element),
    title: PropTypes.string,
    appBarContentClassName: PropTypes.string,
  };

  render() {
    return (<div className={styles.content}>
      <AppBar title={this.props.title} contentClassName={this.props.appBarContentClassName}>
        {this.props.actions}
      </AppBar>
      { this.props.children }
    </div>)
  }
}
