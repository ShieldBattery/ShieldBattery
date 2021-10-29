import React from 'react'
import { connect } from 'react-redux'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'

function ExternalLink({ href, innerText, dispatch }) {
  const trustedHosts = ['localhost:3000', 'example.org']
  // assume here `href` will always be a valid url
  const url = new URL(href)
  const host = url.host
  const isHostTrusted = trustedHosts.some(h => h === host)

  return (
    <a
      href={href}
      target='_blank'
      rel='noopener nofollow'
      onClick={e => {
        if (!isHostTrusted) {
          e.preventDefault()
          dispatch(openDialog(DialogType.UntrustedLink, { href, host }))
        }
      }}>
      {innerText}
    </a>
  )
}

export default connect()(ExternalLink)
