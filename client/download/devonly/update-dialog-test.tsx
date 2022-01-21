import React, { useState } from 'react'
import Card from '../../material/card'
import CheckBox from '../../material/check-box'
import { Subtitle1 } from '../../styles/typography'
import { UpdateDialog } from '../update-overlay'

export function UpdateDialogTest() {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [hasDownloadError, setHasDownloadError] = useState(false)
  const [readyToInstall, setReadyToInstall] = useState(false)

  return (
    <div>
      <Card>
        <Subtitle1>Settings</Subtitle1>
        <CheckBox
          label='Has update'
          checked={hasUpdate}
          onChange={() => setHasUpdate(!hasUpdate)}
        />
        <CheckBox
          label='Has download error'
          checked={hasDownloadError}
          onChange={() => setHasDownloadError(!hasDownloadError)}
        />
        <CheckBox
          label='Ready to install'
          checked={readyToInstall}
          onChange={() => setReadyToInstall(!readyToInstall)}
        />
      </Card>

      <UpdateDialog
        hasUpdate={hasUpdate}
        hasDownloadError={hasDownloadError}
        readyToInstall={readyToInstall}
      />
    </div>
  )
}
