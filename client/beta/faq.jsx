import React from 'react'
import { Link } from 'react-router'
import styles from './beta.css'

import LogoText from '../logos/logotext-640x100.svg'
import QuestionIcon from '../icons/material/ic_help_outline_black_48px.svg'

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
    const questions = [
      {
        question: 'When will the open beta start?',
        answer: [<p key='p1'>
          Open beta should start once we feel the project is ready for public, which means that the
          majority of the crucial bugs that we are aware of are fixed and the major features are all
          implemented and working. Exact ETA on this is unfortunately impossible to give, since
          we're only working on this project in our free time, but expect to receive regular updates
          from us as we make progress.</p>,
          <p key='p2'>It's important to note that until the open beta starts, we'll keep inviting
          new people to the closed beta to increase the variety of people using it and to help us
          find most of the bugs.
        </p>],
      },
      {
        question: 'What\'s the status of the closed beta?',
        answer: [<p key='p1'>
          As mentioned in the previous answer, closed beta will last until all the features we
          initially announced are implemented and working, at least the basic version of them. Two
          features that are in active development to make that happen are improved networking
          solution and auto-matchmaking. The former is very close to being done and the latter is
          about half way through.</p>,
          <p key='p2'>Besides those two major features, there is a lot of work still needed to be
          done in fleshing out the UI elements and adding additional functionality to our existing
          features (eg. support for multiple chat channels).
        </p>],
      },
      {
        question: 'Will the ShieldBattery cost anything? What about donation links?',
        answer: [<p key='p1'>
          Of course not. This is a project made purely out of our love for BW; by community members,
          for community.</p>,
          <p key='p2'>As for the donation link, there likely won't be one as well. The server costs
          are not that high for now and we can handle it fine.
        </p>],
      },
      {
        question: 'Will the project be open source?',
        answer: <span>
          Yes, it will. Once we go into an open beta, all of the code used in the project will be
          posted publicly on the Github.
        </span>,
      },
      {
        question: 'Does ShieldBattery work on Linux/Mac OS?',
        answer: <span>
          Depends on amount of players.
        </span>,
      },
      {
        question: 'Will there be 2v2/3v3/FFA/UMS/etc. matchmaking?',
        answer: <span>
          Dunno yet, needs some testing.
        </span>,
      },
      {
        question: 'Question about higher resolution',
        answer: <span>
          No.
        </span>,
      },
      {
        question: 'Question about custom hotkeys',
        answer: <span>
          Not priority, but probably.
        </span>,
      },
      {
        question: 'What are system requirements to play on ShieldBattery?',
        answer: <ul>
          <li>A computer running Windows Vista or later</li>
          <li>A graphics card that supports either DirectX 10+ or OpenGL 3.1+</li>
          <li>A modern browser (Chrome, Firefox, Opera, or IE10+ should all work)</li>
        </ul>,
      }
    ]

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
