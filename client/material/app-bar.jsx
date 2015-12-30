import React from 'react'
import styles from './app-bar.css'

class AppBar extends React.Component {
  render() {
    // ensure the other components that align to baseline have this to align to always
    const title = this.props.title != null ? this.props.title : <span>&nbsp;</span>
    return (<header className={styles.appBar}>
      <h4 className={styles.title}>{title}</h4>
      { this.props.children }
    </header>)
  }
}

export default AppBar
