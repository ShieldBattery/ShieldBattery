import { TFunction } from 'i18next'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { EightBallAnswer, RolledOutcome } from '../../common/rolled-outcomes'
import { TransInterpolation } from '../i18n/i18next'
import { labelSmall } from '../styles/typography'

/**
 * Marks the result inside an action line announcing something the server settled (a roll, a coin
 * flip, an 8-ball answer). Only such a result ever renders this chip, which is what tells a real
 * roll from someone hand-typing `/me rolls 100`.
 */
export const OutcomeChip = styled.span.attrs<{ 'data-testid'?: string }>({
  'data-testid': 'outcome-chip',
})`
  ${labelSmall};

  padding: 0 6px;

  background-color: var(--theme-amber-container);
  border-radius: 4px;
  color: var(--theme-on-amber-container);
  text-transform: uppercase;

  display: inline-block;
  font-style: normal;
  /*
   * The message line hangs its first line into the timestamp gutter with a negative text-indent,
   * which an inline-block would inherit and apply to its own first line, shoving the chip's text
   * out of its box.
   */
  text-indent: 0;
  vertical-align: text-bottom;
  white-space: nowrap;
`

/**
 * Localizes each answer a magic 8-ball gives, keyed the same way `EIGHT_BALL_ANSWERS` orders them.
 */
const EIGHT_BALL_ANSWER_TEXT: Record<EightBallAnswer, (t: TFunction) => string> = {
  itIsCertain: t => t('chat.outcomes.eightBall.answers.itIsCertain', 'It is certain'),
  itIsDecidedlySo: t => t('chat.outcomes.eightBall.answers.itIsDecidedlySo', 'It is decidedly so'),
  withoutADoubt: t => t('chat.outcomes.eightBall.answers.withoutADoubt', 'Without a doubt'),
  yesDefinitely: t => t('chat.outcomes.eightBall.answers.yesDefinitely', 'Yes, definitely'),
  youMayRelyOnIt: t => t('chat.outcomes.eightBall.answers.youMayRelyOnIt', 'You may rely on it'),
  asISeeItYes: t => t('chat.outcomes.eightBall.answers.asISeeItYes', 'As I see it, yes'),
  mostLikely: t => t('chat.outcomes.eightBall.answers.mostLikely', 'Most likely'),
  outlookGood: t => t('chat.outcomes.eightBall.answers.outlookGood', 'Outlook good'),
  yes: t => t('chat.outcomes.eightBall.answers.yes', 'Yes'),
  signsPointToYes: t => t('chat.outcomes.eightBall.answers.signsPointToYes', 'Signs point to yes'),
  replyHazyTryAgain: t =>
    t('chat.outcomes.eightBall.answers.replyHazyTryAgain', 'Reply hazy, try again'),
  askAgainLater: t => t('chat.outcomes.eightBall.answers.askAgainLater', 'Ask again later'),
  betterNotTellYouNow: t =>
    t('chat.outcomes.eightBall.answers.betterNotTellYouNow', 'Better not tell you now'),
  cannotPredictNow: t =>
    t('chat.outcomes.eightBall.answers.cannotPredictNow', 'Cannot predict now'),
  concentrateAndAskAgain: t =>
    t('chat.outcomes.eightBall.answers.concentrateAndAskAgain', 'Concentrate and ask again'),
  dontCountOnIt: t => t('chat.outcomes.eightBall.answers.dontCountOnIt', "Don't count on it"),
  myReplyIsNo: t => t('chat.outcomes.eightBall.answers.myReplyIsNo', 'My reply is no'),
  mySourcesSayNo: t => t('chat.outcomes.eightBall.answers.mySourcesSayNo', 'My sources say no'),
  outlookNotSoGood: t =>
    t('chat.outcomes.eightBall.answers.outlookNotSoGood', 'Outlook not so good'),
  veryDoubtful: t => t('chat.outcomes.eightBall.answers.veryDoubtful', 'Very doubtful'),
}

export interface RolledOutcomeLineProps {
  outcome: RolledOutcome
  /** The message's own text: the question asked of the 8-ball, empty for a roll or a flip. */
  text: string
}

/**
 * The wording that follows `* Name ` in an action line announcing a server-settled outcome,
 * composed from the outcome in the viewer's own language.
 */
export function RolledOutcomeLine({ outcome, text }: RolledOutcomeLineProps) {
  const { t } = useTranslation()

  switch (outcome.kind) {
    case 'roll':
      return (
        <Trans t={t} i18nKey='chat.outcomes.roll.line'>
          rolls <OutcomeChip>{{ value: outcome.value } as TransInterpolation}</OutcomeChip> (1-
          {{ max: outcome.max } as TransInterpolation})
        </Trans>
      )
    case 'flip': {
      const result =
        outcome.result === 'heads'
          ? t('chat.outcomes.flip.heads', 'heads')
          : t('chat.outcomes.flip.tails', 'tails')
      return (
        <Trans t={t} i18nKey='chat.outcomes.flip.line'>
          flips a coin: <OutcomeChip>{{ result } as TransInterpolation}</OutcomeChip>
        </Trans>
      )
    }
    case 'eightBall': {
      // `text` is interpolated as a plain string rather than run through the message parser that
      // handles mentions, links and emoji, so nothing the user typed as the question can turn into
      // markup inside this sentence.
      const answer = EIGHT_BALL_ANSWER_TEXT[outcome.answer](t)
      return (
        <Trans t={t} i18nKey='chat.outcomes.eightBall.line'>
          asks the 8-ball "{{ question: text } as TransInterpolation}"{' '}
          <OutcomeChip>{{ answer } as TransInterpolation}</OutcomeChip>
        </Trans>
      )
    }
    default:
      return assertUnreachable(outcome)
  }
}
