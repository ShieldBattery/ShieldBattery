import React from 'react'
import { connect } from 'react-redux'
import { makeServerUrl } from '../network/server-url'
import styles from './login-layout.css'

import LogoText from '../logos/logotext-640x100.svg'
import WindowControls from '../window-controls.jsx'

@connect(state => ({ winMaximized: state.settings.local.winMaximized }))
class MainLayout extends React.Component {
  render() {
    return (<div className={styles.background}>
      <WindowControls winMaximized={this.props.winMaximized} className={styles.windowControls}/>
      <div className={styles.wrapper}>
          <div className={styles.contents}>
            <img className={styles.logo} src={makeServerUrl('/images/logo.svg')} />
            <div className={styles.logoText}><LogoText /></div>
            <div>
              { this.props.children }
            </div>
          </div>
      </div>
    </div>)
  }
}

export default MainLayout
