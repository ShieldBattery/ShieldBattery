import React, { useEffect } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'
import LoadingIndicator from '../progress/dots'
import { colorTextSecondary } from '../styles/colors'
import { headline5 } from '../styles/typography'
import siteSocket from './site-socket'

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
  flex-direction: column;

  align-items: center;
  justify-content: center;

  -webkit-app-region: drag;
`

const ConnectingText = styled.div`
  ${headline5};
  color: ${colorTextSecondary};
  margin-top: 64px;
`

interface SiteConnectedFilterProps {
  children: React.ReactNode
}

export default function SiteConnectedFilter(props: SiteConnectedFilterProps) {
  // TODO(tec27): type the root state so we can remove this any
  const { siteNetwork } = useSelector<any, any>(state => ({ siteNetwork: state.network.site }))

  useEffect(() => {
    siteSocket.connect()
    return () => siteSocket.disconnect()
  }, [])

  // TODO(tec27): just render an overlay if we were previously connected? (This would help avoid
  // losing transient state, like the state of inputs, if we get disconnected briefly)
  if (siteNetwork.isConnected) {
    return React.Children.only(props.children)
  } else {
    return (
      <LoadingArea>
        <LoadingIndicator showImmediately={true} />
        <ConnectingText>Connecting…</ConnectingText>
      </LoadingArea>
    )
  }
}
