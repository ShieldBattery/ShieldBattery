import { getErrorStack } from '../../common/errors'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { isDomainTrusted } from '../messaging/action-creators'
import { isSbContentUrl, isShieldBatteryUrl } from './external-link'
import { push } from './routing'

/**
 * Navigates to `href` the same way clicking on it would: in-app SPA navigation for ShieldBattery
 * app URLs, a new window for content URLs and trusted/own-origin URLs, or the external link
 * warning dialog for everything else.
 */
export function openLink(href: string): ThunkAction {
  return dispatch => {
    let url: URL
    try {
      url = new URL(href)
    } catch (err) {
      logger.error(`Tried to open link with invalid URL: ${href}: ${getErrorStack(err)}`)
      return
    }

    if (isShieldBatteryUrl(url) && !isSbContentUrl(url)) {
      push(url.pathname + url.search + url.hash)
      return
    }

    const domain = `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`
    if (isSbContentUrl(url) || isDomainTrusted(domain)) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }

    dispatch(openDialog({ type: DialogType.ExternalLink, initData: { href, domain } }))
  }
}
