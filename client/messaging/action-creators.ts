import { MouseEvent } from 'react'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import { getServerOrigin } from '../network/server-url'

export function maybeOpenExternalLinkDialog(e: MouseEvent<HTMLAnchorElement>): ThunkAction {
  return (dispatch, getState) => {
    const trustedDomains = getState().settings.local.trustedDomains
    const { href, host, protocol } = e.currentTarget

    if (!href || !host || !protocol) return

    const domain = `${protocol.toLowerCase()}//${host.toLowerCase()}`
    const serverOrigin = getServerOrigin().toLowerCase()
    const isHostTrusted = domain === serverOrigin || trustedDomains.some(d => d === domain)

    if (!isHostTrusted) {
      e.preventDefault()
      dispatch(openDialog(DialogType.ExternalLink, { href, domain }))
    }
  }
}
