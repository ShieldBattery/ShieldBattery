import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import siteSocket from './site-socket'

import LoadingIndicator from '../progress/dots'

if (IS_ELECTRON) {
  siteSocket.opts.transportOptions = {
    polling: {
      extraHeaders: {
        'x-shield-battery-client': 'true',
      },
    },
  }
}

const LoadingArea = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;

  -webkit-app-region: drag;
`

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
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }
  }
}
