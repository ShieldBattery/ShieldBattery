import React from 'react'
import { connect, DispatchProp } from 'react-redux'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { LocalSettings } from '../settings/settings-records'

interface ExternalLinkProps {
  href: string
  innerText: string
  localSettings: LocalSettings
}

function ExternalLink({
  href,
  innerText,
  dispatch,
  localSettings,
}: ExternalLinkProps & DispatchProp) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noopener nofollow'
      onClick={e => {
        // assume here `href` will always be a valid url
        const url = new URL(href)
        const host = url.host
        const { trustAllLinks, trustedHosts } = localSettings
        const isHostTrusted = trustAllLinks || trustedHosts.some((h: string) => h === host)

        if (!isHostTrusted) {
          e.preventDefault()
          dispatch(openDialog(DialogType.UntrustedLink, { href, host }))
        }
      }}>
      {innerText}
    </a>
  )
}

type WithLocalSettings = {
  settings: { local: LocalSettings }
}

export default connect((state: WithLocalSettings) => ({
  localSettings: state.settings.local,
}))(ExternalLink)
