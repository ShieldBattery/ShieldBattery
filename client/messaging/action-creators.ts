import { MouseEvent } from 'react'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import { JsonLocalStorageValue } from '../local-storage'
import { getServerOrigin } from '../network/server-url'

const trustedDomainsValue = new JsonLocalStorageValue<string[]>('trustedDomains')

/**
 * Returns whether `domain` (an origin string, e.g. `https://example.com`) is the server's own
 * origin or one the user has previously chosen to trust.
 */
export function isDomainTrusted(domain: string): boolean {
  const trustedDomains = trustedDomainsValue.getValue() ?? []
  const serverOrigin = getServerOrigin().toLowerCase()
  return domain === serverOrigin || trustedDomains.includes(domain)
}

export function maybeOpenExternalLinkDialog(e: MouseEvent<HTMLAnchorElement>): ThunkAction {
  return (dispatch, getState) => {
    const { href, host, protocol } = e.currentTarget

    if (!href || !host || !protocol) return

    const domain = `${protocol.toLowerCase()}//${host.toLowerCase()}`

    if (!isDomainTrusted(domain)) {
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
