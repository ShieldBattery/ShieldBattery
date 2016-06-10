import React from 'react'
import { Link } from 'react-router'
import styles from './beta.css'

import LogoText from '../logos/logotext-640x100.svg'
import QuestionIcon from '../icons/material/ic_help_outline_black_48px.svg'

const questions = [
  {
    question: 'When will the open beta start?',
    answer: [<p key='p1'>
      Open beta will start once ShieldBattery is stable and ready for the public. An exact ETA for
      this is unfortunately impossible to give, but expect to receive regular updates from us as
      we make progress. Make sure to follow our <a href='https://twitter.com/shieldbatterybw'
      target='_blank'>Twitter account</a> to keep up with the latest news and changes.</p>,
      <p key='p2'>Even before the open beta starts, we'll be inviting new users to our closed beta
      periodically. So if you're interested in helping us test the software, finding bugs, and
      giving feedback before it's available to a wider audience,
      please <Link to='/splash'>sign up</Link> for an invite.
    </p>],
  },
  {
    question: 'What is the status of the closed beta?',
    answer: [<p key='p1'>
      The closed beta is currently running, and will last until we feel that the feature set is
      relatively complete, polished, and bug-free. Our current beta invitees have given us tons of
      great feedback, and the software is under active development to improve and polish things
      based on their responses. While the basics of the features we've promised are in place, we are
      also still actively working on some of the more complex pieces, such as matchmaking.</p>,

      <p key='p2'>
      As these features come online, we'll need a larger player-base in order to test them, so
      please <Link to='/splash'>sign up</Link> for a chance to get invited.
    </p>],
  },
  {
    question: 'Will ShieldBattery cost anything? Is there a way to donate?',
    answer: [<p key='p1'>
      Of course not. This is a project made purely out of our love for BW; by community members,
      for the community.</p>,
      <p key='p2'>As for the donation link, there isn't one at this time. The server costs
      are currently very manageable, and we'd prefer the community directed their funds to more
      needy causes.
    </p>],
  },
  {
    question: 'Will the project be open source?',
    answer: <span>
      Yes, it will. Shortly after we enter the open beta, all of the code used in the project will
      be posted publicly on GitHub.
    </span>,
  },
  {
    question: 'What are the system requirements to play on ShieldBattery?',
    answer: <ul>
      <li>A computer running Windows Vista or later</li>
      <li>A graphics card that supports either DirectX 10+ or OpenGL 3.1+</li>
      <li>A modern browser (Chrome, Firefox, Opera, or IE10+ should all work)</li>
      <li>A Brood War installation, patched to the latest version (1.16.1)</li>
    </ul>,
  },
  {
    question: 'Does ShieldBattery work on Linux or OS X?',
    answer: <span>
      This is not currently something we're focusing on, but we do have plans to ensure that
      ShieldBattery is usable via Wine. For now, however, it is Windows-only.
    </span>,
  },
  {
    question: 'Will there be matchmaking for non-1v1 match types, such as 2v2 or UMS?',
    answer: <span>
      Our initial focus for matchmaking is on 1v1 matches, but we are open to adding other sorts of
      matchmaking in the future, if player interest is sufficient to sustain it. Our platform is
      definitely flexible enough to support all of these things.
    </span>,
  },
  {
    question: 'Does the windowed mode allow widescreen resolutions or larger viewports?',
    answer: <span>
      No, our windowed mode only allows 4:3 aspect ratios, and always scales the sprites to the new
      resolution (meaning that even at larger resolutions, the same portion of the map is visible as
      at the original, 640x480 resolution). We're not opposed to such things for observers, but our
      focus right now is largely on the playing experience.
    </span>,
  },
  {
    question: 'Is hotkey customization allowed or provided?',
    answer: <span>
      Currently no, but we plan to implement built-in hotkey customization and presets at some point
      in the future.
    </span>,
  },
]

const QuestionSection = ({ question, answer }) => {
  return (<div className={styles.faqFeature}>
    <div className={styles.faqText}>
      <QuestionIcon className={styles.faqQuestionIcon} />
      <h3 className={styles.faqQuestion}>{question}</h3>
      <div className={styles.faqAnswer}>{answer}</div>
    </div>
  </div>)
}

export default class Faq extends React.Component {
  render() {
    return (
      <div className={styles.splash}>
        <div className={styles.logoContainer}>
          <ul className={styles.topLinks}>
            <li><Link to='/splash'>Back to splash page</Link></li>
          </ul>
          <img className={styles.logo} src='/images/splash-logo.png' />
          <LogoText className={styles.logotext} />
        </div>
        <div className={styles.intro}>
          <h1 className={styles.faqHeader}>FAQ</h1>
        </div>

        {
          questions.map((q, i) => <QuestionSection question={q.question} answer={q.answer}
              key={`question-${i}`} />)
        }
      </div>
    )
  }
}
