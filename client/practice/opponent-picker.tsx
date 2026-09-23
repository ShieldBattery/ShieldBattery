import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ALL_BOT_RACE_NAMES, BotRaceName, botRaceToRaceChar } from '../../common/bots/bot-catalog'
import { BotView, isBotOnThisPc } from '../../common/bots/bot-view'
import { customGameBotCapacity, PracticeBotRef } from '../../common/bots/practice'
import { botPeakRating } from '../../common/bots/practice-logic'
import { raceCharToLabel } from '../../common/races'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { FilterChip } from '../material/filter-chip'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyMedium,
  bodySmall,
  headlineMedium,
  labelSmall,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { refreshCatalog } from './bot-actions'
import { playStyleTagLabels, RaceIconList, ReadinessBadge } from './bot-badges'
import { BotCard, BotCardProps } from './bot-card'
import { botLibraryAtom, botViewsAtom, practiceStoreAtom } from './practice-atoms'
import { PracticePageColumn } from './practice-layout'
import { lineupMatchesPreset, saveLineupAsPreset, updateLineupPreset } from './practice-presets'
import { updatePracticeStore } from './practice-store'
import { Recommendations } from './recommendations'

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const HeaderText = styled.div`
  display: flex;
  flex-direction: column;
`

const HeaderTitle = styled.h1`
  ${headlineMedium};
  margin: 0;
`

const HeaderSubtitle = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const HeaderEmphasis = styled.span`
  color: var(--theme-on-surface);
  font-weight: 500;
`

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
`

const SearchField = styled(TextField)`
  width: 280px;
  flex-shrink: 0;
`

const ChipGroup = styled.div`
  display: flex;
  gap: 8px;
`

const ToolbarSpacer = styled.div`
  flex-grow: 1;
`

const SortSelect = styled(Select)`
  width: 200px;
  flex-shrink: 0;
`

const Body = styled.div<{ $hasPanel: boolean }>`
  display: grid;
  /* The lineup panel gives up width before the cards do on narrow windows. */
  grid-template-columns: ${props =>
    props.$hasPanel ? 'minmax(0, 1fr) clamp(256px, 30%, 320px)' : 'minmax(0, 1fr)'};
  gap: 24px;
  align-items: start;
`

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const SectionLabel = styled.div`
  ${labelSmall};
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const SectionRule = styled.span`
  flex-grow: 1;
  height: 1px;
  background-color: var(--theme-outline-variant);
`

const SectionNote = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const CardGrid = styled.div`
  display: grid;
  /* Four across at the full page width, fewer as the window or the lineup panel take space. */
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
`

const LocalBuildTile = styled.button`
  ${buttonReset};

  min-height: 120px;
  padding: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;

  border: 1px dashed var(--theme-outline);
  border-radius: 8px;
  color: var(--color-blue80);

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const LocalBuildLabel = styled.div`
  ${titleSmall};
`

const LocalBuildHint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

const EmptyState = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 24px;
  border-radius: 4px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
`

const EmptyTitle = styled.div`
  ${titleSmall};
`

const EmptyText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  max-width: 560px;
`

const EmptyActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const CatalogError = styled.div`
  ${bodySmall};

  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--theme-on-surface-variant);
`

const SidePanel = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const PanelCard = styled.section`
  ${containerStyles(ContainerLevel.High)};

  padding: 16px;
  border-radius: 4px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const PanelTitle = styled.div`
  ${titleSmall};
  flex-grow: 1;
  min-width: 0;
`

/**
 * The "unsaved" marker doubles as the save action: hovering it reveals a save prompt without the
 * header needing another button.
 */
const PanelUnsaved = styled.button`
  ${buttonReset};
  ${labelSmall};

  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  margin: -6px -8px;
  border-radius: 6px;

  color: var(--theme-on-surface-variant);
  cursor: pointer;

  & > [data-hover] {
    display: none;
  }

  &:hover,
  &:focus-visible {
    color: var(--theme-amber);
    background-color: rgb(from var(--theme-amber) r g b / 0.08);

    & > [data-rest] {
      display: none;
    }
    & > [data-hover] {
      display: inline;
    }
  }

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: -2px;
  }
`

const PanelRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const PanelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 4px 0 8px;
  border-radius: 6px;
`

const PanelRowName = styled.div`
  ${bodyMedium};
  ${singleLine};
  flex-grow: 1;
  min-width: 0;
`

const PanelRowVersion = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const PanelEmpty = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const PanelPrimaryButton = styled(FilledButton)`
  width: 100%;
`

export type OpponentPickerMode = 'lineup' | 'library' | 'slot'

/** Where Back returns to, which is always the screen that sends the user here. */
const BACK_TARGETS: Record<OpponentPickerMode, string> = {
  lineup: '/play/practice/setup',
  library: '/play/practice',
  slot: '/play/practice/game',
}

function toBotRef(bot: BotView): PracticeBotRef {
  return { key: bot.key, name: bot.name, version: bot.version }
}

function matchesSearch(bot: BotView, search: string, t: TFunction): boolean {
  if (!search) {
    return true
  }
  const needle = search.toLowerCase()
  return (
    bot.name.toLowerCase().includes(needle) ||
    bot.authors.some(a => a.name.toLowerCase().includes(needle)) ||
    playStyleTagLabels(bot, t).some(tag => tag.toLowerCase().includes(needle))
  )
}

type SortOrder = 'name' | 'strength'

function sortBots(bots: ReadonlyArray<BotView>, order: SortOrder): BotView[] {
  const byName = (a: BotView, b: BotView) => a.name.localeCompare(b.name)
  if (order === 'strength') {
    return [...bots].sort(
      (a, b) => (botPeakRating(b) ?? -1) - (botPeakRating(a) ?? -1) || byName(a, b),
    )
  }
  return [...bots].sort(byName)
}

export interface OpponentPickerProps {
  mode: OpponentPickerMode
}

/**
 * Browses the bot library. The same screen serves three jobs: building the practice lineup, plain
 * library management, and filling a custom game slot; only the cards' primary action and the side
 * panel differ.
 */
export function OpponentPicker({ mode }: OpponentPickerProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const bots = useAtomValue(botViewsAtom)
  const library = useAtomValue(botLibraryAtom)
  const store = useAtomValue(practiceStoreAtom)

  const [search, setSearch] = useState('')
  const [raceFilter, setRaceFilter] = useState<ReadonlySet<BotRaceName>>(new Set())
  const [installedOnly, setInstalledOnly] = useState(false)
  const [showRecommended, setShowRecommended] = useState(true)
  const [sortOrder, setSortOrder] = useState<SortOrder>('name')

  const lineup = store.matchmaking.lineup
  const lineupKeys = new Set(lineup.map(b => b.key))
  const loadedPreset = store.opponentPresets.find(p => p.id === store.matchmaking.lineupPresetId)
  // A lineup with no preset behind it is unsaved too, so it offers the same save action.
  const presetDiffers =
    lineup.length > 0 && (!loadedPreset || !lineupMatchesPreset(lineup, loadedPreset))
  const saveLineup = () => {
    if (loadedPreset) {
      updateLineupPreset(loadedPreset.id, lineup)
      return
    }
    dispatch(
      openDialog({
        type: DialogType.PracticePresetName,
        initData: {
          title: t('practice.picker.saveLineup', 'Save lineup'),
          onSubmit: name => saveLineupAsPreset(name, lineup),
        },
      }),
    )
  }

  const backTarget = BACK_TARGETS[mode]

  const visible = bots
    .filter(bot => matchesSearch(bot, search, t))
    .filter(bot => raceFilter.size === 0 || bot.races.some(r => raceFilter.has(r)))
    .filter(bot => !installedOnly || isBotOnThisPc(bot))
  const sorted = sortBots(visible, sortOrder)

  const toggleLineup = (bot: BotView) => {
    updatePracticeStore(draft => {
      const index = draft.matchmaking.lineup.findIndex(b => b.key === bot.key)
      if (index >= 0) {
        draft.matchmaking.lineup.splice(index, 1)
      } else {
        draft.matchmaking.lineup.push(toBotRef(bot))
      }
    })
  }

  const selectForSlot = (bot: BotView) => {
    const customGame = store.customGame
    const map = customGame.mapId ? store.knownMaps[customGame.mapId] : undefined
    const capacity = customGameBotCapacity(customGame, map?.mapData.slots)
    if (customGame.slots.length >= capacity) {
      dispatch(
        openSimpleDialog(
          t('practice.picker.slotsFullTitle', 'No more slots'),
          map
            ? t('practice.picker.slotsFullText', {
                defaultValue:
                  '{{map}} has room for {{count}} bots. Remove one, or pick a bigger map.',
                map: map.name,
                count: capacity,
              })
            : t('practice.picker.slotsFullNoMapText', {
                defaultValue: 'A game can have at most {{count}} bots.',
                count: capacity,
              }),
        ),
      )
      return
    }
    updatePracticeStore(draft => {
      draft.customGame.slots.push({ bot: toBotRef(bot), race: bot.races[0] })
    })
    push('/play/practice/game')
  }

  const openDetails = (bot: BotView) => {
    let action: { label: string; onAction: () => void } | undefined
    if (mode === 'lineup') {
      action = {
        label: t('practice.picker.addToLineup', 'Add to lineup'),
        onAction: () => toggleLineup(bot),
      }
    } else if (mode === 'slot') {
      action = {
        label: t('practice.picker.useInGame', 'Use in game'),
        onAction: () => selectForSlot(bot),
      }
    }
    dispatch(openDialog({ type: DialogType.BotDetails, initData: { botKey: bot.key, action } }))
  }

  const primaryActionFor = (bot: BotView): BotCardProps['primaryAction'] => {
    switch (mode) {
      case 'lineup':
        return { kind: 'add', added: lineupKeys.has(bot.key), onToggle: () => toggleLineup(bot) }
      case 'library':
        return { kind: 'install', installed: isBotOnThisPc(bot) }
      case 'slot':
        return { kind: 'select', onSelect: () => selectForSlot(bot) }
      default:
        return mode satisfies never
    }
  }

  const renderCard = (bot: BotView, note?: string) => (
    <BotCard
      bot={bot}
      highlighted={mode === 'lineup' && lineupKeys.has(bot.key)}
      primaryAction={primaryActionFor(bot)}
      onDetails={() => openDetails(bot)}
      recommendationNote={note}
    />
  )

  const openLocalBuild = () => {
    dispatch(openDialog({ type: DialogType.LocalBuildBot, initData: {} }))
  }

  const onRefreshCatalog = () => {
    refreshCatalog().catch(err => {
      logger.error(`Failed to refresh the bot catalog: ${err?.stack ?? err}`)
    })
  }

  let pageTitle = t('practice.picker.bots', 'Bots')
  if (mode === 'lineup') {
    pageTitle = t('practice.picker.addOpponents', 'Add opponents')
  } else if (mode === 'slot') {
    pageTitle = t('practice.picker.chooseOpponent', 'Choose an opponent')
  }
  const hasNothing = bots.length === 0 && !library?.catalog
  const refreshing = !!library?.catalogStatus.refreshing
  const refreshLabel = refreshing
    ? t('practice.picker.refreshingCatalog', 'Refreshing the catalog…')
    : t('practice.picker.refreshCatalog', 'Refresh catalog')

  return (
    <PracticePageColumn>
      <Header>
        <TextButton
          label={t('common.actions.back', 'Back')}
          iconStart={<MaterialIcon icon='arrow_back' />}
          onClick={() => push(backTarget)}
        />
        <HeaderText>
          <HeaderTitle>{pageTitle}</HeaderTitle>
          <HeaderSubtitle>
            {mode === 'lineup' ? (
              <>
                {t('practice.picker.toLineup', 'to lineup')}
                {loadedPreset ? (
                  <>
                    {' '}
                    <HeaderEmphasis>{loadedPreset.name}</HeaderEmphasis>
                  </>
                ) : null}
                {' · '}
                {t('practice.picker.botCount', {
                  defaultValue_one: '{{count}} bot',
                  defaultValue_other: '{{count}} bots',
                  count: lineup.length,
                })}
              </>
            ) : (
              t('practice.picker.librarySubtitle', 'Installed on this PC and available to download')
            )}
          </HeaderSubtitle>
        </HeaderText>
      </Header>

      <Toolbar>
        <SearchField
          value={search}
          label={t('practice.picker.search', 'Search bots')}
          dense={true}
          allowErrors={false}
          leadingIcons={[<MaterialIcon icon='search' key='search' />]}
          onChange={event => setSearch(event.target.value)}
        />
        <ChipGroup>
          {ALL_BOT_RACE_NAMES.map(race => (
            <FilterChip
              key={race}
              label={raceCharToLabel(botRaceToRaceChar(race), t)}
              selected={raceFilter.has(race)}
              checkmark={false}
              onClick={() => {
                const next = new Set(raceFilter)
                if (next.has(race)) {
                  next.delete(race)
                } else {
                  next.add(race)
                }
                setRaceFilter(next)
              }}
            />
          ))}
        </ChipGroup>
        <FilterChip
          label={t('practice.picker.installed', 'Installed')}
          selected={installedOnly}
          icon={<MaterialIcon icon='download_done' size={18} />}
          onClick={() => setInstalledOnly(!installedOnly)}
        />
        <FilterChip
          label={t('practice.picker.recommended', 'Recommended')}
          selected={showRecommended}
          icon={<MaterialIcon icon='star' size={18} />}
          onClick={() => setShowRecommended(!showRecommended)}
        />
        <ToolbarSpacer />
        <SortSelect
          dense={true}
          allowErrors={false}
          value={sortOrder}
          onChange={(value: SortOrder) => setSortOrder(value)}>
          <SelectOption value='name' text={t('practice.picker.sortByName', 'Sort by name')} />
          <SelectOption
            value='strength'
            text={t('practice.picker.sortByStrength', 'Sort by strength')}
          />
        </SortSelect>
        <Tooltip text={refreshLabel} position='bottom'>
          <IconButton
            icon={<MaterialIcon icon='refresh' />}
            ariaLabel={refreshLabel}
            disabled={refreshing}
            onClick={onRefreshCatalog}
          />
        </Tooltip>
      </Toolbar>

      {library?.catalogStatus.lastError ? (
        <CatalogError>
          <MaterialIcon icon='cloud_off' size={18} />
          <span>
            {t('practice.picker.catalogError', {
              defaultValue: "Couldn't refresh the bot catalog: {{error}}",
              error: library.catalogStatus.lastError,
            })}
          </span>
          <TextButton label={t('common.actions.retry', 'Retry')} onClick={onRefreshCatalog} />
        </CatalogError>
      ) : null}

      <Body $hasPanel={mode === 'lineup'}>
        <Sections>
          {hasNothing ? (
            <EmptyState>
              <EmptyTitle>{t('practice.picker.emptyTitle', 'No bots yet')}</EmptyTitle>
              <EmptyText>
                {t(
                  'practice.picker.emptyText',
                  'Browsing the collection needs a connection to ShieldBattery. You can also point the app at a bot you built yourself and play it offline.',
                )}
              </EmptyText>
              <EmptyActions>
                <OutlinedButton
                  label={t('practice.picker.useLocalBuild', 'Use a local build')}
                  iconStart={<MaterialIcon icon='folder_open' />}
                  onClick={openLocalBuild}
                />
                <TextButton
                  label={t('practice.picker.refreshCatalog', 'Refresh catalog')}
                  iconStart={<MaterialIcon icon='refresh' />}
                  onClick={onRefreshCatalog}
                />
              </EmptyActions>
            </EmptyState>
          ) : (
            <>
              {showRecommended ? (
                <Recommendations bots={sorted} renderCard={(bot, note) => renderCard(bot, note)} />
              ) : null}

              <Section>
                <SectionHeader>
                  <SectionLabel>{t('practice.picker.allBots', 'All bots')}</SectionLabel>
                  <SectionRule />
                  <SectionNote>
                    {t('practice.picker.availableCount', {
                      defaultValue_one: '{{count}} available',
                      defaultValue_other: '{{count}} available',
                      count: sorted.length,
                    })}
                  </SectionNote>
                </SectionHeader>
                <CardGrid>
                  {sorted.map(bot => (
                    <React.Fragment key={bot.key}>{renderCard(bot)}</React.Fragment>
                  ))}
                  <LocalBuildTile type='button' onClick={openLocalBuild}>
                    <MaterialIcon icon='folder_open' size={24} />
                    <LocalBuildLabel>
                      {t('practice.picker.useLocalBuild', 'Use a local build')}
                    </LocalBuildLabel>
                    <LocalBuildHint>
                      {t('practice.picker.localBuildHint', 'Point the app at a bot you built')}
                    </LocalBuildHint>
                  </LocalBuildTile>
                </CardGrid>
              </Section>
            </>
          )}
        </Sections>

        {mode === 'lineup' ? (
          <SidePanel>
            <PanelCard>
              <PanelHeader>
                <MaterialIcon icon='bookmark' size={20} />
                <PanelTitle>
                  {loadedPreset?.name ?? t('practice.picker.unsavedLineup', 'Unsaved lineup')}
                </PanelTitle>
                {presetDiffers ? (
                  <PanelUnsaved
                    type='button'
                    aria-label={t('practice.picker.saveLineup', 'Save lineup')}
                    onClick={saveLineup}>
                    <MaterialIcon icon='edit' size={17} />
                    <span data-rest=''>{t('practice.picker.unsaved', 'Unsaved')}</span>
                    <span data-hover=''>{t('practice.picker.save', 'Save')}</span>
                  </PanelUnsaved>
                ) : null}
              </PanelHeader>
              {lineup.length ? (
                <PanelRows>
                  {lineup.map(entry => {
                    const bot = bots.find(b => b.key === entry.key)
                    return (
                      <PanelRow key={entry.key}>
                        <PanelRowName>
                          {entry.name}
                          <PanelRowVersion>{entry.version}</PanelRowVersion>
                        </PanelRowName>
                        {bot ? <RaceIconList races={bot.races} size={14} /> : null}
                        {bot ? <ReadinessBadge bot={bot} size='small' /> : null}
                        <IconButton
                          icon={<MaterialIcon icon='close' size={18} />}
                          ariaLabel={t('practice.picker.removeFromLineup', {
                            defaultValue: 'Remove {{name}} from the lineup',
                            name: entry.name,
                          })}
                          onClick={() => {
                            updatePracticeStore(draft => {
                              draft.matchmaking.lineup = draft.matchmaking.lineup.filter(
                                b => b.key !== entry.key,
                              )
                            })
                          }}
                        />
                      </PanelRow>
                    )
                  })}
                </PanelRows>
              ) : (
                <PanelEmpty>
                  {t('practice.picker.lineupEmpty', 'Add a few bots to practice against.')}
                </PanelEmpty>
              )}
              <PanelPrimaryButton
                label={t('practice.picker.backToSetup', 'Back to practice setup')}
                iconStart={<MaterialIcon icon='arrow_back' />}
                onClick={() => push('/play/practice/setup')}
              />
            </PanelCard>
          </SidePanel>
        ) : null}
      </Body>
    </PracticePageColumn>
  )
}
