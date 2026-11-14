import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { GuidePage } from '../guides/guide-page'
import { Dialog } from '../material/dialog'
import { NewsMarkdown } from '../news/news-markdown'
import { RULES_PATH } from './rules-urls'

function rulesTitle(t: TFunction): string {
  return t('rules.title', 'Platform rules')
}

/** The rules as one markdown document. */
function getRulesMarkdown(t: TFunction): string {
  return [
    t(
      'rules.intro',
      'Welcome to ShieldBattery! We want everyone to enjoy their time on our platform, and to ' +
        'that end, we require adherence to the following community guidelines:',
    ),
    t(
      'rules.list',
      '1. **Play fair.** Cheating is not permitted.\n2. **Respect others.** Refrain from ' +
        'abusive language and behavior, and treat fellow players with dignity.\n3. **Respect ' +
        'the game.** Don’t leave games prematurely.',
    ),
    t(
      'rules.consequences',
      'Failure to follow these guidelines may result in administrative consequences, including ' +
        'chat, matchmaking, and platform restrictions.',
    ),
  ].join('\n\n')
}

export function RulesPage() {
  const { t } = useTranslation()

  return (
    <GuidePage
      path={RULES_PATH}
      title={rulesTitle(t)}
      markdown={getRulesMarkdown(t)}
      copyLinkLabel={t('rules.copyLink', 'Copy link to the rules')}
    />
  )
}

const StyledDialog = styled(Dialog)`
  max-width: 720px;
`

/** Shows the rules over whatever the player is doing, without navigating away from it. */
export function RulesDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()

  return (
    <StyledDialog title={rulesTitle(t)} onCancel={onCancel} showCloseButton={true}>
      <NewsMarkdown source={getRulesMarkdown(t)} />
    </StyledDialog>
  )
}
