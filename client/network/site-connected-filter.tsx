import React, { useEffect } from 'react'
import styled from 'styled-components'
import logger from '../logging/logger'
import LoadingIndicator from '../progress/dots'
import { useAppSelector } from '../redux-hooks'
import { colorTextSecondary } from '../styles/colors'
import { headline5 } from '../styles/typography'
import siteSocket from './site-socket'
import { useTranslation } from 'react-i18next'

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

export function SiteConnectedFilter(props: SiteConnectedFilterProps) {
  const { siteNetwork } = useAppSelector(state => ({ siteNetwork: state.network.site }))
  const { t } = useTranslation()

  useEffect(() => {
    siteSocket.connect()
    return () => {
      logger.verbose('SiteConnectedFilter unmounted, disconnecting siteSocket')
      siteSocket.disconnect()
    }
  }, [])

  // TODO(tec27): just render an overlay if we were previously connected? (This would help avoid
  // losing transient state, like the state of inputs, if we get disconnected briefly)
  if (siteNetwork.isConnected) {
    return <>{React.Children.only(props.children)}</>
  } else {
    return (
      <LoadingArea>
        <LoadingIndicator showImmediately={true} />
        <ConnectingText>{t('network.siteConnectedFilter.connectingLabel', 'Connecting\u2026')}</ConnectingText>
      </LoadingArea>
    )
  }
}
