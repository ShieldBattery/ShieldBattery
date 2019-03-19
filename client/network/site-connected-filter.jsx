import React from 'react'
import { connect } from 'react-redux'
import siteSocket from './site-socket'
import styles from './site-connected-filter.css'

import LoadingIndicator from '../progress/dots.jsx'

if (IS_ELECTRON) {
  siteSocket.opts.extraHeaders = {
    'x-shield-battery-client': 'true',
  }
}

@connect(state => ({ siteNetwork: state.network.site }))
export default class SiteConnectedFilter extends React.Component {
  componentDidMount() {
    siteSocket.connect()
  }

  componentWillUnmount() {
    siteSocket.disconnect()
  }

  render() {
    // TODO(tec27): just render an overlay if we were previously connected? (This would help avoid
    // losing transient state, like the state of inputs, if we get disconnected briefly)
    if (this.props.siteNetwork.isConnected) {
      return React.Children.only(this.props.children)
    } else {
      return (
        <div className={styles.loadingArea}>
          <LoadingIndicator />
        </div>
      )
    }
  }
}
