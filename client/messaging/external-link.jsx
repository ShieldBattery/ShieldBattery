import React from 'react'
import { connect } from 'react-redux'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'

function ExternalLink({ href, innerText, dispatch, localSettings }) {
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
        const isHostTrusted = trustAllLinks || trustedHosts.some(h => h === host)

        if (!isHostTrusted) {
          e.preventDefault()
          dispatch(openDialog(DialogType.UntrustedLink, { href, host }))
        }
      }}>
      {innerText}
    </a>
  )
}

export default connect(state => ({ localSettings: state.settings.local }))(ExternalLink)
