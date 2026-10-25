import { useAtomValue } from 'jotai'
import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useIsLoggedIn } from '../auth/auth-utils'
import { MaterialIcon } from '../icons/material/material-icon'
import { elevationPlus3 } from '../material/shadows'
import { zIndexConnectionStatus } from '../material/zindex'
import { bodyMedium } from '../styles/typography'
import { siteConnectionAtom } from './network-atoms'

/** How long we can go without a connection before saying so, so quick reconnects don't flash. */
export const CONNECTION_STATUS_GRACE_MS = 3000

const Container = styled(m.div)`
  position: fixed;
  left: 50%;
  /* Straddles the top edge of the app bar (or sits just inside it, without a system bar) */
  top: max(var(--sb-system-bar-height, 0px), 24px);
  z-index: ${zIndexConnectionStatus};

  pointer-events: none;
`

const Pill = styled.div`
  ${elevationPlus3};
  ${bodyMedium};

  max-width: 560px;
  min-height: 40px;
  padding: 8px 16px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: var(--theme-inverse-surface);
  border-radius: 20px;
  color: var(--theme-inverse-on-surface);
  font-weight: 500;
`

const variants: Variants = {
  initial: { opacity: 0, scale: 0.9, translateX: '-50%', translateY: '-50%' },
  visible: { opacity: 1, scale: 1, translateX: '-50%', translateY: '-50%' },
  exit: { opacity: 0, scale: 0.9, translateX: '-50%', translateY: '-50%' },
}

const transition: Transition = {
  default: { type: 'spring', duration: 0.4 },
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
}

/**
 * Shows when we've been without a usable connection to the server for a while, so it's clear why
 * things that need it aren't working. Everything that works offline keeps working underneath.
 */
export function ConnectionStatus() {
  const { t } = useTranslation()
  const isLoggedIn = useIsLoggedIn()
  const { status, since } = useAtomValue(siteConnectionAtom)
  const [now, setNow] = useState(() => Date.now())

  // A refused client is told why separately
  const connecting = isLoggedIn && (status === 'disconnected' || status === 'admitting')
  const graceEndsAt = since + CONNECTION_STATUS_GRACE_MS
  useEffect(() => {
    if (!connecting) {
      return () => {}
    }
    const timeout = setTimeout(() => setNow(Date.now()), Math.max(0, graceEndsAt - Date.now()))
    return () => clearTimeout(timeout)
  }, [connecting, graceEndsAt])

  return (
    <AnimatePresence>
      {connecting && now >= graceEndsAt ? (
        <Container
          key='connection-status'
          variants={variants}
          initial='initial'
          animate='visible'
          exit='exit'
          transition={transition}
          role='status'
          data-testid='connection-status'>
          <Pill>
            <MaterialIcon icon='cloud_off' />
            <span>{t('network.connectionStatus.connecting', 'Connecting to ShieldBattery…')}</span>
          </Pill>
        </Container>
      ) : null}
    </AnimatePresence>
  )
}
