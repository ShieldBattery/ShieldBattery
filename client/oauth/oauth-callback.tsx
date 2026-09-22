import { useEffect } from 'react'
import styled from 'styled-components'
import { OauthProvider } from '../../common/ipc'
import { LoadingDotsArea } from '../progress/dots'
import { OAUTH_MESSAGE_TYPE, OAuthResult } from './oauth-flow'

const Root = styled.div`
  width: 100%;
  height: 100%;
`

/**
 * The page a provider redirects back to after the user authorizes (or declines) linking. It runs
 * inside the OAuth popup, relays the `code`/`state` (or error) from the URL back to the opener
 * window that started the flow, and then closes itself. See `openOAuthPopup`.
 */
export function OAuthCallback({ provider }: { provider: OauthProvider }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result: OAuthResult = {
      type: OAUTH_MESSAGE_TYPE,
      provider,
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
      error: params.get('error') ?? undefined,
      errorDescription: params.get('error_description') ?? undefined,
    }

    window.opener?.postMessage(result, window.location.origin)
    window.close()
  }, [provider])

  return (
    <Root>
      <LoadingDotsArea />
    </Root>
  )
}
