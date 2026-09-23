import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BotRaceName, BotRuntime, playsEveryRace } from '../../common/bots/bot-catalog'
import { BotKey } from '../../common/bots/bot-library'
import { BotView } from '../../common/bots/bot-view'
import { PracticeBotRace } from '../../common/bots/practice'
import { LineupEntryStatus, PoolReadiness } from '../../common/bots/practice-logic'
import { MapInfoJson } from '../../common/maps'
import { raceCharToLabel } from '../../common/races'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, FilledTonalButton, OutlinedButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { Dialog } from '../material/dialog'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyLarge, bodyMedium, labelLarge } from '../styles/typography'
import {
  cancelInstall,
  detectJava,
  installBot,
  openGetJavaLink,
  pickJavaFor,
  runAsyncAction,
} from './bot-actions'
import { botRaceToLabel, formatMegabytes, javaRuntimeLabel } from './bot-badges'

const BYTES_PER_MEGABYTE = 1024 * 1024

export type PracticeReadinessPayload =
  | { kind: 'missingRuntime'; bot: BotView; onStartWithout?: () => void }
  | {
      kind: 'incompatibleRace'
      bot: BotView
      race: PracticeBotRace
      onSetRace: (race: BotRaceName) => void
      onRemove: () => void
    }
  | { kind: 'downloading'; bot: BotView; onStartWithout?: () => void }
  | { kind: 'downloadFailed'; bot: BotView; onRemove: () => void; onStartWithout?: () => void }
  | {
      kind: 'partialLineup'
      readiness: PoolReadiness
      onStartAnyway: (dontAskAgain: boolean) => void
      onFixFirst: () => void
    }
  | {
      kind: 'nothingPlayable'
      readiness: PoolReadiness
      onDownloadMaps: () => void
      onDownloadBots: () => void
      onChangeMapPool: () => void
      onEditLineup: () => void
    }
  | {
      kind: 'problems'
      readiness: PoolReadiness
      onDownloadBots: () => void
      onEditLineup: () => void
      onChangeMapPool: () => void
      onRemoveBot: (key: BotKey) => void
      onStartWithReady: () => void
    }

export type PracticeReadinessDialogProps = CommonDialogProps & PracticeReadinessPayload

const StyledDialog = styled(Dialog)<{ $wide: boolean }>`
  max-width: ${props => (props.$wide ? '720px' : '560px')};
`

const Body = styled.div`
  ${bodyLarge};

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ProgressHeader = styled.div`
  ${bodyMedium};

  display: flex;
  justify-content: space-between;
  gap: 12px;

  color: var(--theme-on-surface-variant);
`

const ProgressTrack = styled.div`
  height: 4px;

  border-radius: 2px;
  background-color: var(--theme-container-highest);
`

const ProgressFill = styled.div<{ $fraction: number }>`
  width: ${props => Math.round(props.$fraction * 100)}%;
  height: 4px;

  border-radius: 2px;
  background-color: var(--theme-amber);
`

const Explanation = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Groups = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const GroupRoot = styled.div`
  ${containerStyles(ContainerLevel.High)};

  padding: 12px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 4px;
`

const GroupText = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const GroupTitle = styled.div`
  ${labelLarge};
`

const GroupItems = styled.ul`
  ${bodyMedium};

  margin: 4px 0 0;
  padding-left: 20px;

  color: var(--theme-on-surface-variant);
`

const GroupActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const AmberIcon = styled(MaterialIcon)`
  color: var(--theme-amber-container);
`

const ErrorIcon = styled(MaterialIcon)`
  color: var(--theme-error);
`

const MutedIcon = styled(MaterialIcon)`
  color: var(--theme-on-surface-variant);
