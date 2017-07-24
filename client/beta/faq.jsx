import React from 'react'
import styles from './beta.css'

import TopLinks from './top-links.jsx'

import LogoText from '../logos/logotext-640x100.svg'
import QuestionIcon from '../icons/material/ic_help_outline_black_48px.svg'

const questions = [
  {
    question: 'What version of BW does ShieldBattery support?',
    answer: [
      <p key="p1">
        ShieldBattery supports all versions of BW from 1.16.1 and up. The version that is actually
        run when playing on ShieldBattery is 1.16.1. This means that you can give our application an
        install path to any version of BW 1.16.1 and above, and things will just work.
      </p>,
      <p key="p2">
        BW:Remaster is not out yet, but to play on it using ShieldBattery, you will have to purchase
        it from Blizzard.
      </p>,
    ],
  },
  {
    question: 'What is the status of the open beta?',
    answer: [
      <p key="p1">
        The open beta is currently running, and will last until we feel that the feature set is
        relatively complete, polished, and bug-free. The point of the closed beta was to test the
        features we've had in a more controlled fashion and see if we had any leaks, ie. bugs, in
        our system. Now it's time to open the floodgates, so to speak, as we believe it's time to
        test our system in a less controlled fashion.
      </p>,

      <p key="p2">
        Please keep in mind that this is still a <i>beta</i>, so there will be features missing that
        you'd want to see, and some that we do have might be a bit rough around the edges. However,
        we do feel you can enjoy your experience on Shieldbattery, and we'll continue working
        relentlessly on features that are missing, based on your feedback.
      </p>,
    ],
  },
  {
    question: 'Does ShieldBattery cost anything? Is there a way to donate?',
    answer: [
      <p key="p1">
        Of course not. This is a project made purely out of our love for BW; by community members,
        for the community.
      </p>,
      <p key="p2">
        As for the donation link, there isn't one at this time. The server costs are currently very
        manageable, and we'd prefer the community directed their funds to more needy causes.
      </p>,
    ],
  },
  {
    question: 'Is the project open source?',
    answer: [
      <p key="p1">
        Yes. You can access our main repository as well as the various additional projects we've
        written and separated into their own repositories at our{' '}
        <a href="https://github.com/ShieldBattery" target="_blank">
          github page
        </a>.
      </p>,
      <p key="p2">
        We could always use more contributors, so if you find technically challenging projects to
        your liking and also enjoy the awesome game that is BW, then we look forward to seeing you
        on our github pages.
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

const QuestionSection = ({ question, answer }) => {
  return (
    <div className={styles.faqFeature}>
      <div className={styles.faqText}>
        <QuestionIcon className={styles.faqQuestionIcon} />
        <h3 className={styles.faqQuestion}>
          {question}
        </h3>
        <div className={styles.faqAnswer}>
          {answer}
        </div>
      </div>
    </div>
  )
}

export default class Faq extends React.Component {
  render() {
    return (
      <div className={styles.splash}>
        <div className={styles.logoContainer}>
          <TopLinks />
          <img className={styles.logo} src="/images/splash-logo.png" />
          <LogoText className={styles.logotext} />
        </div>
        <div className={styles.intro}>
          <h1 className={styles.faqHeader}>FAQ</h1>
        </div>

        {questions.map((q, i) =>
          <QuestionSection question={q.question} answer={q.answer} key={`question-${i}`} />,
        )}
      </div>
    )
  }
}
