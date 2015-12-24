import React from 'react'
import styles from './app-bar.css'

class AppBar extends React.Component {
  render() {
    return (<header className={styles.appBar}>
      <h4 className={styles.title}>{this.props.title}</h4>
      { this.props.children }
    </header>)
  }
}

export default AppBar
