import React from 'react'
import arch from 'arch'
import styles from './download.css'

import FlatButton from '../material/flat-button.jsx'
import RaisedButton from '../material/raised-button.jsx'
import GetApp from '../icons/material/ic_get_app_black_36px.svg'

const DownloadOption = ({name, path, isPrimary}) => {
  const Component = isPrimary ? RaisedButton : FlatButton
  return (<Component className={isPrimary ? styles.primary : styles.secondary}
      onClick={() => { window.location.assign(path) } }
      label={<span className={styles.buttonLabel}>
            <GetApp className={styles.icon}/><span>Download {name} version</span>
          </span>}/>)
}

export default class Download extends React.Component {
  render() {
    const is64 = arch() === 'x64'
    return (<div>
      <p className={styles.blurb}>
        Download the ShieldBattery standalone client to play games, watch replays, and more!
      </p>
      <div className={styles.installerLinks}>
        <DownloadOption name={'64-bit'} path={'/ShieldBattery_x64.msi'} isPrimary={is64} />
        <DownloadOption name={'32-bit'} path={'/ShieldBattery_x86.msi'} isPrimary={!is64} />
      </div>
    </div>)
  }
}
