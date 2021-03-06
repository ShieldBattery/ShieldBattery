import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { makeServerUrl } from '../network/server-url'

import TopLinks from './top-links'
import { ScrollableContent } from '../material/scroll-bar'
import { STARCRAFT_DOWNLOAD_URL } from '../../common/constants'

import LogoText from '../logos/logotext-640x100.svg'
import QuestionIcon from '../icons/material/ic_help_outline_black_48px.svg'
import { colorDividers, colorTextSecondary, blue400, grey850, grey900 } from '../styles/colors'
import { headline1, headline5 } from '../styles/typography'
import { shadowDef4dp } from '../material/shadow-constants'

const questions = [
  {
    question: 'What version of StarCraft does ShieldBattery support?',
    answer: [
      <p key='p1'>
        ShieldBattery supports the latest version of StarCraft: Remastered. You can download the
        free version of StarCraft: Remastered from the offical{' '}
        <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='nofollow noreferrer noopener'>
          Blizzard site
        </a>
        , or install it through the Blizzard launcher. Any purchased addons (such as HD graphics)
        will be usable on ShieldBattery.
      </p>,
    ],
  },
  {
    question: 'Is ShieldBattery developed with the support of Blizzard?',
    answer: [
      <p key='p1'>
        No, ShieldBattery is a project developed by passionate community members, and has no
        official support or acknowledgement from Blizzard.
      </p>,
    ],
  },
  {
    question: 'Does ShieldBattery cost anything? How can I support the project?',
    answer: [
      <p key='p1'>ShieldBattery is totally free to use!</p>,
      <p key='p2'>
        It does, however, cost us time and money to host and develop ShieldBattery. If you would
        like to help us cover those costs, we'd greatly appreciate it. We have set up a number of
        ways to contribute:
      </p>,
      <ul>
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
    question: 'How can I report bugs or issues?',
    answer: [
      <p key='p1'>
        The easiest way to report bugs or issues is through our{' '}
        <a href='https://discord.gg/S8dfMx94a4' target='_blank' rel='noopener'>
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
      </p>,
    ],
  },
  {
    question: 'Is the project open source?',
    answer: [
      <p key='p1'>
        Yes. You can access our main repository as well as the various additional projects we've
        written and separated into their own repositories at our{' '}
        <a href='https://github.com/ShieldBattery' target='_blank' rel='noopener'>
          GitHub page
        </a>
        .
      </p>,
      <p key='p2'>
        We could always use more contributors, so if you think you can help, check it out!
      </p>,
    ],
  },
  {
    question: 'What are the system requirements to play on ShieldBattery?',
    answer:
      ((
        <p key='p1'>
          Our system requirements are mainly driven by those of
          <a
            href='https://us.battle.net/support/en/article/28438'
            target='_blank'
            rel='nofollow noopener'>
            StarCraft: Remastered
          </a>
          , but in brief:
        </p>
      ),
      (
        <ul key='u1'>
          <li>A computer running Windows 7 or later</li>
          <li>2GB RAM</li>
          <li>NVIDIA Gefore 6800 (256MB) or ATI Radeon X1600 Pro (256MB) or better</li>
          <li>A StarCraft: Remastered installation, patched to the latest version</li>
        </ul>
      )),
  },
  {
    question: 'Is hotkey customization allowed or provided?',
    answer: (
      <span>
        Yes, we support customized hotkeys, but we do not currently have a hotkey editor. If you
        want to use customized hotkeys, launch StarCraft: Remastered through the Blizzard launcher
        and customize them there first. After doing so, future launches through ShieldBattery will
        use those hotkeys.
      </span>
    ),
  },
  {
    question: 'Does ShieldBattery work on Linux or OS X?',
    answer: (
      <span>
        This is not currently something we're focusing on, but we do have plans to ensure that
        ShieldBattery is usable via Wine. For now, however, it is Windows-only.
      </span>
    ),
  },
]

const makeQuestionId = question => {
  return encodeURIComponent(question.replace(/\s/g, '-'))
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

const StyledQuestionIcon = styled(QuestionIcon)`
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

class QuestionSection extends React.PureComponent {
  render() {
    const { question, answer } = this.props
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
}

class FragmentLink extends React.PureComponent {
  render() {
    return <Link to={`${this.props.to}#${this.props.fragment}`}>{this.props.children}</Link>
  }
}

const Splash = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: ${grey900};

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
  background-color: ${grey850};
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

@connect()
export default class Faq extends React.Component {
  componentDidUpdate(prevProps) {
    const {
      location: { hash: prevHash },
    } = prevProps
    const {
      location: { hash: newHash },
    } = this.props

    if (prevHash !== newHash) {
      this.scrollElementIntoView(newHash.slice(1))
    }
  }

  scrollElementIntoView = id => {
    id = id === '' ? 'faqToc' : id
    const element = document.getElementById(id)

    if (element) {
      element.scrollIntoView()
    }
  }

  render() {
    return (
      <ScrollableContent>
        <Splash>
          <TopLinks />
          <LogoContainer>
            <Logo src={makeServerUrl('/images/splash-logo.png')} />
            <StyledLogoText />
          </LogoContainer>
          <Intro>
            <FaqHeaderContainer>
              <FaqHeader>FAQ</FaqHeader>
            </FaqHeaderContainer>
          </Intro>
          <FaqToc id={'faqToc'}>
            <h3>Frequently Asked Questions</h3>
            <ul>
              {questions.map((q, i) => (
                <li key={`question-${i}`}>
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
        </Splash>
      </ScrollableContent>
    )
  }
}
