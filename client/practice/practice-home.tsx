import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BotView } from '../../common/bots/bot-view'
import { computePoolReadiness, localDayKey, pickDailyItem } from '../../common/bots/practice-logic'
import { MapInfoJson } from '../../common/maps'
import { RaceChar } from '../../common/races'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { RacePicker, RacePickerSize } from '../lobbies/race-picker'
import logger from '../logging/logger'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { CheckBox } from '../material/check-box'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  displayMedium,
  labelLarge,
  labelMedium,
  labelSmall,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { updateBot } from './bot-actions'
import { BotAvatar } from './bot-avatar'
import { ReadinessBadge } from './bot-badges'
import { effectivePoolMapIds, useLadderMapPool } from './ladder-pool'
import { MapPoolGrid } from './map-pool-editor'
import {
  botLibraryAtom,
  botViewsAtom,
  installedMapHashesAtom,
  practiceStoreAtom,
} from './practice-atoms'
import { startPracticeMatchmaking } from './practice-launch'
import { PracticePageColumn } from './practice-root'
import { knownMapIdsToMaps, updatePracticeStore } from './practice-store'

/** Opponent chips shown on the home summary before the rest collapse into a "+N" chip. */
const MAX_OPPONENT_CHIPS = 4

const Hero = styled.section`
  ${containerStyles(ContainerLevel.Low)};

  position: relative;
  height: 320px;
  padding: 32px 32px 28px;
  border-radius: 8px;
  overflow: hidden;
  contain: content;

  display: flex;
  flex-direction: column;
`

const HeroMapImage = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
`

/** Keeps the copy on the left readable over whatever the map looks like there. */
const HeroMapShade = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(
      to right,
      var(--theme-container-low) 28%,
      rgb(from var(--theme-container-low) r g b / 0.8) 58%,
      rgb(from var(--theme-container-low) r g b / 0.35) 100%
    ),
    linear-gradient(to top, rgb(from var(--theme-container-low) r g b / 0.6), transparent 45%);
`

/** Shown when no pool map has an image to draw, so the page renders the same offline. */
const HeroFallback = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    to right,
    var(--theme-container-low) 40%,
    rgb(from var(--color-blue30) r g b / 0.35)
  );
`

/** A single oversized glyph stands in for hero art when there is no map to show. */
const HeroMark = styled.div`
  position: absolute;
  top: -80px;
  right: -40px;
  opacity: 0.06;
  color: var(--theme-on-surface);
  pointer-events: none;
`

function hasImage(map: MapInfoJson): boolean {
  return !!(map.image1024Url || map.image512Url)
}

/**
 * The hero's backdrop: today's pick from the maps in play, or a gradient when the pool has no
 * map with an image or the image can't be fetched.
 */
function HeroBackdrop({ map }: { map: MapInfoJson | undefined }) {
  const [failedMapId, setFailedMapId] = useState<string | undefined>()
  if (!map || failedMapId === map.id) {
    return (
      <>
        <HeroFallback />
        <HeroMark>
          <MaterialIcon icon='smart_toy' size={360} />
        </HeroMark>
      </>
    )
  }

  const srcSet = [
    map.image512Url ? `${map.image512Url} 512w` : undefined,
    map.image1024Url ? `${map.image1024Url} 1024w` : undefined,
    map.image2048Url ? `${map.image2048Url} 2048w` : undefined,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <HeroMapImage
        key={map.id}
        src={map.image1024Url ?? map.image512Url}
        srcSet={srcSet}
        sizes='1200px'
        alt=''
        decoding='async'
        onError={() => setFailedMapId(map.id)}
      />
      <HeroMapShade />
    </>
  )
}

const HeroContent = styled.div`
  position: relative;
  height: 100%;

  display: flex;
  flex-direction: column;
`

const Eyebrow = styled.div`
  ${labelMedium};
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const HeroTitle = styled.h1`
  ${displayMedium};
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 1px;
`

const HeroBody = styled.p`
  ${bodyLarge};
  margin: 8px 0 0;
  max-width: 520px;
  color: var(--theme-on-surface-variant);
`

const HeroSpacer = styled.div`
  flex-grow: 1;
`

const HeroActions = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const HeroButton = styled(FilledButton)`
  min-height: 48px;
  min-width: 200px;
`

const HeroSecondaryButton = styled(OutlinedButton)`
  min-height: 48px;
`

const ActionSpacer = styled.div`
  flex-grow: 1;
`

const ReadinessPill = styled.div<{ $ready: boolean }>`
  ${labelMedium};

  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px 0 8px;

  border-radius: 16px;
  background-color: rgb(from var(--color-blue10) r g b / 0.6);
  color: ${props => (props.$ready ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
`

