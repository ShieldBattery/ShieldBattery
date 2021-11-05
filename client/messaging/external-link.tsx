import React from 'react'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { RootState } from '../root-reducer'
import { LocalSettings } from '../settings/settings-records'

interface ExternalLinkProps {
  href: string
  innerText: string
}

const localSettingsSelector = (s: RootState) => s.settings.local

export default function ExternalLink({ href, innerText }: ExternalLinkProps) {
  const dispatch = useAppDispatch()
  const localSettings: LocalSettings = useAppSelector(localSettingsSelector)

  return (
    <a
      href={href}
      target='_blank'
      rel='noopener nofollow'
      onClick={e => {
        // assume here `href` will always be a valid url
        const url = new URL(href)
        const host = url.host
        const { trustedHosts } = localSettings
        const isHostTrusted = trustedHosts.some(h => h === host)

        if (!isHostTrusted) {
          e.preventDefault()
          dispatch(openDialog(DialogType.ExternalLink, { href, host }))
        }
      }}>
      {innerText}
    </a>
  )
}
