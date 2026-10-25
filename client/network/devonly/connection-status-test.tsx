import styled from 'styled-components'
import { jotaiStore } from '../../jotai-store'
import { FilledButton } from '../../material/button'
import { push } from '../../navigation/routing'
import { BodyLarge } from '../../styles/typography'
import { showConnectionRefused } from '../connection-refused-dialog'
import { CONNECTION_STATUS_GRACE_MS } from '../connection-status'
import { siteConnectionAtom } from '../network-atoms'

const Root = styled.div`
  padding: 16px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
`

function showConnecting() {
  jotaiStore.set(siteConnectionAtom, {
    status: 'disconnected',
    since: Date.now() - CONNECTION_STATUS_GRACE_MS,
  })
  push('/')
}

function showVerificationFailed() {
  jotaiStore.set(siteConnectionAtom, {
    status: 'refused',
    since: Date.now(),
    refusal: 'clientVerification',
  })
  push('/')
  showConnectionRefused('clientVerification')
}

function showUpdateRequired() {
  jotaiStore.set(siteConnectionAtom, {
    status: 'refused',
    since: Date.now(),
    refusal: 'clientUpdate',
  })
  push('/')
  showConnectionRefused('clientUpdate')
}

export function ConnectionStatusTest() {
  return (
    <Root>
      <BodyLarge>
        Sets the connection state and goes to the home page to show it. Reload the app to go back to
        the real connection state.
      </BodyLarge>
      <FilledButton label='Connecting' onClick={showConnecting} />
      <FilledButton label='Verification failed' onClick={showVerificationFailed} />
      <FilledButton
        label='Update required (no update found, dialog shows after 15s)'
        onClick={showUpdateRequired}
      />
    </Root>
  )
}