`

function ProblemGroup({
  icon,
  title,
  items,
  actions,
}: {
  icon: React.ReactNode
  title: string
  items: ReadonlyArray<string>
  actions: React.ReactNode
}) {
  return (
    <GroupRoot>
      {icon}
      <GroupText>
        <GroupTitle>{title}</GroupTitle>
        <GroupItems>
          {items.map(item => (
            <li key={item}>{item}</li>
          ))}
        </GroupItems>
      </GroupText>
      <GroupActions>{actions}</GroupActions>
    </GroupRoot>
  )
}

function botLabel(entry: LineupEntryStatus): string {
  return `${entry.ref.name} ${entry.ref.version}`
}

function installSizeBytes(bot: BotView): number {
  switch (bot.readiness.state) {
    case 'notInstalled':
      return bot.readiness.sizeBytes
    case 'installing':
      return bot.readiness.progress.totalBytes
    case 'installFailed':
      return bot.readiness.failure.totalBytes
    default:
      return 0
  }
}

interface ProblemGroupings {
  missingMaps: ReadonlyArray<MapInfoJson>
  notDownloaded: LineupEntryStatus[]
  needsRuntime: LineupEntryStatus[]
  noPlayableMap: LineupEntryStatus[]
  unusable: LineupEntryStatus[]
}

/** Sorts everything blocking a draw into the groups the user can act on in one step. */
function groupProblems(readiness: PoolReadiness): ProblemGroupings {
  const notDownloaded: LineupEntryStatus[] = []
  const needsRuntime: LineupEntryStatus[] = []
  const noPlayableMap: LineupEntryStatus[] = []
  const unusable: LineupEntryStatus[] = []

  for (const entry of readiness.entries) {
    if (entry.playable) {
      continue
    }
    const bot = entry.bot
    if (!bot) {
      unusable.push(entry)
      continue
    }

    switch (bot.readiness.state) {
      case 'notInstalled':
      case 'installing':
      case 'installFailed':
        notDownloaded.push(entry)
        break
      case 'missingRuntime':
        needsRuntime.push(entry)
        break
      case 'ready':
        noPlayableMap.push(entry)
        break
      default:
        unusable.push(entry)
        break
    }
  }

  return {
    missingMaps: readiness.missingMaps,
    notDownloaded,
    needsRuntime,
    noPlayableMap,
    unusable,
  }
}

function downloadCountLabel(count: number, t: TFunction): string {
  return count === 2
    ? t('practice.readiness.downloadBoth', 'Download both')
    : t('practice.readiness.downloadAll', {
        defaultValue: 'Download all {{count}}',
        count,
      })
}

/** The runtime the runtime-less bots in a lineup need; they share one in practice. */
function firstMissingRuntime(
  entries: ReadonlyArray<LineupEntryStatus>,
): Extract<BotRuntime, { kind: 'java' }> | undefined {
  for (const entry of entries) {
    if (entry.bot?.readiness.state === 'missingRuntime') {
      return entry.bot.readiness.runtime
    }
  }
  return undefined
}

function mapConstraintText(entry: LineupEntryStatus, t: TFunction): string {
  const constraints = entry.bot?.mapConstraints ?? []
  return constraints.length > 0
    ? t('practice.readiness.mapConstraintDetail', {
        defaultValue: '{{bot}} · {{constraints}}',
        bot: botLabel(entry),
        constraints: constraints.join(', '),
      })
    : t('practice.readiness.noMapFits', {
        defaultValue: '{{bot}} · no map in this pool fits it',
        bot: botLabel(entry),
      })
}

/** A short phrase saying why one lineup entry can't be drawn, for the one-sentence summaries. */
function problemPhrase(entry: LineupEntryStatus, t: TFunction): string {
  const name = entry.ref.name
  const bot = entry.bot
  if (!bot) {
    return t('practice.readiness.phrase.missing', {
      defaultValue: '{{name}} is no longer installed',
      name,
    })
  }

  switch (bot.readiness.state) {
    case 'notInstalled':
      return t('practice.readiness.phrase.notDownloaded', {
        defaultValue: "{{name}} isn't downloaded",
        name,
      })
    case 'installing':
      return t('practice.readiness.phrase.downloading', {
        defaultValue: '{{name}} is still downloading',
        name,
      })
    case 'installFailed':
      return t('practice.readiness.phrase.downloadFailed', {
        defaultValue: "{{name}} couldn't be downloaded",
        name,
      })
    case 'missingRuntime':
      return t('practice.readiness.phrase.needsRuntime', {
        defaultValue: '{{name}} needs {{runtime}}',
        name,
        runtime: javaRuntimeLabel(bot.readiness.runtime, t),
      })
    case 'missingFiles':
      return t('practice.readiness.phrase.cantStart', {
        defaultValue: "{{name}} can't start",
        name,
      })
    case 'ready':
      return t('practice.readiness.phrase.noMap', {
        defaultValue: "{{name}} can't play any map in this pool",
        name,
      })
    default:
      return bot.readiness satisfies never
  }
}

function joinPhrases(phrases: ReadonlyArray<string>, t: TFunction): string {
  if (phrases.length <= 1) {
    return phrases[0] ?? ''
  }
  return t('practice.readiness.phraseJoin', {
    defaultValue: '{{list}} and {{last}}',
    list: phrases.slice(0, -1).join(', '),
    last: phrases[phrases.length - 1],
  })
}

export function PracticeReadinessDialog(props: PracticeReadinessDialogProps) {
  const { t } = useTranslation()
  const { onCancel, close } = props
  const payload: PracticeReadinessPayload = props
  const [dontAskAgain, setDontAskAgain] = useState(false)

  /** Every action in these dialogs resolves the question that opened them, so it closes too. */
  const act = (action: () => void) => () => {
    action()
    close()
  }

  switch (payload.kind) {
    case 'missingRuntime': {
      const { bot, onStartWithout } = payload
      const runtime = bot.runtime.kind === 'java' ? bot.runtime : undefined
      const runtimeName = runtime
        ? javaRuntimeLabel(runtime, t)
        : t('practice.readiness.aRuntime', 'a runtime')

      const buttons = [
        <FilledTonalButton
          key='pick-java'
          label={t('practice.readiness.useExistingJava', 'Use an existing Java install…')}
          onClick={act(() => {
            runAsyncAction(pickJavaFor(bot))
          })}
        />,
        <FilledTonalButton
          key='check'
          label={t('practice.readiness.checkAgain', 'Check again')}
          iconStart={<MaterialIcon icon='refresh' size={18} />}
          onClick={act(() => {
            runAsyncAction(detectJava())
          })}
        />,
      ]
      if (onStartWithout) {
        buttons.push(
          <FilledTonalButton
            key='start-without'
            label={t('practice.readiness.startWithout', {
              defaultValue: 'Start without {{name}}',
              name: bot.name,
            })}
            iconStart={<MaterialIcon icon='play_arrow' size={18} />}
            onClick={act(onStartWithout)}
          />,
        )
      }
      buttons.push(
        <FilledButton
          key='get-java'
          label={t('practice.readiness.getRuntime', {
            defaultValue: 'Get {{runtime}}',
            runtime: runtimeName,
          })}
          iconStart={<MaterialIcon icon='open_in_new' size={18} />}
          onClick={act(() => openGetJavaLink(bot.runtime))}
        />,
      )

      return (
        <StyledDialog
          $wide={false}
          showCloseButton={true}
          onCancel={onCancel}
          buttons={buttons}
          title={t('practice.readiness.needsRuntimeTitle', {
            defaultValue: '{{name}} needs {{runtime}}',
            name: bot.name,
            runtime: runtimeName,
          })}>
          <Body>
            {t('practice.readiness.needsRuntimeBody', {
              defaultValue:
                "No compatible Java was found on this PC. Install it, then check again. {{name}} won't be drawn until it can start.",
              name: bot.name,
            })}
          </Body>
        </StyledDialog>
      )
    }

    case 'incompatibleRace': {
      const { bot, race, onSetRace, onRemove } = payload
      const supported = bot.races[0]
      const racesText = bot.races.map(r => botRaceToLabel(r, t)).join(', ')
      const randomNote = playsEveryRace(bot.races)
        ? ''
        : t('practice.readiness.noRandomNote', {
            defaultValue: " Random isn't offered because {{name}} doesn't support it.",
            name: bot.name,
          })

      const buttons = [
        <FilledTonalButton
          key='remove'
          label={t('practice.readiness.removeFromSlot', 'Remove from slot')}
          onClick={act(onRemove)}
        />,
        <FilledButton
          key='set-race'
          label={t('practice.readiness.setToRace', {
            defaultValue: 'Set to {{race}}',
            race: supported ? botRaceToLabel(supported, t) : '',
          })}
          disabled={!supported}
          onClick={act(() => {
            if (supported) {
              onSetRace(supported)
            }
          })}
        />,
      ]

      return (
        <StyledDialog
          $wide={false}
          showCloseButton={true}
          onCancel={onCancel}
          buttons={buttons}
          title={t('practice.readiness.incompatibleRaceTitle', {
            defaultValue: "{{name}} can't play {{race}}",
            name: bot.name,
            race: race === 'random' ? raceCharToLabel('r', t) : botRaceToLabel(race, t),
          })}>
          <Body>
            {t('practice.readiness.incompatibleRaceBody', {
              defaultValue:
                'This package only plays {{races}}. Pick {{race}} for this slot, or remove the bot.',
              races: racesText,
              race: supported ? botRaceToLabel(supported, t) : racesText,
            }) + randomNote}
          </Body>
        </StyledDialog>
      )
    }

    case 'downloading': {
      const { bot, onStartWithout } = payload
      const progress = bot.readiness.state === 'installing' ? bot.readiness.progress : undefined
      const received = progress?.receivedBytes ?? 0
      const total = progress?.totalBytes ?? 0

      const buttons = [
        <FilledTonalButton
          key='cancel-download'
          label={t('practice.readiness.cancelDownload', 'Cancel download')}
          onClick={act(() => {
            runAsyncAction(cancelInstall(bot))
          })}
        />,
      ]
      if (onStartWithout) {
        buttons.push(
          <FilledButton
            key='start-without'
            label={t('practice.readiness.startWithout', {
              defaultValue: 'Start without {{name}}',
              name: bot.name,
            })}
            iconStart={<MaterialIcon icon='play_arrow' size={18} />}
            onClick={act(onStartWithout)}
          />,
        )
      }

      return (
        <StyledDialog
          $wide={false}
          showCloseButton={true}
          onCancel={onCancel}
          buttons={buttons}
          title={t('practice.readiness.downloadingTitle', {
            defaultValue: 'Downloading {{name}}',
            name: bot.name,
          })}>
          <Body>
            <div>
              <ProgressHeader>
                <span>{`${bot.name} ${bot.version}`}</span>
                <span>
                  {t('practice.readiness.downloadProgress', {
                    defaultValue: '{{received}} of {{total}}',
                    received: Math.round(received / BYTES_PER_MEGABYTE),
                    total: formatMegabytes(total, t),
                  })}
                </span>
              </ProgressHeader>
              <ProgressTrack
                role='progressbar'
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={received}>
                <ProgressFill $fraction={total > 0 ? received / total : 0} />
              </ProgressTrack>
            </div>
            <Explanation>
              {t(
                'practice.readiness.verifiedBeforeReady',
                "The package is checked before it's marked ready.",
              )}
            </Explanation>
          </Body>
        </StyledDialog>
      )
    }

    case 'downloadFailed': {
      const { bot, onRemove, onStartWithout } = payload
      const failure = bot.readiness.state === 'installFailed' ? bot.readiness.failure : undefined

      const buttons = [
        <FilledTonalButton
          key='remove'
          label={t('practice.readiness.removeBot', {
            defaultValue: 'Remove {{name}}',
            name: bot.name,
          })}
          onClick={act(onRemove)}
        />,
      ]
      if (onStartWithout) {
        buttons.push(
          <FilledTonalButton
            key='start-without'
            label={t('practice.readiness.startWithout', {
              defaultValue: 'Start without {{name}}',
              name: bot.name,
            })}
            iconStart={<MaterialIcon icon='play_arrow' size={18} />}
            onClick={act(onStartWithout)}
          />,
        )
      }
      buttons.push(
        <FilledButton
          key='retry'
          label={t('practice.readiness.retryDownload', 'Retry download')}
          iconStart={<MaterialIcon icon='refresh' size={18} />}
          onClick={act(() => {
            runAsyncAction(installBot(bot))
          })}
        />,
      )

      return (
        <StyledDialog
          $wide={false}
          showCloseButton={true}
          onCancel={onCancel}
          buttons={buttons}
          title={t('practice.readiness.downloadFailedTitle', {
            defaultValue: "Couldn't download {{name}}",
            name: bot.name,
          })}>
          <Body>
            {failure?.error}
            <div>
              {t('practice.readiness.setupUnchanged', 'Your lineup and map pool are unchanged.')}
            </div>
          </Body>
        </StyledDialog>
      )
    }

    case 'partialLineup': {
      const { readiness, onStartAnyway, onFixFirst } = payload
      const notReady = readiness.entries.filter(e => !e.playable)
      const phrases = joinPhrases(
        notReady.map(entry => problemPhrase(entry, t)),
        t,
      )

      const buttons = [
        <FilledTonalButton
          key='cancel'
          label={t('common.actions.cancel', 'Cancel')}
          onClick={close}
        />,
        <FilledTonalButton
          key='fix'
          label={t('practice.readiness.fixFirst', 'Fix first')}
          iconStart={<MaterialIcon icon='build' size={18} />}
          onClick={act(onFixFirst)}
        />,
        <FilledButton
          key='start-anyway'
          label={t('practice.readiness.startAnyway', 'Start anyway')}
          iconStart={<MaterialIcon icon='play_arrow' size={18} />}
          onClick={act(() => onStartAnyway(dontAskAgain))}
        />,
      ]

      return (
        <StyledDialog
          $wide={false}
          showCloseButton={true}
          onCancel={onCancel}
          buttons={buttons}
          title={t('practice.readiness.partialLineupTitle', {
            defaultValue_one: "{{count}} of {{total}} opponents isn't ready",
            defaultValue_other: "{{count}} of {{total}} opponents aren't ready",
            count: notReady.length,
            total: readiness.entries.length,
          })}>
          <Body>
            <div>
              {t('practice.readiness.partialLineupBody', {
                defaultValue: '{{problems}}. Only ready opponents can be drawn.',
                problems: phrases,
              })}
            </div>
            <CheckBox
              checked={dontAskAgain}
              label={t('practice.readiness.dontAskAgain', "Don't ask again")}
              onChange={event => setDontAskAgain(event.target.checked)}
            />
          </Body>
        </StyledDialog>
      )
    }

    case 'nothingPlayable':
    case 'problems': {
      const { readiness } = payload
      const groups = groupProblems(readiness)
      const runtime = firstMissingRuntime(groups.needsRuntime)
      const runtimeName = runtime
        ? javaRuntimeLabel(runtime, t)
        : t('practice.readiness.aRuntime', 'a runtime')
      const onChangeMapPool = payload.onChangeMapPool
      const onEditLineup = payload.onEditLineup
      const onDownloadBots = payload.onDownloadBots
      const onDownloadMaps = payload.kind === 'nothingPlayable' ? payload.onDownloadMaps : undefined
      const onRemoveBot = payload.kind === 'problems' ? payload.onRemoveBot : undefined

      const totalBotBytes = groups.notDownloaded.reduce(
        (sum, entry) => sum + (entry.bot ? installSizeBytes(entry.bot) : 0),
        0,
      )

      const rows: React.ReactNode[] = []
      if (readiness.entries.length === 0) {
        rows.push(
          <ProblemGroup
            key='empty'
            icon={<MutedIcon icon='group' size={22} />}
            title={t('practice.readiness.emptyLineupTitle', 'No opponents in the lineup')}
            items={[
              t(
                'practice.readiness.emptyLineupText',
                'Add at least one bot so there is someone to draw.',
              ),
            ]}
            actions={
              <OutlinedButton
                label={t('practice.readiness.addOpponents', 'Add opponents')}
                iconStart={<MaterialIcon icon='add' size={18} />}
                onClick={act(onEditLineup)}
              />
            }
          />,
        )
      }
      if (groups.missingMaps.length > 0 && onDownloadMaps) {
        rows.push(
          <ProblemGroup
            key='maps'
            icon={<AmberIcon icon='download' size={22} />}
            title={t('practice.readiness.mapsNotDownloaded', {
              defaultValue_one: '{{count}} map not downloaded',
              defaultValue_other: '{{count}} maps not downloaded',
              count: groups.missingMaps.length,
            })}
            items={groups.missingMaps.map(map => map.name)}
            actions={
              <OutlinedButton
                label={t('practice.readiness.downloadMaps', {
                  defaultValue_one: 'Download {{count}} map',
                  defaultValue_other: 'Download {{count}} maps',
                  count: groups.missingMaps.length,
                })}
                iconStart={<MaterialIcon icon='download' size={18} />}
                onClick={act(onDownloadMaps)}
              />
            }
          />,
        )
      }
      if (groups.notDownloaded.length > 0) {
        rows.push(
          <ProblemGroup
            key='bots'
            icon={<AmberIcon icon='download' size={22} />}
            title={t('practice.readiness.botsNotDownloaded', {
              defaultValue_one: '{{count}} bot not downloaded · {{size}}',
              defaultValue_other: '{{count}} bots not downloaded · {{size}}',
              count: groups.notDownloaded.length,
              size: formatMegabytes(totalBotBytes, t),
            })}
            items={groups.notDownloaded.map(botLabel)}
            actions={
              <OutlinedButton
                label={downloadCountLabel(groups.notDownloaded.length, t)}
                iconStart={<MaterialIcon icon='download' size={18} />}
                onClick={act(onDownloadBots)}
              />
            }
          />,
        )
      }
      if (groups.needsRuntime.length > 0) {
        rows.push(
          <ProblemGroup
            key='runtime'
            icon={<ErrorIcon icon='error' size={22} />}
            title={t('practice.readiness.runtimeNeededBy', {
              defaultValue: '{{runtime}} not installed · needed by {{count}} bots',
              runtime: runtimeName,
              count: groups.needsRuntime.length,
            })}
            items={groups.needsRuntime.map(botLabel)}
            actions={
              <>
                <TextButton
                  label={t('practice.readiness.useExistingJava', 'Use an existing Java install…')}
                  onClick={act(() => {
                    const bot = groups.needsRuntime[0]?.bot
                    if (bot) {
                      runAsyncAction(pickJavaFor(bot))
                    }
                  })}
                />
                <TextButton
                  label={t('practice.readiness.checkAgain', 'Check again')}
                  iconStart={<MaterialIcon icon='refresh' size={18} />}
                  onClick={act(() => {
                    runAsyncAction(detectJava())
                  })}
                />
                <OutlinedButton
                  label={t('practice.readiness.getRuntime', {
                    defaultValue: 'Get {{runtime}}',
                    runtime: runtimeName,
                  })}
                  iconStart={<MaterialIcon icon='open_in_new' size={18} />}
                  onClick={act(() => {
                    const bot = groups.needsRuntime[0]?.bot
                    if (bot) {
                      openGetJavaLink(bot.runtime)
                    }
                  })}
                />
              </>
            }
          />,
        )
      }
      if (groups.noPlayableMap.length > 0) {
        rows.push(
          <ProblemGroup
            key='no-map'
            icon={<ErrorIcon icon='block' size={22} />}
            title={t('practice.readiness.cantPlayAnyMap', {
              defaultValue_one: "{{count}} bot can't play any map in this pool",
              defaultValue_other: "{{count}} bots can't play any map in this pool",
              count: groups.noPlayableMap.length,
            })}
            items={groups.noPlayableMap.map(entry => mapConstraintText(entry, t))}
            actions={
              <>
                {onRemoveBot && groups.noPlayableMap.length === 1 ? (
                  <TextButton
                    label={t('practice.readiness.removeBot', {
                      defaultValue: 'Remove {{name}}',
                      name: groups.noPlayableMap[0].ref.name,
                    })}
                    onClick={act(() => onRemoveBot(groups.noPlayableMap[0].ref.key))}
                  />
                ) : null}
                <TextButton
                  label={t('practice.readiness.changeMapPool', 'Change map pool')}
                  onClick={act(onChangeMapPool)}
                />
              </>
            }
          />,
        )
      }
      if (groups.unusable.length > 0) {
        rows.push(
          <ProblemGroup
            key='unusable'
            icon={<ErrorIcon icon='error' size={22} />}
            title={t('practice.readiness.cantStartBots', {
              defaultValue_one: "{{count}} bot can't start",
              defaultValue_other: "{{count}} bots can't start",
              count: groups.unusable.length,
            })}
            items={groups.unusable.map(botLabel)}
            actions={
              <TextButton
                label={t('practice.readiness.editLineup', 'Edit lineup')}
                iconStart={<MaterialIcon icon='group' size={18} />}
                onClick={act(onEditLineup)}
              />
            }
          />,
        )
      }

      const buttons =
        payload.kind === 'nothingPlayable'
          ? [
              <OutlinedButton
                key='change-pool'
                label={t('practice.readiness.changeMapPool', 'Change map pool')}
                iconStart={<MaterialIcon icon='map' size={18} />}
                onClick={act(onChangeMapPool)}
              />,
              <OutlinedButton
                key='edit-lineup'
                label={t('practice.readiness.editLineup', 'Edit lineup')}
                iconStart={<MaterialIcon icon='group' size={18} />}
                onClick={act(onEditLineup)}
              />,
            ]
          : [
              <OutlinedButton
                key='edit-lineup'
                label={t('practice.readiness.editLineup', 'Edit lineup')}
                iconStart={<MaterialIcon icon='group' size={18} />}
                onClick={act(onEditLineup)}
              />,
              <FilledButton
                key='start-ready'
                label={t('practice.readiness.startWithReady', {
                  defaultValue: 'Start with {{count}} of {{total}} opponents',
                  count: readiness.playableEntries.length,
                  total: readiness.entries.length,
                })}
                iconStart={<MaterialIcon icon='play_arrow' size={18} />}
                onClick={act(payload.kind === 'problems' ? payload.onStartWithReady : () => {})}
              />,
            ]

      const notReadyCount = readiness.entries.length - readiness.playableEntries.length

      return (
        <StyledDialog
          $wide={true}
          showCloseButton={true}
          onCancel={onCancel}
          buttons={buttons}
          title={
            payload.kind === 'nothingPlayable'
              ? t(
                  'practice.readiness.nothingPlayableTitle',
                  'Nothing in this pool can be played yet',
                )
              : t('practice.readiness.problemsTitle', {
                  defaultValue_one: "{{count}} of {{total}} opponents isn't ready",
                  defaultValue_other: "{{count}} of {{total}} opponents aren't ready",
                  count: notReadyCount,
                  total: readiness.entries.length,
                })
          }>
          <Body>
            <Groups>{rows}</Groups>
          </Body>
        </StyledDialog>
      )
    }

    default:
      return payload satisfies never
  }
}
