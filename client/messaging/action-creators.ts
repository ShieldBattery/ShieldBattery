import { MouseEvent } from 'react'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'

export function maybeOpenExternalLinkDialog(e: MouseEvent<HTMLAnchorElement>): ThunkAction {
  return (dispatch, getState) => {
    const trustedHosts: string[] = getState().settings.local.trustedHosts
    const { href, host } = e.currentTarget

    if (!href || !host) return

    const isHostTrusted = trustedHosts.some(h => h === host)

    if (!isHostTrusted) {
      e.preventDefault()
      dispatch(openDialog(DialogType.ExternalLink, { href, host }))
    }
  }
}
