import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import GithubIcon from '../icons/brands/github.svg'
import KofiIcon from '../icons/brands/kofi-lockup.svg'
import PatreonIcon from '../icons/brands/patreon-lockup.svg'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton } from '../material/button'
import { bodyLarge, titleLarge } from '../styles/typography'
import { navigateToDownload } from './download-navigate'

const Blurb = styled.div`
  ${titleLarge};
  font-weight: 300;
`

const BlurbList = styled.ul`
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

const SupportText = styled.div`
  ${bodyLarge};
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
    color: var(--theme-on-surface-variant);
    padding-left: 16px;
    padding-right: 16px;
    overflow: hidden;

    &:hover,
    &:active {
      color: var(--theme-on-surface);
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

const InstallerButtonLabel = styled.span`
  ${bodyLarge};
  height: 48px;
  display: flex;
  align-items: center;
`

export function Download() {
  const { t } = useTranslation()

  return (
    <>
      <Blurb>{t('clientDownload.blurb', 'Download the ShieldBattery client to:')}</Blurb>
      <BlurbList>
        <li>{t('clientDownload.playGames', 'Play games')}</li>
        <li>{t('clientDownload.watchReplays', 'Watch replays')}</li>
        <li>{t('clientDownload.andMore', 'And more!')}</li>
      </BlurbList>
      <InstallerLinks>
        <FilledButton
          onClick={navigateToDownload}
          iconStart={<MaterialIcon icon='download' />}
          label={
            <InstallerButtonLabel>
              {t('clientDownload.downloadClient', 'Download client')}
            </InstallerButtonLabel>
          }
        />
      </InstallerLinks>
      <SupportText>
        {t('clientDownload.supportProjectText', 'Want to support the project?')}
      </SupportText>
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
    </>
  )
}

export default Download
