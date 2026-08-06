import styled from 'styled-components'
import { DEFAULT_PERMISSIONS } from '../../../common/users/permissions'
import { SelfUserJson } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { HostGame } from '../create/host-game'
import { IsolatedReduxProvider } from './isolated-redux'

// An id well above the ones a development database hands out, so a background user fetch can't
// overwrite this with whoever really holds the low id.
const DEV_HOST_ID = makeSbUserId(90010)

const DEV_HOST_USER: SelfUserJson = {
  id: DEV_HOST_ID,
  name: 'devHost',
  created: 0,
  loginName: 'devHost',
  email: 'devhost@example.com',
  emailVerified: true,
  acceptedPrivacyVersion: 0,
  acceptedTermsVersion: 0,
  acceptedUsePolicyVersion: 0,
  nameChangeTokens: 0,
}

const SEED_ACTIONS: ReadonlyArray<ReduxAction> = [
  {
    type: '@auth/loadCurrentSession',
    payload: { user: DEV_HOST_USER, permissions: { ...DEFAULT_PERMISSIONS }, jwt: '' },
  },
]

const Container = styled.div`
  width: 100%;
  height: 100%;
  overflow-y: auto;
`

export function HostGameTest() {
  return (
    <IsolatedReduxProvider seedActions={SEED_ACTIONS}>
      <Container>
        <HostGame
          createLobbyOverride={params => console.log('createLobby', params)}
          savePreferencesOverride={prefs => console.log('savePreferences', prefs)}
        />
      </Container>
    </IsolatedReduxProvider>
  )
}
