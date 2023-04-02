import React from 'react'
import styled from 'styled-components'
import GithubIcon from '../icons/brands/github.svg'
import KofiIcon from '../icons/brands/kofi-lockup.svg'
import PatreonIcon from '../icons/brands/patreon-lockup.svg'
import { colorTextPrimary, colorTextSecondary } from '../styles/colors'
import { Headline5, Subtitle1 } from '../styles/typography'
import { useTranslation } from 'react-i18next'

const FundingSection = styled.div`
  margin-top: 48px;
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

export function ComingSoon() {
  const { t } = useTranslation()
  return (
    <>
      <Headline5>{t('comingSoon.featureComingSoonHeader', 'This feature is coming soon!')}</Headline5>

      <FundingSection>
        <Subtitle1>{t('comingSoon.fundShieldBatteryHeader', 'Help fund ShieldBattery\'s development')}:</Subtitle1>
        <SupportLinks>
          <a
            href='https://github.com/sponsors/ShieldBattery'
            target='_blank'
            rel='noopener'
            title={t('comingSoon.githubSponsors', 'GitHub Sponsors')}>
            <StyledGithubIcon />
          </a>
          <a href='https://ko-fi.com/tec27' target='_blank' rel='noopener' title={t('comingSoon.kofi', 'Ko-fi')}>
            <StyledKofiIcon />
          </a>
          <a href='https://patreon.com/tec27' target='_blank' rel='noopener' title={t('comingSoon.patreon', 'Patreon')}>
            <StyledPatreonIcon />
          </a>
        </SupportLinks>
      </FundingSection>
    </>
  )
}
