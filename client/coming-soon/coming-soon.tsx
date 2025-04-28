import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import GithubIcon from '../icons/brands/github.svg'
import KofiIcon from '../icons/brands/kofi-lockup.svg'
import PatreonIcon from '../icons/brands/patreon-lockup.svg'
import { Tooltip } from '../material/tooltip'
import { TitleLarge, TitleMedium } from '../styles/typography'

const FundingSection = styled.div`
  margin-top: 48px;
`

const SupportLinks = styled.div`
  margin-top: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  gap: 16px;

  a,
  a:link,
  a:visited {
    width: auto;
    min-width: 128px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;

    background-color: var(--theme-container-low);
    border-radius: 4px;
    color: var(--theme-on-surface);
    padding-left: 16px;
    padding-right: 16px;
    overflow: hidden;

    &:hover,
    &:active {
      background-color: var(--theme-container-high);
    }
  }
`
const StyledGithubIcon = styled(GithubIcon)`
  height: 56px;
`

const StyledKofiIcon = styled(KofiIcon)`
  height: 56px;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  height: 56px;
`

export function ComingSoon() {
  const { t } = useTranslation()
  return (
    <>
      <TitleLarge>{t('comingSoon.headline', 'This feature is coming soon!')}</TitleLarge>

      <FundingSection>
        <TitleMedium>
          {t('comingSoon.subtitle', "Help fund ShieldBattery's development")}:
        </TitleMedium>
        <SupportLinks>
          <Tooltip text={t('comingSoon.githubSponsors', 'GitHub Sponsors')} position='right'>
            <a href='https://github.com/sponsors/ShieldBattery' target='_blank' rel='noopener'>
              <StyledGithubIcon />
            </a>
          </Tooltip>
          <Tooltip text={t('comingSoon.patreon', 'Patreon')} position='right'>
            <a href='https://patreon.com/tec27' target='_blank' rel='noopener'>
              <StyledPatreonIcon />
            </a>
          </Tooltip>
          <Tooltip text={t('comingSoon.kofi', 'Ko-fi')} position='right'>
            <a href='https://ko-fi.com/tec27' target='_blank' rel='noopener'>
              <StyledKofiIcon />
            </a>
          </Tooltip>
        </SupportLinks>
      </FundingSection>
    </>
  )
}
