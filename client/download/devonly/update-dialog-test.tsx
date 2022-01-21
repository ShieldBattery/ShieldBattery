import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import Card from '../../material/card'
import CheckBox from '../../material/check-box'
import TextField from '../../material/text-field'
import { Subtitle1 } from '../../styles/typography'
import { UpdateDialog } from '../update-overlay'
import { UpdateProgress } from '../updater-state'

const SettingsCard = styled(Card)`
  max-width: 400px;
`

export function UpdateDialogTest() {
  const [hasUpdate, setHasUpdate] = useState(true)
  const [hasDownloadError, setHasDownloadError] = useState(false)
  const [readyToInstall, setReadyToInstall] = useState(false)

  const [progressKnown, setProgressKnown] = useState(false)
  const [totalBytes, setTotalBytes] = useState(String(1_727_829_134))
  const [bytesTransferred, setBytesTransferred] = useState(String(1_345_678))
  const [bytesPerSecond, setBytesPerSecond] = useState(String(15_678))

  const progress = useMemo<UpdateProgress | undefined>(
    () =>
      progressKnown
        ? {
            totalBytes: Number(totalBytes),
            bytesTransferred: Number(bytesTransferred),
            bytesPerSecond: Number(bytesPerSecond),
          }
        : undefined,
    [progressKnown, totalBytes, bytesTransferred, bytesPerSecond],
  )

  return (
    <div>
      <SettingsCard>
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

        <CheckBox
          label='Progress known'
          checked={progressKnown}
          onChange={() => setProgressKnown(!progressKnown)}
        />
        <TextField
          floatingLabel={true}
          label='Total bytes'
          value={totalBytes}
          type='number'
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotalBytes(e.target.value)}
        />
        <TextField
          floatingLabel={true}
          label='Bytes trasnferred'
          value={bytesTransferred}
          type='number'
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBytesTransferred(e.target.value)}
        />
        <TextField
          floatingLabel={true}
          label='Bytes per second'
          value={bytesPerSecond}
          type='number'
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBytesPerSecond(e.target.value)}
        />
      </SettingsCard>

      <UpdateDialog
        hasUpdate={hasUpdate}
        hasDownloadError={hasDownloadError}
        readyToInstall={readyToInstall}
        progress={progress}
      />
    </div>
  )
}
