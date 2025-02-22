import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaisedButton } from '../material/button'
import { CenteredContentContainer } from '../styles/centered-container'
import { headline5, subtitle1 } from '../styles/typography'

const Message = styled.div`
  ${headline5};
  margin-top: 24px;
  text-align: center;
`

const InstallerLinks = styled.div`
  margin: 40px auto 0;
  text-align: center;
`

const InstallerButtonLabel = styled.span`
  ${subtitle1};
  height: 48px;
  display: flex;
  align-items: center;
`

export function OnlyInApp() {
  const { t } = useTranslation()

  const onDownloadClick = () => {
    window.fathom?.trackGoal('BCSXAXFR', 0)
    window.location.assign(`/published_artifacts/win/ShieldBattery.latest.exe?t${Date.now()}`)
  }

  return (
    <CenteredContentContainer>
      <Message>
        {t('clientDownload.onlyInApp', 'This feature is only available in the app.')}
      </Message>
      <InstallerLinks>
        <RaisedButton
          onClick={onDownloadClick}
          iconStart={<MaterialIcon icon='download' />}
          label={
            <InstallerButtonLabel>{t('clientDownload.download', 'Download')}</InstallerButtonLabel>
          }
        />
      </InstallerLinks>
    </CenteredContentContainer>
  )
}
