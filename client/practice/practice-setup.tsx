import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { BotKey } from '../../common/bots/bot-library'
import { computePoolReadiness, LineupEntryStatus } from '../../common/bots/practice-logic'
import { SbMapId } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch } from '../dispatch-registry'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { FilterChip } from '../material/filter-chip'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyMedium,
  bodySmall,
  labelLarge,
  labelSmall,
  singleLine,
  titleLarge,
  titleMedium,
} from '../styles/typography'
import { installBot } from './bot-actions'
import { BotAvatar } from './bot-avatar'
import { formatMegabytes, ReadinessBadge } from './bot-badges'
import { effectivePoolMapIds, fullPoolMapIds, useLadderMapPool } from './ladder-pool'
import { MapPoolEditor, MapPoolGrid } from './map-pool-editor'
import { botViewsAtom, installedMapHashesAtom, practiceStoreAtom } from './practice-atoms'
import { ensureMapsDownloaded, startPracticeMatchmaking } from './practice-launch'
import { PracticePageColumn } from './practice-layout'
import {
  beginMapPoolPresetEdit,
  cancelMapPoolPresetEdit,
  deleteMapPoolPreset,
  deleteOpponentPreset,
  lineupMatchesPreset,
  loadLineupPreset,
  renameMapPoolPreset,
  renameOpponentPreset,
  saveLineupAsPreset,
  saveMapPoolPreset,
  saveMapPoolPresetEdit,
  toggleMapPoolPresetEditMap,
  updateLineupPreset,
} from './practice-presets'
import { knownMapIdsToMaps, updatePracticeStore } from './practice-store'

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const PageTitle = styled.h1`
  ${titleLarge};
  margin: 0;
`

const HeaderSpacer = styled.div`
  flex-grow: 1;
`

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  align-items: start;
`

const MainColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Card = styled.section`
  ${containerStyles(ContainerLevel.Low)};

  padding: 20px;
  border-radius: 4px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const CardTitle = styled.h2`
  ${titleMedium};
  margin: 0;
`

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const HelperText = styled.p`
  ${bodySmall};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

const LineupRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const LineupRow = styled.div<{ $needsAttention: boolean }>`
  ${containerStyles(ContainerLevel.Normal)};

  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto 48px;
  align-items: center;
  gap: 12px;
  padding: 6px 8px 6px 6px;

  border-radius: 8px;
  border: 1px solid ${props => (props.$needsAttention ? 'var(--theme-amber)' : 'transparent')};
`

const LineupName = styled.div`
  ${bodyMedium};
  ${singleLine};
  font-weight: 500;
`

const LineupVersion = styled.span`
  color: var(--theme-on-surface-variant);
  font-weight: 400;
  margin-left: 6px;
`

const LineupStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const LineupStatusText = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const UnsavedIndicator = styled.div`
  ${labelLarge};

  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--theme-on-surface-variant);
`

const LineupFooter = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const Aside = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ReadinessCard = styled.section`
  ${containerStyles(ContainerLevel.High)};

  padding: 20px;
  border-radius: 4px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const EyebrowLabel = styled.div`
  ${labelSmall};
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const ReadinessLines = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ReadinessLine = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  gap: 8px;
`

const WarningBox = styled.div`
  ${containerStyles(ContainerLevel.Highest)};

  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border-radius: 4px;
`

const WarningList = styled.ul`
  ${bodySmall};
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const fullWidth = css`
  width: 100%;
`

const StartButton = styled(FilledButton)`
  ${fullWidth};
`

const DownloadButton = styled(OutlinedButton)`
  ${fullWidth};
`

const DrawNote = styled.p`
  ${bodySmall};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

