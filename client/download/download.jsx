import React from 'react'
import styles from './download.css'

import RaisedButton from '../material/raised-button.jsx'
import GetApp from '../icons/material/ic_get_app_black_36px.svg'

export default class Download extends React.Component {
  render() {
    return (<div>
      <p className={styles.blurb}>
        Download the ShieldBattery standalone client to play games, watch replays, and more!
      </p>
      <div className={styles.installerLinks}>
        <RaisedButton className={styles.installerLink} onClick={this.onDownloadClick}
          label={<span className={styles.buttonLabel}>
            <GetApp className={styles.icon}/><span>Download client</span>
          </span>}/>
      </div>
    </div>)
  }

  onDownloadClick = () => {
    window.location.assign('/published_artifacts/win/ShieldBattery.latest.exe')
  };
}
