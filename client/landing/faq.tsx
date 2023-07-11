import React, { useLayoutEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { STARCRAFT_DOWNLOAD_URL } from '../../common/constants'
import { DISCORD_URL } from '../../common/url-constants'
import { MaterialIcon } from '../icons/material/material-icon'
import LogoText from '../logos/logotext-640x100.svg'
import { shadowDef4dp } from '../material/shadow-constants'
import { makePublicAssetUrl } from '../network/server-url'
import {
  background700,
  background800,
  blue400,
  colorDividers,
  colorTextSecondary,
} from '../styles/colors'
import { headline1, headline4, headline5 } from '../styles/typography'
import { BottomLinks } from './bottom-links'
import { TopLinks } from './top-links'

const makeQuestionId = (question: string) => {
  return encodeURIComponent(question.replace(/\s/g, '-').replace('?', ''))
}

const pageWidth = css`
  width: 100%;
  max-width: 940px;
`

const QuestionSectionRoot = styled.div`
  ${pageWidth};
  padding: 48px 48px 48px 0;
  border-bottom: 1px solid ${colorDividers};

  @media screen and (max-width: 980px) {
    padding: 16px;
  }
`

const QuestionContainer = styled.div`
  display: flex;
  flex-direction: row;
`

const StyledQuestionIcon = styled(MaterialIcon).attrs({ icon: 'help', size: 48, filled: false })`
  flex-shrink: 0;
  margin-left: 16px;
  margin-right: 16px;

  display: inline-block;
  color: ${blue400};
  vertical-align: middle;

  @media screen and (max-width: 980px) {
    margin-left: 0px;
  }
`

const QuestionText = styled.div`
  ${headline5};
  margin: 0;
  display: inline-block;

  color: ${blue400};
  line-height: 48px;
  vertical-align: middle;

  @media screen and (max-width: 980px) {
    line-height: 32px;
  }
`

const AnswerText = styled.div`
  ${headline5};
  margin: 8px 0 0 80px;

  color: ${colorTextSecondary};
  font-weight: 300;

  & > p {
    line-height: inherit;
  }

  & > p:first-child {
    margin-top: 0;
  }

  & ul {
    margin: 0;
    padding: 0;
  }

  & li {
    margin-left: 1em;
  }

  @media screen and (max-width: 980px) {
    margin-left: 64px;
  }
`

function QuestionSection({ question, answer }: { question: string; answer: React.ReactNode }) {
  return (
    <QuestionSectionRoot id={makeQuestionId(question)}>
      <QuestionContainer>
        <StyledQuestionIcon />
        <QuestionText>{question}</QuestionText>
      </QuestionContainer>
      <AnswerText>{answer}</AnswerText>
    </QuestionSectionRoot>
  )
}

function FragmentLink({
  to,
  fragment,
  children,
}: {
  to: string
  fragment: string
  children: React.ReactNode
}) {
  return <a href={`${to}#${fragment}`}>{children}</a>
}

const Splash = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: ${background800};
  overflow: auto;

  & * {
    user-select: text;
  }
`

const LogoContainer = styled.div`
  ${pageWidth};
  position: absolute;
  top: 38px;
  left: calc(50% - 940px / 2);
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
  pointer-events: none;

  @media screen and (max-width: 980px) {
    max-width: 100%;
    left: 0;
    justify-content: center;
    padding: 0 16px;
  }
`

const Logo = styled.img`
  margin-top: 8px;
  pointer-events: none;

  @media screen and (max-width: 980px) {
    display: none;
  }
`

const StyledLogoText = styled(LogoText)`
  width: 100%;
  max-width: 464px;
  margin-top: 80px;
  pointer-events: none;

  @media screen and (max-width: 980px) {
    margin-top: 24px;
  }
`

const Intro = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  width: 100%;
  margin-top: 142px;
  background-color: ${background700};
  box-shadow: ${shadowDef4dp};

  @media screen and (max-width: 980px) {
    margin-top: 86px;
  }
`

const FaqHeaderContainer = styled.div`
  ${pageWidth};
  display: flex;
  flex-direction: row;
  justify-content: flex-end;

  @media screen and (max-width: 980px) {
    justify-content: center;
  }
`

const FaqHeader = styled.div`
  ${headline1};
  width: 100%;
  max-width: 464px;
  margin: 0;
  padding: 64px 0;

  @media screen and (max-width: 980px) {
    padding: 24px 16px;
  }
`

const FaqToc = styled.div`
  ${pageWidth};
  padding: 48px 0;

  display: flex;
  flex-direction: column;
  align-items: center;

  font-size: 20px;
  line-height: 1.5;
  border-bottom: 1px solid ${colorDividers};

  @media screen and (max-width: 980px) {
    padding: 32px 16px;
  }
`

const FaqTitle = styled.div`
  ${headline4}
`

export function Faq() {
  const { t } = useTranslation()
  const lastHash = useRef<string>()

  useLayoutEffect(() => {
    const onHashChange = () => {
      if (lastHash.current !== location.hash) {
        if (location.hash !== '' || lastHash.current !== undefined) {
          let id = location.hash.slice(1)
          id = id === '' ? 'faqToc' : id
          const element = document.getElementById(id)

          if (element) {
            element.scrollIntoView()
          }
        }
        lastHash.current = location.hash
      }
    }
    onHashChange()

    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const questions = [
    {
      question: t(
        'landing.faq.supportedStarcraftVersionQuestion',
        'What version of StarCraft does ShieldBattery support?',
      ),
      answer: (
        <p key='p1'>
          <Trans t={t} i18nKey='landing.faq.supportedStarcraftVersionAnswer'>
            ShieldBattery supports the latest version of StarCraft: Remastered. You can download the
            free version of StarCraft: Remastered from the official{' '}
            <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='nofollow noreferrer noopener'>
              Blizzard site
            </a>
            , or install it through the Blizzard launcher. Any purchased addons (such as HD
            graphics) will be usable on ShieldBattery.
          </Trans>
        </p>
      ),
    },
    {
      question: t(
        'landing.faq.officialSupportQuestion',
        'Is ShieldBattery developed with the support of Blizzard?',
      ),
      answer: (
        <p key='p1'>
          <Trans t={t} i18nKey='landing.faq.officialSupportAnswer'>
            No, ShieldBattery is a project developed by passionate community members, and has no
            official support or acknowledgement from Blizzard.
          </Trans>
        </p>
      ),
    },
    {
      question: t(
        'landing.faq.isShieldBatteryFreeQuestion',
        'Does ShieldBattery cost anything? How can I support the project?',
      ),
      answer: [
        <Trans t={t} i18nKey='landing.faq.isShieldBatteryFreeAnswer' key='text'>
          <p key='p1'>ShieldBattery is totally free to use!</p>
          <p key='p2'>
            It does, however, cost us time and money to host and develop ShieldBattery. If you would
            like to help us cover those costs, we'd greatly appreciate it. We have set up a number
            of ways to contribute:
          </p>
        </Trans>,
        <ul key='u1'>
          <li>
            <a href='https://github.com/sponsors/ShieldBattery' target='_blank' rel='noopener'>
              Github Sponsors
            </a>
          </li>
          <li>
            <a href='https://ko-fi.com/tec27' target='_blank' rel='noopener'>
              Ko-fi
            </a>
          </li>
          <li>
            <a href='https://patreon.com/tec27' target='_blank' rel='noopener'>
              Patreon
            </a>
          </li>
        </ul>,
      ],
    },
    {
      question: t('landing.faq.reportIssuesQuestion', 'How can I report bugs or issues?'),
      answer: (
        <p key='p1'>
          <Trans t={t} i18nKey='landing.faq.reportIssuesAnswer'>
            The easiest way to report bugs or issues is through our{' '}
            <a href={DISCORD_URL} target='_blank' rel='noopener'>
              Discord
            </a>
            . If you are comfortable with doing so, you can also file issues on our{' '}
            <a
              href='https://github.com/ShieldBattery/ShieldBattery/issues'
              target='_blank'
              rel='noopener'>
              GitHub
            </a>
            .
          </Trans>
        </p>
      ),
    },
    {
      question: t('landing.faq.openSourceQuestion', 'Is the project open source?'),
      answer: (
        <Trans t={t} i18nKey='landing.faq.openSourceAnswer'>
          <p key='p1'>
            Yes. You can access our main repository as well as the various additional projects we've
            written and separated into their own repositories at our{' '}
            <a href='https://github.com/ShieldBattery' target='_blank' rel='noopener'>
              GitHub page
            </a>
            .
          </p>
          <p key='p2'>
            We could always use more contributors, so if you think you can help, check it out!
          </p>
        </Trans>
      ),
    },
    {
      question: t(
        'landing.faq.systemRequirementsQuestion',
        'What are the system requirements to play on ShieldBattery?',
      ),
      answer: (
        <Trans t={t} i18nKey='landing.faq.systemRequirementsAnswer'>
          <p key='p1'>
            Our system requirements are mainly driven by those of{' '}
            <a
              href='https://us.battle.net/support/en/article/28438'
              target='_blank'
              rel='nofollow noopener'>
              StarCraft: Remastered
            </a>
            , but in brief:
          </p>
          <ul key='u1'>
            <li>A computer running Windows 10 or later</li>
            <li>2GB RAM</li>
            <li>NVIDIA GeForce 6800 (256MB) or ATI Radeon X1600 Pro (256MB) or better</li>
            <li>A StarCraft: Remastered installation, patched to the latest version</li>
          </ul>
        </Trans>
      ),
    },
    {
      question: t(
        'landing.faq.hotkeyCustomizationQuestion',
        'Is hotkey customization allowed or provided?',
      ),
      answer: (
        <span>
          <Trans t={t} i18nKey='landing.faq.hotkeyCustomizationAnswer'>
            Yes, we support customized hotkeys, but we do not currently have a hotkey editor. If you
            want to use customized hotkeys, launch StarCraft: Remastered through the Blizzard
            launcher and customize them there first. After doing so, future launches through
            ShieldBattery will use those hotkeys.
          </Trans>
        </span>
      ),
    },
    {
      question: t('landing.faq.linuxSupportQuestion', 'Does ShieldBattery work on Linux or OS X?'),
      answer: (
        <Trans t={t} i18nKey='landing.faq.linuxSupportAnswer'>
          <p key='p1'>This is not currently something that we have official support for.</p>
          <p key='p2'>
            However, there's a community-contributed integration of ShieldBattery with Wine. Check
            out our{' '}
            <a href={DISCORD_URL} target='_blank' rel='noopener'>
              Discord
            </a>{' '}
            to learn how to run ShieldBattery on Wine.
          </p>
        </Trans>
      ),
    },
  ]

  return (
    <Splash>
      <TopLinks />
      <LogoContainer>
        <Logo src={makePublicAssetUrl('/images/splash-logo.png')} />
        <StyledLogoText />
      </LogoContainer>
      <Intro>
        <FaqHeaderContainer>
          <FaqHeader>{t('landing.faq.header', 'FAQ')}</FaqHeader>
        </FaqHeaderContainer>
      </Intro>
      <FaqToc id={'faqToc'}>
        <FaqTitle>{t('landing.faq.title', 'Frequently Asked Questions')}</FaqTitle>
        <ul>
          {questions.map((q, i) => (
            <li key={`link-${i}`}>
              <FragmentLink to='/faq' fragment={makeQuestionId(q.question)}>
                {q.question}
              </FragmentLink>
            </li>
          ))}
        </ul>
      </FaqToc>
      {questions.map((q, i) => (
        <QuestionSection question={q.question} answer={q.answer} key={`question-${i}`} />
      ))}
      <BottomLinks />
    </Splash>
  )
}
