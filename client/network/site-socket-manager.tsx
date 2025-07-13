import { memo, useEffect } from 'react'
import { useSelfUser } from '../auth/auth-utils'
import logger from '../logging/logger'
import siteSocket from './site-socket'

/**
 * React component that connects the site websocket if logged in, and disconnects it when no longer
 * logged in.
 */
export const SiteSocketManager = memo(() => {
  const user = useSelfUser()
  const userId = user?.id

  useEffect(() => {
    if (!userId) {
      // Logged out users can't use websockets
      return () => {}
    }

    // We wait a bit of time after mounting to connect, as StrictMode unmount/remount can cause
    // a bunch of extra socket connections to happen that don't go away on the server until they
    // time out. This shouldn't really be an issue in production, but it's nicer to have the code
    // be the same in both places
    let connected = false
    const timeout = setTimeout(() => {
      siteSocket.connect()
      connected = true
    }, 50)

    return () => {
      clearTimeout(timeout)

      if (connected) {
        logger.verbose('SiteSocketManager effect cleanup, disconnecting siteSocket')
        siteSocket.disconnect()
      }
    }
  }, [userId])

  return <></>
})
