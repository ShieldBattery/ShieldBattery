import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BotView } from '../../common/bots/bot-view'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton, OutlinedButton, TextButton } from '../material/button'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodySmall, labelMedium, singleLine, titleMedium } from '../styles/typography'
import { cancelInstall, installBot, runAsyncAction, updateBot } from './bot-actions'
import { BotAvatar } from './bot-avatar'
import { botDisplayTags, PlayStyleTags, ReadinessBadge, StrengthBadge } from './bot-badges'

const AVATAR_SIZE = 48
const STRENGTH_ICON_SIZE = 40

const Card = styled.article<{ $highlighted: boolean }>`
  ${containerStyles(ContainerLevel.Normal)};

  padding: 16px 16px 8px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border: 1px solid ${props => (props.$highlighted ? 'var(--theme-primary)' : 'transparent')};
  border-radius: 8px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const NameBlock = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const Name = styled.div`
  ${titleMedium};
  ${singleLine};
`

const Attribution = styled.div`
  ${bodySmall};

  /* Version and author may take two lines; anything past that is cut rather than pushing the card. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;

  color: var(--theme-on-surface-variant);
`

const Note = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const UpdateLine = styled.div`
  ${labelMedium};

  display: inline-flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-amber-container);
`

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const Spacer = styled.div`
  flex-grow: 1;
`

/** Absorbs a card's spare height so the status block and actions stay anchored at the bottom. */
const Stretch = styled.div`
  flex-grow: 1;
`

/**
 * "Installed" is a status, not an action, so it has no outline; without one its padding would
 * leave the check floating to the right of the readiness icon in the row above, so the padding is
 * pulled back to the card's content edge.
 */
const InstalledLabel = styled(TextButton)`
  margin-left: -12px;
  color: var(--theme-success);
`

/** An outlined button that reads as "done": same shape as the action it replaces, success color. */
const SuccessOutlinedButton = styled(OutlinedButton)`
  color: var(--theme-success);
  border-color: rgb(from var(--theme-success) r g b / 0.6);
`

const DetailsButton = styled(IconButton)`
  /* Pulls the glyph out to the card's content edge, under the strength badge. */
  margin-right: -9px;

  color: var(--theme-on-surface-variant);
`

const NeutralTextButton = styled(TextButton)`
  color: var(--theme-on-surface-variant);
`

export type BotCardPrimaryAction =
  | { kind: 'add'; added: boolean; onToggle: () => void }
  /** Library mode: the card drives the install itself (Download/Update/Installed). */
  | { kind: 'install'; installed: boolean }
  | { kind: 'select'; onSelect: () => void }

export interface BotCardProps {
  bot: BotView
  /** Draws the selected/added border. */
  highlighted?: boolean
  primaryAction: BotCardPrimaryAction
  onDetails: () => void
  /** A line explaining why this bot is being suggested, shown under its readiness. */
  recommendationNote?: string
  className?: string
}