function formatPoolDate(startDate: number): string {
  return new Date(startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** One line describing what a lineup entry can and can't do right now. */
function lineupStatusText(entry: LineupEntryStatus, t: TFunction): string | undefined {
  const bot = entry.bot
  if (!bot) {
    return t('practice.setup.entryUnavailable', 'No longer available')
  }

  switch (bot.readiness.state) {
    case 'notInstalled':
      return t('practice.setup.entryNotInstalled', {
        defaultValue: "Not installed · {{size}} download · won't be drawn until it's ready",
        size: formatMegabytes(bot.readiness.sizeBytes, t),
      })
    case 'installing':
      return t('practice.setup.entryInstalling', 'Downloading')
    case 'installFailed':
      return t('practice.setup.entryInstallFailed', 'Download failed')
    case 'missingRuntime':
      return t('practice.setup.entryMissingRuntime', {
        defaultValue: 'Needs Java {{major}}',
        major: bot.readiness.runtime.major,
      })
    case 'missingFiles':
      return t('practice.setup.entryMissingFiles', 'Files are missing')
    case 'ready':
      // A playable bot needs no explanation here; the action column already shows it's ready.
      return entry.playableMapIds.length === 0
        ? t('practice.setup.entryNoMaps', "Can't play any map in this pool")
        : undefined
    default:
      return bot.readiness satisfies never
  }
}

function problemLines(entries: ReadonlyArray<LineupEntryStatus>, t: TFunction): string[] {
  const lines: string[] = []
  for (const entry of entries) {
    if (entry.playable) {
      continue
    }
    const name = entry.ref.name
    if (!entry.bot) {
      lines.push(
        t('practice.setup.problemMissing', {
          defaultValue: "{{name}} isn't in your library any more. Download it again or remove it.",
          name,
        }),
      )
      continue
    }
    switch (entry.bot.readiness.state) {
      case 'notInstalled':
        lines.push(
          t('practice.setup.problemNotInstalled', {
            defaultValue:
              "{{name}} isn't installed, so it can't be drawn yet. Download it or remove it.",
            name,
          }),
        )
        break
      case 'missingRuntime':
        lines.push(
          t('practice.setup.problemRuntime', {
            defaultValue: '{{name}} needs Java {{major}} before it can play.',
            name,
            major: entry.bot.readiness.runtime.major,
          }),
        )
        break
      case 'installFailed':
        lines.push(
          t('practice.setup.problemFailed', {
            defaultValue: "{{name}}'s download failed. Retry it or remove it.",
            name,
          }),
        )
        break
      case 'installing':
        lines.push(
          t('practice.setup.problemInstalling', {
            defaultValue: '{{name}} is still downloading.',
            name,
          }),
        )
        break
      default:
        lines.push(
          t('practice.setup.problemNoMap', {
            defaultValue: "{{name}} can't play any of the maps in this pool.",
            name,
          }),
        )
        break
    }
  }
  return lines
}

/** Asks for a preset name, then hands it to the caller's save/rename action. */
function openPresetNameDialog(
  title: string,
  initialName: string | undefined,
  onSubmit: (name: string) => void,
): void {
  dispatch(
    openDialog({
      type: DialogType.PracticePresetName,
      initData: { title, initialName, onSubmit },
    }),
  )
}

export function PracticeSetup() {
  const { t } = useTranslation()
  const store = useAtomValue(practiceStoreAtom)
  const bots = useAtomValue(botViewsAtom)
  const installedMapHashes = useAtomValue(installedMapHashesAtom)
  const { pool: ladderPool } = useLadderMapPool()

  const [lineupMenuRef, lineupMenuX, lineupMenuY, refreshLineupMenuPos] =
    useRefAnchorPosition<HTMLButtonElement>('right', 'bottom')
  const [lineupMenuOpen, openLineupMenu, closeLineupMenu] = usePopoverController({
    refreshAnchorPos: refreshLineupMenuPos,
  })
  const [poolMenuRef, poolMenuX, poolMenuY, refreshPoolMenuPos] =
    useRefAnchorPosition<HTMLButtonElement>('right', 'bottom')
  const [poolMenuOpen, openPoolMenu, closePoolMenu] = usePopoverController({
    refreshAnchorPos: refreshPoolMenuPos,
  })

  const setup = store.matchmaking
  const poolMapIds = effectivePoolMapIds(store)
  const poolMaps = knownMapIdsToMaps(store, poolMapIds)
  // Ladder and preset pools show every map, vetoed ones included, so a veto can be undone in place.
  const vetoes = new Set(setup.vetoMapIds ?? [])
  const displayedPoolMaps = knownMapIdsToMaps(store, fullPoolMapIds(store))
  const activeVetoCount = displayedPoolMaps.length - poolMaps.length
  const toggleVeto = (mapId: SbMapId) => {
    updatePracticeStore(draft => {
      const current = draft.matchmaking.vetoMapIds ?? []
      draft.matchmaking.vetoMapIds = current.includes(mapId)
        ? current.filter(id => id !== mapId)
        : [...current, mapId]
    })
  }
  const readiness = computePoolReadiness({
    lineup: setup.lineup,
    bots,
    poolMapIds,
    knownMaps: store.knownMaps,
    installedMapHashes,
  })

  const loadedPreset = store.opponentPresets.find(p => p.id === setup.lineupPresetId)
  const unsavedLineup = !!loadedPreset && !lineupMatchesPreset(setup.lineup, loadedPreset)

  const problems = problemLines(readiness.entries, t)
  const notInstalled = readiness.entries.filter(
    e => e.bot?.readiness.state === 'notInstalled' && e.bot.readiness.canDownload,
  )
  const singleDownload = notInstalled.length === 1 ? notInstalled[0].bot : undefined

  const ladderChipLabel = ladderPool
    ? t('practice.setup.ladderPool', 'Current 1v1 ladder pool')
    : t('practice.setup.ladderPoolUnavailable', '1v1 ladder pool')

  const selectedPresetId = setup.mapPool.kind === 'preset' ? setup.mapPool.presetId : undefined
  const selectedPreset = selectedPresetId
    ? store.mapPoolPresets.find(p => p.id === selectedPresetId)
    : undefined
  // An edit only shows while its pool is selected; it waits around otherwise, so switching pools
  // and back doesn't lose it.
  const presetEdit =
    selectedPreset && setup.presetEdit?.presetId === selectedPreset.id
      ? setup.presetEdit
      : undefined

  const poolHelper = (() => {
    if (presetEdit && selectedPreset) {
      return t('practice.setup.editingPoolHelper', {
        defaultValue: 'Editing {{name}}. Save to keep your changes.',
        name: selectedPreset.name,
      })
    }
    if (setup.mapPool.kind === 'custom') {
      return t('practice.setup.customPoolHelper', 'Pick the maps you want to practice on.')
    }
    if (setup.mapPool.kind === 'preset') {
      return t(
        'practice.setup.presetPoolHelper',
        'A pool you saved. It works offline once its maps are downloaded.',
      )
    }
    if (!ladderPool) {
      return t(
        'practice.setup.ladderPoolMissing',
        "The ladder pool hasn't been downloaded yet. Connect once to fetch it, or pick your own maps.",
      )
    }
    return ladderPool.fromCache
      ? t('practice.setup.ladderPoolCached', {
          defaultValue: 'The last downloaded pool · {{date}}',
          date: formatPoolDate(ladderPool.startDate),
        })
      : t('practice.setup.ladderPoolCurrent', {
          defaultValue: 'Follows the current 1v1 pool · updated {{date}}',
          date: formatPoolDate(ladderPool.startDate),
        })
  })()

  const toggleCustomMap = (mapId: SbMapId) => {
    updatePracticeStore(draft => {
      draft.matchmaking.customMapIds = draft.matchmaking.customMapIds.includes(mapId)
        ? draft.matchmaking.customMapIds.filter(id => id !== mapId)
        : [...draft.matchmaking.customMapIds, mapId]
    })
  }

  let poolBody: React.ReactNode
  if (presetEdit) {
    poolBody = <MapPoolEditor mapIds={presetEdit.mapIds} onToggle={toggleMapPoolPresetEditMap} />
  } else if (setup.mapPool.kind === 'custom') {
    poolBody = <MapPoolEditor mapIds={setup.customMapIds} onToggle={toggleCustomMap} />
  } else {
    poolBody = (
      <MapPoolGrid
        maps={displayedPoolMaps}
        vetoedMapIds={vetoes}
        onToggleVeto={toggleVeto}
        canVetoMore={poolMapIds.length > 1}
      />
    )
  }

  let poolHeaderActions: React.ReactNode
  if (presetEdit) {
    poolHeaderActions = (
      <>
        <TextButton
          label={t('common.actions.cancel', 'Cancel')}
          onClick={cancelMapPoolPresetEdit}
        />
        <TextButton
          label={t('common.actions.save', 'Save')}
          iconStart={<MaterialIcon icon='save' />}
          disabled={presetEdit.mapIds.length === 0}
          onClick={saveMapPoolPresetEdit}
        />
        <TextButton
          label={t('practice.setup.saveAs', 'Save as')}
          iconStart={<MaterialIcon icon='save_as' />}
          disabled={presetEdit.mapIds.length === 0}
          onClick={() =>
            openPresetNameDialog(
              t('practice.setup.saveMapPoolAs', 'Save map pool as'),
              selectedPreset?.name,
              name => {
                // The edit becomes a new pool; the one it started from is left as it was.
                saveMapPoolPreset(name, presetEdit.mapIds)
                cancelMapPoolPresetEdit()
              },
            )
          }
        />
      </>
    )
  } else if (selectedPreset) {
    poolHeaderActions = (
      <>
        <TextButton
          label={t('practice.setup.editPoolMaps', 'Edit maps')}
          iconStart={<MaterialIcon icon='edit' />}
          onClick={() => beginMapPoolPresetEdit(selectedPreset)}
        />
        <IconButton
          ref={poolMenuRef}
          icon={<MaterialIcon icon='more_vert' />}
          ariaLabel={t('practice.setup.poolActions', 'More pool actions')}
          ariaHasPopup='menu'
          ariaExpanded={poolMenuOpen}
          onClick={openPoolMenu}
        />
        <Popover
          open={poolMenuOpen}
          onDismiss={closePoolMenu}
          anchorX={poolMenuX ?? 0}
          anchorY={poolMenuY ?? 0}
          originX='right'
          originY='top'>
          <MenuList dense={true}>
            <MenuItem
              text={t('practice.setup.renamePool', 'Rename pool')}
              onClick={() => {
                closePoolMenu()
                openPresetNameDialog(
                  t('practice.setup.renamePool', 'Rename pool'),
                  selectedPreset.name,
                  name => renameMapPoolPreset(selectedPreset.id, name),
                )
              }}
            />
            <MenuItem
              text={t('practice.setup.deletePool', 'Delete pool')}
              onClick={() => {
                closePoolMenu()
                deleteMapPoolPreset(selectedPreset.id)
              }}
            />
          </MenuList>
        </Popover>
      </>
    )
  } else {
    poolHeaderActions = (
      <TextButton
        label={t('practice.setup.saveAsPreset', 'Save as preset')}
        iconStart={<MaterialIcon icon='bookmark_add' />}
        disabled={poolMapIds.length === 0}
        onClick={() =>
          openPresetNameDialog(t('practice.setup.saveMapPool', 'Save map pool'), undefined, name =>
            saveMapPoolPreset(name, poolMapIds),
          )
        }
      />
    )
  }
  const vetoHelper =
    activeVetoCount > 0
      ? t('practice.setup.vetoCount', {
          defaultValue: '{{count}} of {{total}} maps in play',
          count: poolMapIds.length,
          total: displayedPoolMaps.length,
        })
      : undefined

  const removeFromLineup = (key: BotKey) => {
    updatePracticeStore(draft => {
      draft.matchmaking.lineup = draft.matchmaking.lineup.filter(b => b.key !== key)
    })
  }

  const saveLineup = () => {
    if (loadedPreset) {
      updateLineupPreset(loadedPreset.id, setup.lineup)
    } else {
      openPresetNameDialog(t('practice.setup.saveLineup', 'Save lineup'), undefined, name =>
        saveLineupAsPreset(name, setup.lineup),
      )
    }
  }

  return (
    <PracticePageColumn>
      <Header>
        <TextButton
          label={t('common.actions.back', 'Back')}
          iconStart={<MaterialIcon icon='arrow_back' />}
          onClick={() => push('/play/practice')}
        />
        <PageTitle>{t('practice.setup.title', 'Practice setup')}</PageTitle>
        <HeaderSpacer />
        <TextButton
          label={t('practice.setup.playSpecific', 'Play a specific bot instead')}
          onClick={() => push('/play/practice/game')}
        />
      </Header>

      <Columns>
        <MainColumn>
          <Card>
            <CardHeader>
              <CardTitle>{t('practice.setup.mapPool', 'Map pool')}</CardTitle>
              <HeaderSpacer />
              {poolHeaderActions}
            </CardHeader>

            <ChipRow>
              <FilterChip
                label={ladderChipLabel}
                selected={setup.mapPool.kind === 'ladder'}
                onClick={() =>
                  updatePracticeStore(draft => {
                    draft.matchmaking.mapPool = {
                      kind: 'ladder',
                      matchmakingType: MatchmakingType.Match1v1,
                    }
                  })
                }
              />
              {store.mapPoolPresets.map(preset => (
                <FilterChip
                  key={preset.id}
                  label={preset.name}
                  selected={setup.mapPool.kind === 'preset' && setup.mapPool.presetId === preset.id}
                  icon={<MaterialIcon icon='bookmark' size={18} />}
                  onClick={() =>
                    updatePracticeStore(draft => {
                      draft.matchmaking.mapPool = { kind: 'preset', presetId: preset.id }
                    })
                  }
                />
              ))}
              <FilterChip
                label={t('practice.setup.customPool', 'Custom…')}
                selected={setup.mapPool.kind === 'custom'}
                icon={<MaterialIcon icon='add' size={18} />}
                onClick={() =>
                  updatePracticeStore(draft => {
                    draft.matchmaking.mapPool = { kind: 'custom' }
                  })
                }
              />
            </ChipRow>

            <HelperText>{vetoHelper ? `${poolHelper} · ${vetoHelper}` : poolHelper}</HelperText>

            {poolBody}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('practice.setup.opponents', 'Opponents')}</CardTitle>
              <FilterChip
                label={loadedPreset?.name ?? t('practice.setup.noPreset', 'No preset')}
                icon={<MaterialIcon icon='bookmark' size={18} />}>
                {store.opponentPresets.map(preset => (
                  <MenuItem
                    key={preset.id}
                    text={preset.name}
                    onClick={() => loadLineupPreset(preset.id)}
                  />
                ))}
                <MenuItem
                  text={t('practice.setup.noPreset', 'No preset')}
                  onClick={() =>
                    updatePracticeStore(draft => {
                      draft.matchmaking.lineupPresetId = undefined
                    })
                  }
                />
              </FilterChip>
              {unsavedLineup ? (
                <UnsavedIndicator>
                  <MaterialIcon icon='edit' size={18} />
                  {t('practice.setup.unsavedChanges', 'Unsaved changes')}
                </UnsavedIndicator>
              ) : null}
              <HeaderSpacer />
              <TextButton
                label={t('common.actions.save', 'Save')}
                iconStart={<MaterialIcon icon='save' />}
                disabled={setup.lineup.length === 0}
                onClick={saveLineup}
              />
              <TextButton
                label={t('practice.setup.saveAs', 'Save as')}
                iconStart={<MaterialIcon icon='save_as' />}
                disabled={setup.lineup.length === 0}
                onClick={() =>
                  openPresetNameDialog(
                    t('practice.setup.saveLineupAs', 'Save lineup as'),
                    loadedPreset?.name,
                    name => saveLineupAsPreset(name, setup.lineup),
                  )
                }
              />
              <IconButton
                ref={lineupMenuRef}
                icon={<MaterialIcon icon='more_vert' />}
                ariaLabel={t('practice.setup.lineupActions', 'More lineup actions')}
                ariaHasPopup='menu'
                ariaExpanded={lineupMenuOpen}
                disabled={!loadedPreset}
                onClick={openLineupMenu}
              />
              <Popover
                open={lineupMenuOpen}
                onDismiss={closeLineupMenu}
                anchorX={lineupMenuX ?? 0}
                anchorY={lineupMenuY ?? 0}
                originX='right'
                originY='top'>
                <MenuList dense={true}>
                  <MenuItem
                    text={t('practice.setup.renameLineup', 'Rename lineup')}
                    onClick={() => {
                      closeLineupMenu()
                      if (loadedPreset) {
                        openPresetNameDialog(
                          t('practice.setup.renameLineup', 'Rename lineup'),
                          loadedPreset.name,
                          name => renameOpponentPreset(loadedPreset.id, name),
                        )
                      }
                    }}
                  />
                  <MenuItem
                    text={t('practice.setup.deleteLineup', 'Delete lineup')}
                    onClick={() => {
                      closeLineupMenu()
                      if (loadedPreset) {
                        deleteOpponentPreset(loadedPreset.id)
                      }
                    }}
                  />
                </MenuList>
              </Popover>
            </CardHeader>

            <LineupRows>
              {readiness.entries.map(entry => (
                <LineupEntryRow
                  key={entry.ref.key}
                  entry={entry}
                  onRemove={() => removeFromLineup(entry.ref.key)}
                />
              ))}
            </LineupRows>

            <LineupFooter>
              <OutlinedButton
                label={t('practice.setup.addOpponents', 'Add opponents')}
                iconStart={<MaterialIcon icon='add' />}
                onClick={() => push('/play/practice/opponents')}
              />
            </LineupFooter>
          </Card>
        </MainColumn>

        <Aside>
          <ReadinessCard>
            <EyebrowLabel>{t('practice.setup.readyToPlay', 'Ready to play')}</EyebrowLabel>
            <ReadinessLines>
              <ReadinessLine>
                <MaterialIcon icon='map' size={20} />
                <span>
                  {t('practice.setup.mapCount', {
                    defaultValue_one: '{{count}} map',
                    defaultValue_other: '{{count}} maps',
                    count: readiness.installedMaps.length,
                  })}
                </span>
              </ReadinessLine>
              <ReadinessLine>
                <MaterialIcon icon='smart_toy' size={20} />
                <span>
                  {t('practice.setup.opponentCount', {
                    defaultValue: '{{playable}} of {{total}} opponents playable',
                    playable: readiness.playableEntries.length,
                    total: readiness.entries.length,
                  })}
                </span>
              </ReadinessLine>
            </ReadinessLines>

            {problems.length || readiness.missingMaps.length ? (
              <WarningBox>
                <MaterialIcon icon='warning' size={20} />
                <WarningList>
                  {problems.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                  {readiness.missingMaps.length ? (
                    <li>
                      {t('practice.setup.mapsNeedDownload', {
                        defaultValue_one: '{{count}} map still needs downloading.',
                        defaultValue_other: '{{count}} maps still need downloading.',
                        count: readiness.missingMaps.length,
                      })}
                    </li>
                  ) : null}
                </WarningList>
              </WarningBox>
            ) : null}

            <StartButton
              label={t('practice.startPractice', 'Start practice')}
              iconStart={<MaterialIcon icon='play_arrow' />}
              onClick={startPracticeMatchmaking}
            />
            {singleDownload ? (
              <DownloadButton
                label={t('practice.setup.downloadFirst', {
                  defaultValue: 'Download {{name}} first ({{size}})',
                  name: singleDownload.name,
                  size: formatMegabytes(
                    singleDownload.readiness.state === 'notInstalled'
                      ? singleDownload.readiness.sizeBytes
                      : 0,
                    t,
                  ),
                })}
                iconStart={<MaterialIcon icon='download' />}
                onClick={() => {
                  installBot(singleDownload).catch(err => {
                    logger.error(`Failed to install a practice bot: ${err?.stack ?? err}`)
                  })
                }}
              />
            ) : null}
            {readiness.missingMaps.length ? (
              <DownloadButton
                label={t('practice.setup.downloadMaps', 'Download the missing maps')}
                iconStart={<MaterialIcon icon='download' />}
                onClick={() => {
                  ensureMapsDownloaded(readiness.missingMaps).catch(err => {
                    logger.error(`Failed to download practice maps: ${err?.stack ?? err}`)
                  })
                }}
              />
            ) : null}

            <DrawNote>
              {t(
                'practice.setup.drawNote',
                "Which opponent is drawn each game is up to the lineup. Odds aren't guaranteed equal.",
              )}
            </DrawNote>
          </ReadinessCard>
        </Aside>
      </Columns>
    </PracticePageColumn>
  )
}

/** The action column of a lineup row: download it, show why it can't play, or nothing to do. */
function LineupAction({ entry }: { entry: LineupEntryStatus }) {
  const { t } = useTranslation()
  const bot = entry.bot

  if (!bot) {
    return <LineupStatusText>{t('practice.setup.notInstalled', 'Not installed')}</LineupStatusText>
  }
  if (bot.readiness.state === 'notInstalled' && bot.readiness.canDownload) {
    return (
      <TextButton
        label={t('common.actions.download', 'Download')}
        iconStart={<MaterialIcon icon='download' />}
        onClick={() => {
          installBot(bot).catch(err => {
            logger.error(`Failed to install a practice bot: ${err?.stack ?? err}`)
          })
        }}
      />
    )
  }
  return <ReadinessBadge bot={bot} />
}

function LineupEntryRow({ entry, onRemove }: { entry: LineupEntryStatus; onRemove: () => void }) {
  const { t } = useTranslation()
  const bot = entry.bot
  const needsAttention = !entry.playable
  const statusText = lineupStatusText(entry, t)
  const removeLabel = t('practice.setup.removeFromLineup', {
    defaultValue: 'Remove {{name}} from the lineup',
    name: entry.ref.name,
  })

  return (
    <LineupRow $needsAttention={needsAttention}>
      <BotAvatar races={bot?.races ?? []} size={40} />
      <div>
        <LineupName>
          {entry.ref.name}
          <LineupVersion>{entry.ref.version}</LineupVersion>
        </LineupName>
        {statusText ? (
          <LineupStatus>
            <LineupStatusText>{statusText}</LineupStatusText>
          </LineupStatus>
        ) : null}
      </div>
      <LineupAction entry={entry} />
      <Tooltip text={removeLabel} position='left'>
        <IconButton
          icon={<MaterialIcon icon='close' size={22} />}
          ariaLabel={removeLabel}
          onClick={onRemove}
        />
      </Tooltip>
    </LineupRow>
  )
}
