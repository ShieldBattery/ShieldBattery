import { MouseEvent } from 'react'
import { openDialog } from '../dialogs/action-creators.js'
import { DialogType } from '../dialogs/dialog-type.js'
import { ThunkAction } from '../dispatch-registry.js'
import { JsonLocalStorageValue } from '../local-storage.js'
import { getServerOrigin } from '../network/server-url.js'

const trustedDomainsValue = new JsonLocalStorageValue<string[]>('trustedDomains')

export function maybeOpenExternalLinkDialog(e: MouseEvent<HTMLAnchorElement>): ThunkAction {
  return (dispatch, getState) => {
    const trustedDomains = trustedDomainsValue.getValue() ?? []
    const { href, host, protocol } = e.currentTarget

    if (!href || !host || !protocol) return

    const domain = `${protocol.toLowerCase()}//${host.toLowerCase()}`
    const serverOrigin = getServerOrigin().toLowerCase()
    const isHostTrusted = domain === serverOrigin || trustedDomains.includes(domain)

    if (!isHostTrusted) {
      e.preventDefault()
      dispatch(openDialog({ type: DialogType.ExternalLink, initData: { href, domain } }))
    }
  }
}

export function addTrustedDomain(domain: string): ThunkAction {
  return () => {
    const trustedDomains = trustedDomainsValue.getValue() ?? []
    trustedDomains.push(domain)
    trustedDomainsValue.setValue(trustedDomains)
  }
}
