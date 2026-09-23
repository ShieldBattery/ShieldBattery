import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BotFormatId, BotRuntime } from '../../common/bots/bot-catalog'
import { BotKey } from '../../common/bots/bot-library'
import { findJavaRuntime } from '../../common/bots/bot-view'
import { TypedIpcRenderer } from '../../common/ipc'
import { closeDialog, openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, OutlinedButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyMedium,
  bodySmall,
  labelLarge,
  singleLine,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import {
  installBot,
  openGetJavaLink,
  pickJavaFor,
  removeBot,
  resetLearning,
  runAsyncAction,
  updateBot,
} from './bot-actions'
import {
  botDisplayTags,
  botRaceToLabel,
  formatMegabytes,
  FormatSupportLine,
  javaRuntimeLabel,
  javaRuntimeLabelWithArchitecture,
  PlayStyleTags,
  RaceIconList,
  StrengthBadge,
} from './bot-badges'
import { botLibraryAtom, botViewsAtom } from './practice-atoms'

/** Removing a bot from this PC is destructive, so its action reads in the error color. */
const DestructiveTextButton = styled(TextButton)`
  color: var(--theme-error);
`

const ipcRenderer = new TypedIpcRenderer()

const ALL_FORMATS: ReadonlyArray<BotFormatId> = ['one-v-one', 'free-for-all', 'teams']

const installedDateFormat = new Intl.DateTimeFormat(navigator.language, {
  month: 'short',
  day: 'numeric',
})

const StyledDialog = styled(Dialog)`
  max-width: 720px;
`

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
`

const IconTile = styled.div`
  width: 64px;
  height: 64px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  background-color: var(--theme-container-highest);
  color: var(--theme-on-surface-variant);
`

const HeaderText = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const BotName = styled.div`
  ${titleLarge};
  ${singleLine};
`

const MetaRow = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;

  color: var(--theme-on-surface-variant);
`

const MetaItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`

const LinkButton = styled.button`
  padding: 0;

  background: transparent;
  border: none;
  color: var(--theme-amber);
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const InfoBlock = styled.div`
  ${containerStyles(ContainerLevel.High)};

  padding: 12px 16px;

  display: flex;
  align-items: center;
  gap: 12px;

  /* Long text in the first column wraps rather than squeezing the action beside it, whether the
     action is a bare button or one inside a tooltip wrapper. */
  & > :not(:first-child) {
    flex-shrink: 0;
  }

  border-radius: 8px;
`

const OutlinedBlock = styled.div`
  padding: 12px 16px;

  display: flex;
  align-items: flex-start;
  gap: 12px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const BlockText = styled.div`
  flex-grow: 1;
  min-width: 0;
  overflow-wrap: anywhere;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const BlockTitle = styled.div`
  ${labelLarge};
`

const Muted = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Description = styled.p`
  ${bodyMedium};

  margin: 0;

  color: var(--theme-on-surface-variant);
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const SectionHeading = styled.div`
  ${titleSmall};

  display: flex;
  align-items: baseline;
  gap: 8px;
`

const SectionQualifier = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Columns = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
`

const StrengthRow = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  gap: 10px;
`

const RaceName = styled.span`
  width: 64px;
`

const RowStrengthBadge = styled(StrengthBadge)`
  width: auto;

  flex-direction: row;
  align-items: center;
  gap: 10px;
`

const RequirementLine = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  gap: 8px;
`

const SuccessIcon = styled(MaterialIcon)`
  color: var(--theme-success);
`

const ErrorIcon = styled(MaterialIcon)`
  color: var(--theme-error);
`

const AmberIcon = styled(MaterialIcon)`
  color: var(--theme-amber-container);
`

const NoticeLinks = styled.div`
  ${bodySmall};

  display: flex;
  gap: 12px;
`

const ConfirmationContent = styled.div`
  ${bodyMedium};

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ConfirmationActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
`

const NoticeText = styled.pre`
  ${bodySmall};

  max-height: 400px;
  margin: 0;

  overflow: auto;
  user-select: text;
  white-space: pre-wrap;
`

const FooterSpacer = styled.div`
  flex-grow: 1;
`

function openExternal(url: string | undefined): void {
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export interface BotDetailsDialogProps extends CommonDialogProps {
  botKey: BotKey
  /** An extra primary action for the surface that opened the dialog (e.g. "Add to lineup"). */
  action?: { label: string; onAction: () => void }
}

export function BotDetailsDialog({ botKey, action, onCancel, close }: BotDetailsDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const library = useAtomValue(botLibraryAtom)
  const bots = useAtomValue(botViewsAtom)
  const bot = bots.find(b => b.key === botKey)

  if (!bot) {
    return (
      <StyledDialog
        showCloseButton={true}
        onCancel={onCancel}
        title={t('practice.details.missingTitle', 'This bot is no longer in your library')}>
        <Description>
          {t(
            'practice.details.missingBody',
            'It may have been removed from this PC. Add it again to see its details.',
          )}
        </Description>
      </StyledDialog>
    )
  }

  const isLocalBuild = bot.source === 'local'
  const runtime: BotRuntime = bot.runtime

  const openConfirmation = ({
    title,
    body,
    confirmLabel,
    onConfirm,
  }: {
    title: string
    body: string
    confirmLabel: string
    onConfirm: () => void
  }) => {
    dispatch(
      openSimpleDialog(
        title,
        <ConfirmationContent>
          <div>{body}</div>
          <ConfirmationActions>
            <TextButton
              label={t('common.actions.cancel', 'Cancel')}
              onClick={() => dispatch(closeDialog(DialogType.Simple))}
            />
            <FilledButton
              label={confirmLabel}
              onClick={() => {
                dispatch(closeDialog(DialogType.Simple))
                onConfirm()
              }}
            />
          </ConfirmationActions>
        </ConfirmationContent>,
        false,
      ),
    )
  }

  const showLicenses = async () => {
    const licenses = bot.installed?.package.licenses ?? []
    if (licenses.length === 0) {
      dispatch(
        openSimpleDialog(
          t('practice.details.licenseTitle', 'License'),
          t(
            'practice.details.noLicenseText',
            "This package doesn't carry a license notice on this PC.",
          ),
        ),
      )
      return
    }

    const sections: string[] = []
    for (const license of licenses) {
      const text = await ipcRenderer.invoke('botLibraryReadNotice', bot.key, license.noticePath)
      sections.push(`${license.name}\n\n${text ?? ''}`)
    }

    dispatch(
      openSimpleDialog(
        t('practice.details.licenseTitle', 'License'),
        <NoticeText>{sections.join('\n\n')}</NoticeText>,
      ),
    )
  }

  let versionBlock: React.ReactNode
  if (isLocalBuild) {
    versionBlock = (
      <InfoBlock>
        <BlockText>
          <BlockTitle>{bot.localBuild?.executable}</BlockTitle>
          <Muted>
            {t('practice.details.localBuildVersion', {
              defaultValue: 'Version {{version}}',
              version: bot.version,
            })}
          </Muted>
        </BlockText>
        <TextButton
          label={t('practice.details.configureBuild', 'Configure…')}
          onClick={() => {
            dispatch(
              openDialog({
                type: DialogType.LocalBuildBot,
                initData: { existing: bot.localBuild },
              }),
            )
          }}
        />
      </InfoBlock>
    )
  } else if (bot.installed) {
    versionBlock = (
      <InfoBlock>
        <BlockText>
          <BlockTitle>
            {t('practice.details.installedVersion', {
              defaultValue: 'Version {{version}} · installed {{date}} · {{size}}',
              version: bot.installed.version,
              date: installedDateFormat.format(new Date(bot.installed.installedAt)),
              size: formatMegabytes(bot.installed.sizeBytes, t),
            })}
          </BlockTitle>
          <Muted>
            {t(
              'practice.details.installedKeepsWorking',
              'Your installed version keeps working until you update.',
            )}
          </Muted>
        </BlockText>
        {bot.updateAvailable ? (
          <TextButton
            label={t('practice.details.updateTo', {
              defaultValue: 'Update to {{version}}',
              version: bot.updateAvailable.package.version,
            })}
            iconStart={<MaterialIcon icon='upgrade' size={18} />}
            onClick={() => {
              runAsyncAction(updateBot(bot))
            }}
          />
        ) : null}
      </InfoBlock>
    )
  } else {
    const sizeBytes = bot.readiness.state === 'notInstalled' ? bot.readiness.sizeBytes : 0
    versionBlock = (
      <InfoBlock>
        <BlockText>
          <BlockTitle>
            {t('practice.details.notInstalled', {
              defaultValue: 'Not installed · {{size}}',
              size: formatMegabytes(sizeBytes, t),
            })}
          </BlockTitle>
          <Muted>
            {t('practice.details.notInstalledVersion', {
              defaultValue: 'Version {{version}}',
              version: bot.version,
            })}
          </Muted>
        </BlockText>
        <OutlinedButton
          label={t('practice.bots.download', 'Download')}
          iconStart={<MaterialIcon icon='download' size={18} />}
          onClick={() => {
            runAsyncAction(installBot(bot))
          }}
        />
      </InfoBlock>
    )
  }

  const javaPath =
    runtime.kind === 'java'
      ? (bot.javaOverride ?? findJavaRuntime(library?.java.detected ?? [], runtime)?.path)
      : undefined

  let requirements: React.ReactNode
  if (runtime.kind === 'native') {
    requirements = (
      <RequirementLine>
        <SuccessIcon icon='check_circle' size={18} />
        {t('practice.details.noRuntimeNeeded', 'No runtime needed (native)')}
      </RequirementLine>
    )
  } else if (javaPath) {
    requirements = (
      <RequirementLine>
        <SuccessIcon icon='check_circle' size={18} />
        {t('practice.details.runtimeInstalledAt', {
          defaultValue: '{{runtime}} · installed at {{path}}',
          runtime: javaRuntimeLabelWithArchitecture(runtime, t),
          path: javaPath,
        })}
      </RequirementLine>
    )
  } else {
    requirements = (
      <Section>
        <RequirementLine>
          <ErrorIcon icon='error' size={18} />
          {t('practice.details.runtimeMissing', {
            defaultValue: '{{runtime}} not installed',
            runtime: javaRuntimeLabelWithArchitecture(runtime, t),
          })}
        </RequirementLine>
        <NoticeLinks>
          <LinkButton type='button' onClick={() => openGetJavaLink(runtime)}>
            {t('practice.details.getRuntime', {
              defaultValue: 'Get {{runtime}}',
              runtime: javaRuntimeLabel(runtime, t),
            })}
          </LinkButton>
        </NoticeLinks>
        <div>
          <TextButton
            label={t('practice.readiness.useExistingJava', 'Use an existing Java install…')}
            onClick={() => {
              runAsyncAction(pickJavaFor(bot))
            }}
          />
        </div>
      </Section>
    )
  }

  const learningBlock = (() => {
    switch (bot.learning.mode) {
      case 'persistent':
        return (
          <InfoBlock>
            <MaterialIcon icon='psychology' size={24} />
            <BlockText>
              <BlockTitle>
                {t('practice.details.learnsBetweenGames', 'Learns between games')}
              </BlockTitle>
              <Muted>
                {t(
                  'practice.details.learningKept',
                  'History is kept across updates when the new version can read it',
                )}
              </Muted>
            </BlockText>
            <Tooltip
              text={t(
                'practice.details.resetWhileInUse',
                "This bot is in a game right now, so its history can't be reset.",
              )}
              disabled={!bot.inUse}>
              <TextButton
                label={t('practice.details.resetLearning', 'Reset learning')}
                iconStart={<MaterialIcon icon='restart_alt' size={18} />}
                disabled={bot.inUse}
                onClick={() =>
                  openConfirmation({
                    title: t('practice.details.resetLearningTitle', {
                      defaultValue: "Reset {{name}}'s learning?",
                      name: bot.name,
                    }),
                    body: t(
                      'practice.details.resetLearningBody',
                      "This returns the bot to the baseline that came with its package, which may already contain training data. It won't make the bot play the same way in every match, and it doesn't uninstall anything.",
                    ),
                    confirmLabel: t('practice.details.resetLearning', 'Reset learning'),
                    onConfirm: () => {
                      runAsyncAction(resetLearning(bot))
                    },
                  })
                }
              />
            </Tooltip>
          </InfoBlock>
        )
      case 'none':
        return (
          <InfoBlock>
            <MaterialIcon icon='psychology' size={24} />
            <BlockText>
              <BlockTitle>
                {t('practice.details.noLearning', "Doesn't learn between games")}
              </BlockTitle>
              {bot.learning.notes ? <Muted>{bot.learning.notes}</Muted> : null}
            </BlockText>
          </InfoBlock>
        )
      case 'unknown':
        return (
          <InfoBlock>
            <MaterialIcon icon='psychology' size={24} />
            <BlockText>
              <BlockTitle>
                {t('practice.details.unknownLearning', 'Saved data behavior unknown')}
              </BlockTitle>
              {bot.learning.notes ? <Muted>{bot.learning.notes}</Muted> : null}
            </BlockText>
          </InfoBlock>
        )
      default:
        return bot.learning.mode satisfies never
    }
  })()

  const buttons: React.ReactNode[] = [
    <DestructiveTextButton
      key='remove'
      label={
        isLocalBuild
          ? t('practice.details.remove', 'Remove')
          : t('practice.details.removeFromPc', 'Remove from this PC')
      }
      iconStart={<MaterialIcon icon='delete' size={18} />}
      disabled={bot.inUse || (!bot.installed && !isLocalBuild)}
      onClick={() => {
        if (isLocalBuild) {
          runAsyncAction(removeBot(bot))
          close()
          return
        }
        openConfirmation({
          title: t('practice.details.removeTitle', {
            defaultValue: 'Remove {{name}} from this PC?',
            name: bot.name,
          }),
          body: t(
            'practice.details.removeBody',
            'The downloaded files are deleted. Anything the bot learned while playing you is kept, and you can download it again later.',
          ),
          confirmLabel: t('practice.details.removeFromPc', 'Remove from this PC'),
          onConfirm: () => {
            runAsyncAction(removeBot(bot))
            close()
          },
        })
      }}
    />,
    <FooterSpacer key='spacer' />,
    <TextButton
      key='close'
      label={action ? t('common.actions.cancel', 'Cancel') : t('common.actions.close', 'Close')}
      onClick={onCancel}
    />,
  ]
  if (action) {
    buttons.push(
      <FilledButton
        key='action'
        label={action.label}
        onClick={() => {
          action.onAction()
          close()
        }}
      />,
    )
  }

  const homepage = bot.homepage || bot.sourceUrl
  const tags = botDisplayTags(bot, t)

  return (
    <StyledDialog
      showCloseButton={true}
      onCancel={onCancel}
      buttons={buttons}
      title={
        <Header>
          <IconTile>
            <MaterialIcon icon={isLocalBuild ? 'code' : 'smart_toy'} size={36} />
          </IconTile>
          <HeaderText>
            <BotName>{bot.name}</BotName>
            <MetaRow>
              {bot.authors.length > 0 ? (
                <MetaItem>
                  {t('practice.details.byAuthor', {
                    defaultValue: 'by {{author}}',
                    author: bot.authors.map(a => a.name).join(', '),
                  })}
                </MetaItem>
              ) : null}
              {homepage ? (
                <LinkButton type='button' onClick={() => openExternal(homepage)}>
                  {t('practice.details.projectLink', 'Project page')}
                </LinkButton>
              ) : null}
              <MetaItem>
                <RaceIconList races={bot.races} size={16} />
              </MetaItem>
            </MetaRow>
            <PlayStyleTags tags={tags} />
          </HeaderText>
        </Header>
      }>
      <Body>
        {versionBlock}

        <Description>
          {isLocalBuild
            ? t(
                'practice.details.localBuildDescription',
                "A local build you added. ShieldBattery hasn't reviewed it.",
              )
            : bot.description}
        </Description>

        <Section>
          <SectionHeading>
            {t('practice.details.strength', 'Strength')}
            <SectionQualifier>{t('practice.details.estimated', 'estimated')}</SectionQualifier>
          </SectionHeading>
          {bot.races.map(race => (
            <StrengthRow key={race}>
              <RaceName>{botRaceToLabel(race, t)}</RaceName>
              <RowStrengthBadge bot={bot} race={race} size={28} />
            </StrengthRow>
          ))}
        </Section>

        <Columns>
          <Section>
            <SectionHeading>{t('practice.details.formats', 'Formats')}</SectionHeading>
            {ALL_FORMATS.map(format => {
              const info = bot.formats.find(f => f.id === format)
              return (
                <FormatSupportLine
                  key={format}
                  format={format}
                  support={info?.support ?? 'unverified'}
                  notes={info?.notes}
                />
              )
            })}
          </Section>
          <Section>
            <SectionHeading>{t('practice.details.requirements', 'Requirements')}</SectionHeading>
            {requirements}
          </Section>
        </Columns>

        {learningBlock}

        {bot.modifications.length > 0 ? (
          <OutlinedBlock>
            <AmberIcon icon='edit_note' size={24} />
            <BlockText>
              <BlockTitle>
                {t('practice.details.modifiedBy', {
                  defaultValue: 'Modified by {{modifier}}',
                  modifier: bot.modifications[0].modifier,
                })}
              </BlockTitle>
              {bot.modifications.map(modification => (
                <Muted key={`${modification.modifier}-${modification.date}`}>
                  {modification.summary}
                </Muted>
              ))}
              <NoticeLinks>
                <LinkButton type='button' onClick={() => openExternal(bot.sourceUrl)}>
                  {t('practice.details.patches', 'Patches')}
                </LinkButton>
                <LinkButton
                  type='button'
                  onClick={() => {
                    runAsyncAction(showLicenses())
                  }}>
                  {t('practice.details.license', 'License')}
                </LinkButton>
              </NoticeLinks>
            </BlockText>
          </OutlinedBlock>
        ) : null}
      </Body>
    </StyledDialog>
  )
}
