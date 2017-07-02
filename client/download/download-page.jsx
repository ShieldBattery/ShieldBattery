import React from 'react'
import { makeServerUrl } from '../network/server-url'
import styles from './download.css'

import Download from './download.jsx'
import LogoText from '../logos/logotext-640x100.svg'

export default class DownloadPage extends React.Component {
  render() {
    return (
      <div>
        <div className={styles.wrapper}>
          <img className={styles.logo} src={makeServerUrl('/images/logo.svg')} />
          <div className={styles.logoText}>
            <LogoText />
          </div>
          <div>
            <Download />
          </div>
        </div>
      </div>
    )
  }
}
