import React from 'react'
import styled from 'styled-components'
import GithubIcon from '../icons/brands/github.svg'
import KofiIcon from '../icons/brands/kofi-lockup.svg'
import PatreonIcon from '../icons/brands/patreon-lockup.svg'
import GetApp from '../icons/material/get_app-36px.svg'
import { RaisedButton } from '../material/button'
import { colorTextPrimary, colorTextSecondary } from '../styles/colors'
import { headline5, subtitle1 } from '../styles/typography'
import { useTranslation } from 'react-i18next'

const Blurb = styled.div`
  ${headline5};
  font-weight: 300;
`

const BlurbList = styled.ul`
  ${headline5};
  margin: 0;
  padding: 0;

  color: ${colorTextSecondary};
  font-weight: 300;

  & > li {
    margin-top: 4px;
    margin-left: 24px;
  }
`

const SupportText = styled.div`
  ${subtitle1};
  margin-top: 32px;
`

const SupportLinks = styled.div`
  display: flex;
  align-items: flex-start;

  margin-top: 8px;
  /** Offset for the inner padding of the first item */
  margin-left: -16px;

  a,
  a:link,
  a:visited {
    height: 48px;
    display: flex;
    align-items: center;
    color: ${colorTextSecondary};
    padding-left: 16px;
    padding-right: 16px;
    overflow: hidden;

    &:hover,
    &:active {
      color: ${colorTextPrimary};
    }
  }
`
const StyledGithubIcon = styled(GithubIcon)`
  height: 40px;
`

const StyledKofiIcon = styled(KofiIcon)`
  height: 40px;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  height: 24px;
`

const InstallerLinks = styled.div`
  margin: 24px auto 0;
  text-align: center;
`

const InstallerButtonIcon = styled(GetApp)`
  width: 24px;
  height: 24px;
  margin-right: 8px;
  color: ${colorTextPrimary};
`

const InstallerButtonLabel = styled.span`
  ${subtitle1};
  height: 48px;
  display: flex;
  align-items: center;
`

export default class Download extends React.Component {
  override render() {
    const { t } = useTranslation()
    return (
      <React.Fragment>
        <Blurb>{t('common.downloadShieldBatteryClient', 'Download the ShieldBattery client to')}:</Blurb>
        <BlurbList>
          <li>{t('common.playGames', 'Play games')}</li>
          <li>{t('common.watchReplays', 'Watch replays')}</li>
          <li>{t('common.exploreMaps', 'Explore maps')}</li>
          <li>{t('common.andMore', 'And more!')}</li>
        </BlurbList>
        <InstallerLinks>
          <RaisedButton
            onClick={this.onDownloadClick}
            label={
              <InstallerButtonLabel>
                <InstallerButtonIcon />
                <span>{t('common.downloadClientButtonText', 'Download client')}</span>
              </InstallerButtonLabel>
            }
          />
        </InstallerLinks>
        <SupportText>{t('common.supportProjectText', 'Want to support the project?')}</SupportText>
        <SupportLinks>
          <a
            href='https://github.com/sponsors/ShieldBattery'
            target='_blank'
            rel='noopener'
            title='GitHub Sponsors'>
            <StyledGithubIcon />
          </a>
          <a href='https://ko-fi.com/tec27' target='_blank' rel='noopener' title='Ko-fi'>
            <StyledKofiIcon />
          </a>
          <a href='https://patreon.com/tec27' target='_blank' rel='noopener' title='Patreon'>
            <StyledPatreonIcon />
          </a>
        </SupportLinks>
      </React.Fragment>
    )
  }

  onDownloadClick = () => {
    window.fathom?.trackGoal('BCSXAXFR', 0)
    window.location.assign(`/published_artifacts/win/ShieldBattery.latest.exe?t${Date.now()}`)
  }
}
