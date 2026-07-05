import { useEffect } from 'react'
import styled from 'styled-components'
import { LoadingDotsArea } from '../progress/dots'
import { TWITCH_OAUTH_MESSAGE_TYPE, TwitchOAuthResult } from './twitch-oauth'

const Root = styled.div`
  width: 100%;
  height: 100%;
`

/**
 * The page Twitch redirects back to after the user authorizes (or declines) linking. It runs inside
 * the OAuth popup, relays the `code`/`state` (or error) from the URL back to the opener window that
 * started the flow, and then closes itself. See `openTwitchOAuthPopup`.
 */
export function TwitchOAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result: TwitchOAuthResult = {
      type: TWITCH_OAUTH_MESSAGE_TYPE,
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
      error: params.get('error') ?? undefined,
      errorDescription: params.get('error_description') ?? undefined,
    }

    window.opener?.postMessage(result, window.location.origin)
    window.close()
  }, [])

  return (
    <Root>
      <LoadingDotsArea />
    </Root>
  )
}
