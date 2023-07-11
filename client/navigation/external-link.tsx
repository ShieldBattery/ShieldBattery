import React, { useMemo } from 'react'
import logger from '../logging/logger'
import { maybeOpenExternalLinkDialog } from '../messaging/action-creators'
import { getServerOrigin, makeServerUrl } from '../network/server-url'
import { useAppDispatch } from '../redux-hooks'
import { push } from './routing'

export interface ExternalLinkProps {
  href: string
  children: React.ReactNode
  className?: string
  forceNewWindow?: boolean
}

const ELECTRON_PROTO = 'shieldbattery:'
const ELECTRON_HOST = 'app'
const ELECTRON_ORIGIN = `${ELECTRON_PROTO}//${ELECTRON_HOST}`

function isShieldBatteryUrl(url: URL): boolean {
  const urlOrigin = url.origin.toLowerCase()
  return urlOrigin === ELECTRON_ORIGIN || urlOrigin === getServerOrigin().toLowerCase()
}

/**
 * A link that may point to an external (non-ShieldBattery) site. If it does, users will be warned
 * about the navigation before a new window opens. If it points to a ShieldBattery URL, users will
 * not be warned and it will open in this window unless `forceNewWindow` is `true`.
 */
export function ExternalLink({ href, children, className, forceNewWindow }: ExternalLinkProps) {
  const dispatch = useAppDispatch()

  const url = useMemo(() => {
    try {
      const url = new URL(href)
      if (IS_ELECTRON && isShieldBatteryUrl(url)) {
        // NOTE(tec27): The code flow is a bit weird here but it is convenient: we mutate the URL so
        // that Electron will navigate to the right spot if we're not opening a new window, but if
        // we *are* opening a new window (because ctrl or shift is held), we want to open the
        // external URL (which will be the href on the anchor tag)
        url.protocol = ELECTRON_PROTO
        url.host = ELECTRON_HOST
      }
      return url
    } catch (err) {
      logger.error(`Tried to render link with invalid URL: ${href}`)
      return undefined
    }
  }, [href])

  const isInternal = url && isShieldBatteryUrl(url)

  if (!isInternal) {
    return (
      <a
        className={className}
        href={href}
        target='_blank'
        rel='nofollow noreferrer noopener'
        onClick={e => dispatch(maybeOpenExternalLinkDialog(e))}>
        {children}
      </a>
    )
  } else if (forceNewWindow) {
    const newWindowUrl = makeServerUrl(url.pathname + url.search + url.hash)
    return (
      <a className={className} href={newWindowUrl} target='_blank' rel='noopener'>
        {children}
      </a>
    )
  } else {
    const navigateToLink = (e: React.MouseEvent) => {
      if (!e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        push(url.href)
      }
    }

    return (
      <a
        className={className}
        href={makeServerUrl(url.pathname + url.search + url.hash)}
        onClick={navigateToLink}>
        {children}
      </a>
    )
  }
}