const PillIcon = styled(MaterialIcon)<{ $ready: boolean }>`
  color: ${props => (props.$ready ? 'var(--theme-success)' : 'var(--theme-amber)')};
`

const SummaryCard = styled.section`
  ${containerStyles(ContainerLevel.Low)};

  padding: 20px 24px;
  border-radius: 8px;

  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.15fr) auto;
  gap: 28px;
  align-items: start;
`

const SummaryColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
`

const SummaryHeader = styled.div`
  display: flex;
  align-items: baseline;
  gap: 16px;
`

/**
 * An inline link-sized action that shares the overline's baseline instead of a 40px button. The
 * padding is cancelled out by negative margins, so the hit area is comfortably large while the
 * text stays exactly where the row places it.
 */
const ChangeLink = styled.button`
  ${buttonReset};
  ${labelMedium};

  padding: 10px 8px;
  margin: -10px -8px;
  border-radius: 6px;

  color: var(--theme-amber);
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-amber) r g b / 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: -2px;
  }
`

const SummaryName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const SummaryDetail = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  margin-left: 6px;
`

const OpponentChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const OpponentChip = styled.div<{ $needsAttention: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px 0 4px;

  border-radius: 20px;
  border: 1px solid
    ${props => (props.$needsAttention ? 'var(--theme-amber)' : 'var(--theme-outline-variant)')};
  background-color: rgb(from var(--theme-container) r g b / 0.85);
`

const OpponentChipName = styled.span`
  ${bodyMedium};
  font-weight: 500;
`

const WarningMark = styled.span`
  display: inline-flex;
  color: var(--theme-amber);
`

const HideCheckBox = styled(CheckBox)`
  margin-top: 4px;
`

const SpecificBotRow = styled.button`
  ${buttonReset};
  ${containerStyles(ContainerLevel.Low)};

  height: 72px;
  padding: 0 20px 0 16px;
  border-radius: 8px;

  display: flex;
  align-items: center;
  gap: 16px;
  text-align: left;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const SpecificBotIcon = styled.span`
  width: 40px;
  height: 40px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  background-color: var(--color-grey-blue40);
  color: var(--theme-on-surface-variant);
`

const SpecificBotText = styled.span`
  display: flex;
  flex-direction: column;
`

const SpecificBotHint = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const SpecificBotAction = styled.span`
  ${labelLarge};

  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-blue80);
`

const BotsSection = styled.section`
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

const BotGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
`

const BotRow = styled.div`
  ${containerStyles(ContainerLevel.Normal)};

  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 8px;
  border-radius: 8px;
`

const DetailsIconButton = styled(IconButton)`
  color: var(--theme-on-surface-variant);
`

const BotRowText = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`

const BotRowName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const BotRowVersion = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const BrowseTile = styled.button`
  ${buttonReset};

  height: 56px;

  display: flex;
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

const EmptyState = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 24px;
  border-radius: 8px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
`

const EmptyText = styled.div`
  ${bodyMedium};
  max-width: 620px;
  color: var(--theme-on-surface-variant);
`

const EmptyActions = styled.div`
  display: flex;
  gap: 8px;
`

export function PracticeHome() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const store = useAtomValue(practiceStoreAtom)
  const bots = useAtomValue(botViewsAtom)
  const library = useAtomValue(botLibraryAtom)
  const installedMapHashes = useAtomValue(installedMapHashesAtom)
  const { pool: ladderPool } = useLadderMapPool()

  const setup = store.matchmaking
  const poolMapIds = effectivePoolMapIds(store)
  const poolMaps = knownMapIdsToMaps(store, poolMapIds)
  const readiness = computePoolReadiness({
    lineup: setup.lineup,
    bots,
    poolMapIds,
    knownMaps: store.knownMaps,
    installedMapHashes,
  })

  const ready = readiness.canDraw
  const lineupPreset = store.opponentPresets.find(p => p.id === setup.lineupPresetId)
  const mapPoolSource = setup.mapPool
  const mapPoolPreset =
    mapPoolSource.kind === 'preset'
      ? store.mapPoolPresets.find(p => p.id === mapPoolSource.presetId)
      : undefined

  let poolName = t('practice.home.customPool', 'Your own maps')
  let poolDetail = t('practice.home.mapCount', {
    defaultValue_one: '· {{count}} map',
    defaultValue_other: '· {{count}} maps',
    count: poolMapIds.length,
  })
  if (setup.mapPool.kind === 'ladder') {
    poolName = t('practice.home.ladderPool', 'Current 1v1 ladder pool')
    poolDetail = ladderPool?.fromCache
      ? t('practice.home.lastDownloadedPool', '· the last downloaded pool')
      : t('practice.home.followsCurrentPool', '· follows the current 1v1 pool')
  } else if (setup.mapPool.kind === 'preset') {
    poolName = mapPoolPreset?.name ?? t('practice.home.savedPool', 'Saved pool')
  }

  const nothingToShow = bots.length === 0 && !library?.catalog
  // A long lineup is summarized: the first few opponents, then a count of the rest.
  const shownEntries =
    readiness.entries.length > MAX_OPPONENT_CHIPS
      ? readiness.entries.slice(0, MAX_OPPONENT_CHIPS - 1)
      : readiness.entries
  const hiddenEntries = readiness.entries.slice(shownEntries.length)
  const backdropMap = pickDailyItem(poolMaps.filter(hasImage), localDayKey(new Date()))

  return (
    <PracticePageColumn>
      <Hero>
        <HeroBackdrop map={backdropMap} />
        <HeroContent>
          <Eyebrow>{t('practice.home.eyebrow', 'Play against bots')}</Eyebrow>
          <HeroTitle>{t('practice.activity.title', 'Practice')}</HeroTitle>
          <HeroBody>
            {t(
              'practice.home.blurb',
              'Your own PC, no queue, no ranked MMR change. Works offline once bots and maps are downloaded.',
            )}
          </HeroBody>
          <HeroSpacer />
          <HeroActions>
            <HeroButton
              label={t('practice.startPractice', 'Start practice')}
              iconStart={<MaterialIcon icon='play_arrow' />}
              onClick={startPracticeMatchmaking}
            />
            <HeroSecondaryButton
              label={t('practice.home.editSetup', 'Edit setup')}
              iconStart={<MaterialIcon icon='edit' />}
              onClick={() => push('/play/practice/setup')}
            />
            <ActionSpacer />
            <ReadinessPill $ready={ready}>
              <PillIcon icon={ready ? 'check_circle' : 'warning'} size={18} $ready={ready} />
              {ready
                ? t('practice.home.readySummary', {
                    defaultValue: 'Ready · {{playable}} of {{total}} opponents · {{maps}} maps',
                    playable: readiness.playableEntries.length,
                    total: readiness.entries.length,
                    maps: readiness.installedMaps.length,
                  })
                : t('practice.home.notReadySummary', {
                    defaultValue:
                      'Not ready yet · {{playable}} of {{total}} opponents · {{maps}} maps',
                    playable: readiness.playableEntries.length,
                    total: readiness.entries.length,
                    maps: readiness.installedMaps.length,
                  })}
            </ReadinessPill>
          </HeroActions>
        </HeroContent>
      </Hero>

      <SummaryCard>
        <SummaryColumn>
          <SummaryHeader>
            <SectionLabel>{t('practice.home.mapPool', 'Map pool')}</SectionLabel>
            <ChangeLink type='button' onClick={() => push('/play/practice/setup')}>
              {t('practice.home.change', 'Change')}
            </ChangeLink>
          </SummaryHeader>
          <SummaryName>
            {poolName}
            <SummaryDetail>{poolDetail}</SummaryDetail>
          </SummaryName>
          <MapPoolGrid maps={poolMaps} size={56} maxTiles={7} />
        </SummaryColumn>

        <SummaryColumn>
          <SummaryHeader>
            <SectionLabel>{t('practice.home.opponents', 'Opponents')}</SectionLabel>
            <ChangeLink type='button' onClick={() => push('/play/practice/opponents')}>
              {t('practice.home.change', 'Change')}
            </ChangeLink>
          </SummaryHeader>
          <SummaryName>
            {lineupPreset?.name ?? t('practice.home.unsavedLineup', 'Your lineup')}
            <SummaryDetail>{t('practice.home.oneDrawn', '· one is drawn each game')}</SummaryDetail>
          </SummaryName>
          <OpponentChips>
            {shownEntries.map(entry => (
              <OpponentChip key={entry.ref.key} $needsAttention={!entry.playable}>
                {entry.bot ? (
                  <BotAvatar races={entry.bot.races} size={32} />
                ) : (
                  <SpecificBotIcon>
                    <MaterialIcon icon='smart_toy' size={20} />
                  </SpecificBotIcon>
                )}
                <OpponentChipName>{entry.ref.name}</OpponentChipName>
                {!entry.playable ? (
                  <WarningMark
                    title={t('practice.home.notPlayable', "This opponent can't be drawn yet")}>
                    <MaterialIcon icon='warning' size={16} />
                  </WarningMark>
                ) : null}
              </OpponentChip>
            ))}
            {hiddenEntries.length > 0 ? (
              <OpponentChip
                $needsAttention={false}
                title={hiddenEntries.map(entry => entry.ref.name).join(', ')}>
                <OpponentChipName>+{hiddenEntries.length}</OpponentChipName>
              </OpponentChip>
            ) : null}
            {readiness.entries.length === 0 ? (
              <SectionNote>
                {t('practice.home.noOpponents', 'No opponents chosen yet.')}
              </SectionNote>
            ) : null}
          </OpponentChips>
        </SummaryColumn>

        <SummaryColumn>
          <SectionLabel>{t('practice.home.you', 'You')}</SectionLabel>
          <RacePicker
            race={setup.playerRace}
            size={RacePickerSize.Large}
            onSetRace={(race: RaceChar) =>
              updatePracticeStore(draft => {
                draft.matchmaking.playerRace = race
              })
            }
          />
          <HideCheckBox
            checked={setup.hideOpponent}
            label={t('practice.home.hideOpponent', "Hide which bot I'm playing")}
            onChange={event =>
              updatePracticeStore(draft => {
                draft.matchmaking.hideOpponent = event.target.checked
              })
            }
          />
        </SummaryColumn>
      </SummaryCard>

      <SpecificBotRow type='button' onClick={() => push('/play/practice/game')}>
        <SpecificBotIcon>
          <MaterialIcon icon='person_search' size={24} />
        </SpecificBotIcon>
        <SpecificBotText>
          <SummaryName>{t('practice.home.specificBot', 'Play a specific bot')}</SummaryName>
          <SpecificBotHint>
            {t(
              'practice.home.specificBotHint',
              'Any bot, any map, one or several opponents. You set the game up.',
            )}
          </SpecificBotHint>
        </SpecificBotText>
        <ActionSpacer />
        <SpecificBotAction>
          {t('practice.home.setUpGame', 'Set up a game')}
          <MaterialIcon icon='arrow_forward' size={20} />
        </SpecificBotAction>
      </SpecificBotRow>

      <BotsSection>
        <SectionHeader>
          <SectionLabel>{t('practice.home.yourBots', 'Your bots')}</SectionLabel>
          <SectionRule />
          <SectionNote>{t('practice.home.yourBotsNote', 'Installed on this PC')}</SectionNote>
        </SectionHeader>

        {nothingToShow ? (
          <EmptyState>
            <SummaryName>{t('practice.home.emptyTitle', 'No bots on this PC yet')}</SummaryName>
            <EmptyText>
              {t(
                'practice.home.emptyText',
                'Browse the collection while you are online to download an opponent, or point the app at a bot you built yourself and play it offline.',
              )}
            </EmptyText>
            <EmptyActions>
              <FilledButton
                label={t('practice.home.browseBots', 'Browse all bots')}
                iconStart={<MaterialIcon icon='search' />}
                onClick={() => push('/play/practice/bots')}
              />
              <OutlinedButton
                label={t('practice.picker.useLocalBuild', 'Use a local build')}
                iconStart={<MaterialIcon icon='folder_open' />}
                onClick={() =>
                  dispatch(openDialog({ type: DialogType.LocalBuildBot, initData: {} }))
                }
              />
            </EmptyActions>
          </EmptyState>
        ) : (
          <BotGrid>
            {bots
              .filter(bot => bot.readiness.state !== 'notInstalled')
              .map(bot => (
                <InstalledBotRow key={bot.key} bot={bot} />
              ))}
            <BrowseTile type='button' onClick={() => push('/play/practice/bots')}>
              <MaterialIcon icon='search' size={20} />
              {t('practice.home.browseBots', 'Browse all bots')}
            </BrowseTile>
          </BotGrid>
        )}
      </BotsSection>
    </PracticePageColumn>
  )
}

function InstalledBotRow({ bot }: { bot: BotView }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const openDetails = () => {
    dispatch(openDialog({ type: DialogType.BotDetails, initData: { botKey: bot.key } }))
  }

  let action = (
    <DetailsIconButton
      icon={<MaterialIcon icon='info' size={22} />}
      title={t('practice.home.details', 'Details')}
      ariaLabel={t('practice.home.details', 'Details')}
      onClick={openDetails}
    />
  )
  if (bot.updateAvailable) {
    action = (
      <TextButton
        label={t('practice.home.update', 'Update')}
        onClick={() => {
          updateBot(bot).catch(err => {
            logger.error(`Failed to update a practice bot: ${err?.stack ?? err}`)
          })
        }}
      />
    )
  } else if (bot.readiness.state === 'missingRuntime') {
    action = <TextButton label={t('practice.home.setUp', 'Set up')} onClick={openDetails} />
  }

  return (
    <BotRow>
      <BotAvatar races={bot.races} size={36} />
      <BotRowText>
        <BotRowName>{bot.name}</BotRowName>
        <BotRowVersion>{bot.version}</BotRowVersion>
      </BotRowText>
      <ReadinessBadge bot={bot} size='small' />
      {action}
    </BotRow>
  )
}