export function BotCard({
  bot,
  highlighted = false,
  primaryAction,
  onDetails,
  recommendationNote,
  className,
}: BotCardProps) {
  const { t } = useTranslation()

  const author = bot.authors[0]?.name
  const attribution = author
    ? t('practice.bots.versionAndAuthor', {
        defaultValue: '{{version}} · {{author}}',
        version: bot.version,
        author,
      })
    : bot.version

  // An available update replaces the readiness line: the bot is playable either way, so what the
  // user needs to know is that a newer package exists, not that this one works.
  const showUpdateLine = !!bot.updateAvailable && bot.readiness.state === 'ready'

  // A bot that still needs downloading is offered its download as the primary action; taking it
  // also performs the add/select, so one click does everything the user was about to do anyway.
  const canDownload = bot.readiness.state === 'notInstalled' && bot.readiness.canDownload
  const isDownloading = bot.readiness.state === 'installing'
  const downloadAndThen = (then: () => void) => {
    runAsyncAction(installBot(bot))
    then()
  }

  let actionButton: React.ReactNode
  switch (primaryAction.kind) {
    case 'add':
      if (primaryAction.added) {
        actionButton = (
          <SuccessOutlinedButton
            label={t('practice.bots.added', 'Added')}
            iconStart={<MaterialIcon icon='check' size={18} />}
            onClick={primaryAction.onToggle}
          />
        )
      } else if (canDownload) {
        actionButton = (
          <OutlinedButton
            label={t('practice.bots.download', 'Download')}
            iconStart={<MaterialIcon icon='download' size={18} />}
            onClick={() => downloadAndThen(primaryAction.onToggle)}
          />
        )
      } else if (isDownloading) {
        actionButton = (
          <OutlinedButton
            label={t('practice.bots.downloading', 'Downloading…')}
            iconStart={<MaterialIcon icon='hourglass_top' size={18} />}
            disabled={true}
          />
        )
      } else {
        actionButton = (
          <OutlinedButton
            label={t('practice.bots.add', 'Add')}
            iconStart={<MaterialIcon icon='add' size={18} />}
            onClick={primaryAction.onToggle}
          />
        )
      }
      break
    case 'install':
      if (bot.readiness.state === 'installing') {
        actionButton = (
          <NeutralTextButton
            label={t('common.actions.cancel', 'Cancel')}
            onClick={() => {
              runAsyncAction(cancelInstall(bot))
            }}
          />
        )
      } else if (bot.updateAvailable) {
        actionButton = (
          <OutlinedButton
            label={t('practice.bots.update', 'Update')}
            iconStart={<MaterialIcon icon='upgrade' size={18} />}
            onClick={() => {
              runAsyncAction(updateBot(bot))
            }}
          />
        )
      } else if (primaryAction.installed) {
        actionButton = (
          <InstalledLabel
            label={t('practice.bots.installed', 'Installed')}
            iconStart={<MaterialIcon icon='check' size={18} />}
            disabled={true}
          />
        )
      } else {
        actionButton = (
          <OutlinedButton
            label={t('practice.bots.download', 'Download')}
            iconStart={<MaterialIcon icon='download' size={18} />}
            onClick={() => {
              runAsyncAction(installBot(bot))
            }}
          />
        )
      }
      break
    case 'select':
      if (canDownload) {
        actionButton = (
          <OutlinedButton
            label={t('practice.bots.download', 'Download')}
            iconStart={<MaterialIcon icon='download' size={18} />}
            onClick={() => downloadAndThen(primaryAction.onSelect)}
          />
        )
      } else {
        actionButton = (
          <OutlinedButton label={t('practice.bots.use', 'Use')} onClick={primaryAction.onSelect} />
        )
      }
      break
    default:
      primaryAction satisfies never
  }

  return (
    <Card className={className} $highlighted={highlighted}>
      <Header>
        <BotAvatar races={bot.races} size={AVATAR_SIZE} />
        <NameBlock>
          <Name title={bot.name}>{bot.name}</Name>
          <Attribution>{attribution}</Attribution>
        </NameBlock>
        <StrengthBadge bot={bot} size={STRENGTH_ICON_SIZE} />
      </Header>

      <PlayStyleTags tags={botDisplayTags(bot, t)} />
      <Stretch />

      {showUpdateLine ? (
        <div>
          <UpdateLine>
            <MaterialIcon icon='upgrade' size={17} />
            {t('practice.bots.updateAvailable', 'Update available')}
          </UpdateLine>
          <Note>
            {t('practice.bots.updateIsSeparate', {
              defaultValue:
                'Your installed {{version}} stays playable; updating is a separate step.',
              version: bot.version,
            })}
          </Note>
        </div>
      ) : (
        <ReadinessBadge bot={bot} size='small' />
      )}

      {recommendationNote ? <Note>{recommendationNote}</Note> : null}

      <Actions>
        {actionButton}
        <Spacer />
        <DetailsButton
          icon={<MaterialIcon icon='info' size={22} />}
          title={t('practice.bots.details', 'Details')}
          ariaLabel={t('practice.bots.details', 'Details')}
          onClick={onDetails}
        />
      </Actions>
    </Card>
  )
}
