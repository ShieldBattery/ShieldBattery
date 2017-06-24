import React from 'react'
import { connect } from 'react-redux'
import siteSocket from './site-socket'
import { makeServerUrl } from './server-url'
import styles from './site-connected-filter.css'

import LoadingIndicator from '../progress/dots.jsx'

let applyCookies = async() => {}
if (process.webpackEnv.SB_ENV === 'electron') {
  const { remote } = require('electron')
  const curSession = remote.require('./current-session.js').default
  // engine.io uses Node APIs to make web requests in Electron, so we have to explicitly put the
  // right cookies on its headers
  applyCookies = async() => {
    return new Promise(resolve => {
      curSession().cookies.get({ url: makeServerUrl('') }, (err, cookies) => {
        if (err) {
          resolve()
          return
        }
        siteSocket.opts.extraHeaders = {
          Origin: 'http://client.shieldbattery.net',
          'x-shield-battery-client': 'true',
          Cookie: cookies
            .map(c => `${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}`)
            .join('; '),
        }
        resolve()
      })
    })
  }
}

@connect(state => ({ siteNetwork: state.network.site }))
export default class SiteConnectedFilter extends React.Component {
  mounted = false;

  componentDidMount() {
    this.mounted = true
    applyCookies().then(() => {
      if (this.mounted) {
        siteSocket.connect()
      }
    })
  }

  componentWillUnmount() {
    this.mounted = false
    siteSocket.disconnect()
  }

  render() {
    // TODO(tec27): just render an overlay if we were previously connected? (This would help avoid
    // losing transient state, like the state of inputs, if we get disconnected briefly)
    if (this.props.siteNetwork.isConnected) {
      return React.Children.only(this.props.children)
    } else {
      return <div className={styles.loadingArea}><LoadingIndicator /></div>
    }
  }
}
