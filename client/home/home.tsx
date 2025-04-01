import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import GithubIcon from '../icons/brands/github.svg'
import KofiIcon from '../icons/brands/kofi-color.svg'
import PatreonIcon from '../icons/brands/patreon.svg'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { elevationPlus1 } from '../material/shadows'
import { StaticNewsFeed } from '../news/static-news-feed'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { singleLine, titleLarge, titleSmall } from '../styles/typography'
import { BottomLinks } from './bottom-links'

const Root = styled(CenteredContentContainer)`
  padding-top: 24px;

  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: 1fr auto;
  gap: 40px;
`

const LeftSection = styled.div`
  grid-column: span 3;
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const RightSection = styled.div`
  grid-column: span 2;
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const ImportantMessage = styled.div<{ $hasContent: boolean }>`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
  height: 56px;
  padding-inline: 16px 8px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 4px;
  color: var(--theme-amber);
  visibility: ${({ $hasContent }) => ($hasContent ? 'visible' : 'hidden')};
`

const ImportantMessageText = styled.div`
  ${singleLine};
  ${titleSmall};
  flex-grow: 1;
  flex-shrink: 1;
`

const SupportSection = styled.div`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
  height: 56px;
  padding-inline: 16px 12px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  border-radius: 4px;
`

const SupportText = styled.div`
  ${singleLine};
  ${titleSmall};
`

const SupportIcons = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;

  & > a {
    &,
    &:link,
    &:visited {
      width: 48px;
      height: 48px;

      display: flex;
      align-items: center;
      justify-content: center;

      color: var(--theme-on-surface-variant);
      text-align: center;
    }

    &:hover,
    &:active {
      color: var(--theme-on-surface);
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

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.div`
  ${titleLarge};
  ${singleLine};
`

const BottomLinksArea = styled.div`
  grid-column: 1 / -1;
`

export function Home() {
  const { t } = useTranslation()

  return (
    <Root>
      <LeftSection>
        <ImportantMessage $hasContent={true}>
          <MaterialIcon icon='priority_high' />
          <ImportantMessageText>Important message!</ImportantMessageText>
          <TextButton label={t('common.actions.read', 'Read')} />
        </ImportantMessage>
        <Section>
          <SectionTitle>{t('home.latestNewsTitle', 'Latest news')}</SectionTitle>
          <StaticNewsFeed />
        </Section>
      </LeftSection>
      <RightSection>
        <SupportSection>
          <SupportText>{t('home.supportTitle', 'Support the project')}</SupportText>
          <SupportIcons>
            <a
              href='https://github.com/sponsors/ShieldBattery'
              target='_blank'
              rel='noopener'
              title='GitHub Sponsors'>
              <StyledGithubIcon />
            </a>
            <a href='https://patreon.com/tec27' target='_blank' rel='noopener' title='Patreon'>
              <StyledPatreonIcon />
            </a>
            <a href='https://ko-fi.com/tec27' target='_blank' rel='noopener' title='Ko-fi'>
              <StyledKofiIcon />
            </a>
          </SupportIcons>
        </SupportSection>
        <Section>
          <SectionTitle>{t('home.liveMatchesTitle', 'Live matches')}</SectionTitle>
          <div>soon</div>
        </Section>
        <Section>
          <SectionTitle>{t('leagues.activity.title', 'Leagues')}</SectionTitle>
          <div>yep</div>
        </Section>
      </RightSection>
      <BottomLinksArea>
        <BottomLinks />
      </BottomLinksArea>
    </Root>
  )
}
