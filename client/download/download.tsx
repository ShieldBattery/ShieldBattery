import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import GithubIcon from '../icons/brands/github.svg?react'
import KofiIcon from '../icons/brands/kofi-color.svg?react'
import PatreonIcon from '../icons/brands/patreon.svg?react'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { bodyLarge, titleLarge, titleSmall } from '../styles/typography'
import { navigateToDownload } from './download-navigate'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const IntroSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Blurb = styled.div`
  ${titleLarge};
`

const FeatureList = styled.ul`
  ${titleLarge};
  margin: 0;
  padding: 0;

  color: var(--theme-on-surface-variant);
  font-weight: 300;

  & > li {
    margin-top: 4px;
    margin-left: 24px;
  }
`

const DownloadSection = styled.div`
  display: flex;
  justify-content: center;
`

const InstallerButtonLabel = styled.span`
  ${bodyLarge};
  height: 48px;
  display: flex;
  align-items: center;
`

const SupportRow = styled.div`
  padding-top: 16px;
  border-top: 1px solid var(--theme-outline-variant);

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`

const SupportText = styled.div`
  ${titleSmall};
`

const SupportLinks = styled.div`
  display: flex;
  align-items: center;
  /** Balance the last link's inner padding against the row's right edge */
  margin-right: -12px;

  & a {
    &,
    &:link,
    &:visited {
      width: 56px;
      height: 48px;

      display: flex;
      align-items: center;
      justify-content: center;

      border-radius: 8px;
      color: var(--theme-on-surface);
    }

    &:hover,
    &:active {
      background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    }
  }
`

const StyledGithubIcon = styled(GithubIcon)`
  height: 32px;
`

const StyledKofiIcon = styled(KofiIcon)`
  height: 32px;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  height: 32px;
`

export function Download() {
  const { t } = useTranslation()

  return (
    <Root>
      <IntroSection>
        <Blurb>{t('clientDownload.blurb', 'Download the ShieldBattery client to:')}</Blurb>
        <FeatureList>
          <li>{t('clientDownload.playGames', 'Play games')}</li>
          <li>{t('clientDownload.watchReplays', 'Watch replays')}</li>
          <li>{t('clientDownload.andMore', 'And more!')}</li>
        </FeatureList>
      </IntroSection>

      <DownloadSection>
        <FilledButton
          onClick={navigateToDownload}
          iconStart={<MaterialIcon icon='download' />}
          label={
            <InstallerButtonLabel>
              {t('clientDownload.downloadClient', 'Download client')}
            </InstallerButtonLabel>
          }
        />
      </DownloadSection>

      <SupportRow>
        <SupportText>
          {t('clientDownload.supportProjectText', 'Want to support the project?')}
        </SupportText>
        <SupportLinks>
          <Tooltip text={'GitHub Sponsors'} position='bottom' tabIndex={-1}>
            <a href='https://github.com/sponsors/ShieldBattery' target='_blank' rel='noopener'>
              <StyledGithubIcon />
            </a>
          </Tooltip>
          <Tooltip text={'Patreon'} position='bottom' tabIndex={-1}>
            <a href='https://patreon.com/tec27' target='_blank' rel='noopener'>
              <StyledPatreonIcon />
            </a>
          </Tooltip>
          <Tooltip text={'Ko-fi'} position='bottom' tabIndex={-1}>
            <a href='https://ko-fi.com/tec27' target='_blank' rel='noopener'>
              <StyledKofiIcon />
            </a>
          </Tooltip>
        </SupportLinks>
      </SupportRow>
    </Root>
  )
}

export default Download
