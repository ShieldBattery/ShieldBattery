import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { makeServerUrl } from '../network/server-url'

import TopLinks from './top-links.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import { STARCRAFT_DOWNLOAD_URL } from '../../common/constants'

import LogoText from '../logos/logotext-640x100.svg'
import QuestionIcon from '../icons/material/ic_help_outline_black_48px.svg'
import { colorDividers, colorTextSecondary, blue400, grey850, grey900 } from '../styles/colors'
import { Headline, Subheading, Display4 } from '../styles/typography'
import { shadow4dp } from '../material/shadows'

const questions = [
  {
    question: 'What version of BW does ShieldBattery support?',
    answer: [
      <p key='p1'>
        ShieldBattery supports all versions of BW from 1.16.1 and up. The version that is actually
        run when playing on ShieldBattery is 1.16.1. This means that you can give our application an
        install path to any version of BW 1.16.1 and above, and things will just work.
      </p>,
      <p key='p2'>
        You can download the free version of StarCraft: Brood War from the offical{' '}
        <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='nofollow noreferrer'>
          Blizzard site
        </a>
        .
      </p>,
    ],
  },
  {
    question: 'What is the status of the open beta?',
    answer: [
      <p key='p1'>
        The open beta is currently running, and will last until we feel that the feature set is
        relatively complete, polished, and bug-free. We've ironed out most of the significant bugs
        in our base feature set during our closed beta process, and are now ready to test things
        with a more significant playerbase, as well as build new features that require a larger
        group.
      </p>,

      <p key='p2'>
        Please keep in mind that this is still a <i>beta</i>, so there will be features missing that
        you want to see, and you might encounter issues that need fixing. You shouldn't expect a
        perfect, completely polished experience, but we'll do our best to keep the quality bar high.
        The ShieldBattery developers will continue working relentlessly on features that are
        missing, with priorities based on community feedback.
      </p>,
    ],
  },
  {
    question: 'Does ShieldBattery cost anything? Is there a way to donate?',
    answer: [
      <p key='p1'>
        Of course not. This is a project made purely out of our love for BW; by community members,
        for the community.
      </p>,
      <p key='p2'>
        As for the donation link, there isn't one at this time. The server costs are currently very
        manageable, and we'd prefer the community directed their funds to more needy causes.
      </p>,
    ],
  },
  {
    question: 'Is the project open source?',
    answer: [
      <p key='p1'>
        Yes. You can access our main repository as well as the various additional projects we've
        written and separated into their own repositories at our{' '}
        <a href='https://github.com/ShieldBattery' target='_blank'>
          GitHub page
        </a>
        .
      </p>,
      <p key='p2'>
        We could always use more contributors, so if you find technically challenging projects to
        your liking and also enjoy the awesome game that is BW, we then look forward to seeing you
        on our GitHub repos.
      </p>,
    ],
  },
  {
    question: 'What are the system requirements to play on ShieldBattery?',
    answer: (
      <ul>
        <li>A computer running Windows 7 or later</li>
        <li>A graphics card that supports either DirectX 10+ or OpenGL 3.1+</li>
        <li>A Brood War installation, patched to version 1.16.1 or greater</li>
      </ul>
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
  {
    question: 'Will there be matchmaking for non-1v1 match types, such as 2v2 or UMS?',
    answer: (
      <span>
        Our initial focus for matchmaking is on 1v1 matches, but we are open to adding other sorts
        of matchmaking in the future, if player interest is sufficient to sustain it. Our platform
        is definitely flexible enough to support all of these things.
      </span>
    ),
  },
  {
    question: 'Does the windowed mode allow widescreen resolutions or larger viewports?',
    answer: (
      <span>
        No, our windowed mode only allows 4:3 aspect ratios, and always scales the sprites to the
        new resolution (meaning that even at larger resolutions, the same portion of the map is
        visible as at the original, 640x480 resolution). We're not opposed to such things for
        observers, but our focus right now is largely on the playing experience.
      </span>
    ),
  },
  {
    question: 'Is hotkey customization allowed or provided?',
    answer: (
      <span>
        Currently no, but we plan to implement built-in hotkey customization and presets at some
        point in the future.
      </span>
    ),
  },
]

const makeQuestionId = question => {
  return encodeURIComponent(question.replace(/\s/g, '-'))
}

const pageWidth = css`
  width: 940px;
  margin: 0px auto;
`

const QuestionSectionRoot = styled.div`
  ${pageWidth};
  padding: 48px 48px 48px 0;
  border-bottom: 1px solid ${colorDividers};
`

const StyledQuestionIcon = styled(QuestionIcon)`
  margin-left: 16px;
  margin-right: 16px;

  display: inline-block;
  color: ${blue400};
  vertical-align: middle;
`

const QuestionText = styled(Headline)`
  margin: 0;
  display: inline-block;

  color: ${blue400};
  line-height: 48px;
  vertical-align: middle;
`

const AnswerText = styled(Subheading)`
  margin: 8px 0 0 80px;
  color: ${colorTextSecondary};
  font-size: 20px;
  line-height: 1.5;

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
`

class QuestionSection extends React.PureComponent {
  render() {
    const { question, answer } = this.props
    return (
      <QuestionSectionRoot id={makeQuestionId(question)}>
        <StyledQuestionIcon />
        <QuestionText>{question}</QuestionText>
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
  background-color: ${grey900};
  overflow: auto;

  & > * {
    user-select: text;
  }
`

const LogoContainer = styled.div`
  ${pageWidth};
  left: calc(50% - 940px / 2);
  position: absolute;
  pointer-events: none;
`

const Logo = styled.img`
  margin-top: 8px;
  float: left;
  pointer-events: none;
`

const StyledLogoText = styled(LogoText)`
  width: 464px;
  margin-top: 80px;
  float: right;
  pointer-events: none;
`

const Intro = styled.div`
  margin-top: 180px;
  background-color: ${grey850};
  ${shadow4dp};
`

const FaqHeader = styled(Display4)`
  ${pageWidth};
  padding: 64px 0 64px 472px;
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
          <LogoContainer>
            <TopLinks />
            <Logo src={makeServerUrl('/images/splash-logo.png')} />
            <StyledLogoText />
          </LogoContainer>
          <Intro>
            <FaqHeader>FAQ</FaqHeader>
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
