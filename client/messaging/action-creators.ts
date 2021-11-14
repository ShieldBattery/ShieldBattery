import { MouseEvent } from 'react'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { getServerOrigin } from '../network/server-url'

// TODO(tec27): Move this to a more common location
class JsonLocalStorageValue<T> {
  constructor(readonly name: string) {}

  /**
   * Retrieves the current `localStorage` value (parsed as JSON).
   * @returns the parsed value, or `undefined` if it isn't set or fails to parse.
   */
  getValue(): T | undefined {
    const valueJson = localStorage.getItem(this.name)
    if (valueJson === null) {
      return undefined
    }

    try {
      return JSON.parse(valueJson)
    } catch (err) {
      logger.error(`error parsing value for ${this.name}: ${(err as any).stack ?? err}`)
      return undefined
    }
  }

  /**
   * Sets the current `localStorage` value, encoding it as JSON.
   */
  setValue(value: T): void {
    localStorage.setItem(this.name, JSON.stringify(value))
  }

  /**
   * Clears (unsets) the current `localStorage` value.
   */
  clear(): void {
    localStorage.removeItem(this.name)
  }
}

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
      dispatch(openDialog(DialogType.ExternalLink, { href, domain }))
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
