import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BotFormatId } from '../../common/bots/bot-catalog'
import { botFormatCompatibility, BotView } from '../../common/bots/bot-view'
import {
  canPlayPracticeRace,
  customGameBotCapacity,
  CustomGameBotSlot,
  customGameType,
  MAX_RECENT_PRACTICE_MAPS,
  PracticeBotRace,
} from '../../common/bots/practice'
import { GameType } from '../../common/games/game-type'
import { NUM_RECENT_MAPS } from '../../common/lobbies'
import { MapInfoJson, SbMapId } from '../../common/maps'
import { RaceChar } from '../../common/races'
import { useSelfUser } from '../auth/auth-utils'
import { ConnectedAvatar } from '../avatars/avatar'
import { MaterialIcon } from '../icons/material/material-icon'
import { getLobbyPreferences, updateLobbyPreferences } from '../lobbies/action-creators'
import { MapSelectionPanel } from '../lobbies/create/map-column'
import { RaceButton, RacePicker, RacePickerSize, StyledRaceIcon } from '../lobbies/race-picker'
import { BrowseServerMaps } from '../maps/browse-server-maps'
import { FilledButton, IconButton, TextButton } from '../material/button'
import { FilterChip } from '../material/filter-chip'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyMedium,
  bodySmall,
  labelLarge,
  labelSmall,
  singleLine,
  titleLarge,
} from '../styles/typography'
import { runAsyncAction } from './bot-actions'
import { ReadinessBadge } from './bot-badges'
import { botViewsAtom, installedMapHashesAtom, practiceStoreAtom } from './practice-atoms'
import { refreshInstalledMaps, startCustomGame } from './practice-launch'
import { rememberMaps, updatePracticeStore } from './practice-store'

const BOT_PICKER_URL = '/play/practice/game/bots'
const PRACTICE_SETUP_URL = '/play/practice/setup'

/**
 * Fills the play area. The setup itself scrolls with the play area's own scroller, like the other
 * tabs; only the map browser needs the full-height flex layout so its list can scroll inside.
 */
const Root = styled.div`
  height: 100%;

  display: flex;
  flex-direction: column;
`

const Content = styled.div`
  padding: 24px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const PageTitle = styled.div`
  ${titleLarge};
`

const HeaderSpacer = styled.div`
  flex-grow: 1;
`

const Columns = styled.div`
  container-type: inline-size;

  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 32px;
  align-items: start;
`

const MainColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const SectionLabel = styled.div`
  ${labelSmall};

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
`

const SectionDetail = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Chips = styled.div`
  display: flex;
  gap: 8px;
`

const Helper = styled.p`
  ${bodySmall};

  margin: 0;

  color: var(--theme-on-surface-variant);
`

const SlotList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const SlotRow = styled.div<{ $highlighted?: boolean }>`
  ${containerStyles(ContainerLevel.Normal)};

  padding: 4px 8px;

  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto 40px;
  align-items: center;
  gap: 12px;

  border: 1px solid ${props => (props.$highlighted ? 'var(--theme-primary)' : 'transparent')};
  border-radius: 8px;
`

const SlotBlock = styled.div`
  ${containerStyles(ContainerLevel.Normal)};

  padding: 6px 8px;

  display: flex;
  flex-direction: column;
  /* Matches the gap between a slot's name and status lines, so all three lines read evenly. */
  gap: 4px;

  /* The human's row is outlined; the same width here keeps the columns of both lined up. */
  border: 1px solid transparent;
  border-radius: 8px;
`

const SlotRowInner = styled.div`
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto 40px;
  align-items: center;
  gap: 12px;

  /* The guidance line hangs off the text column; keep the row from padding the text past it. */
  min-height: 36px;
`

/** The name and status lines of a slot, spaced evenly with the guidance line below the row. */
const SlotText = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SlotName = styled.div`
  ${labelLarge};
  ${singleLine};
`

const SlotSubName = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

/** Takes the race picker's place in the human's row, at the picker's height so the row stays put. */
const ObserverSeat = styled(SlotSubName)`
  min-height: 36px;

  display: flex;
  align-items: center;
`

const SlotStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const SelfAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
`

const Guidance = styled.div<{ $error?: boolean }>`
  ${bodySmall};

  /* Lines up with the row's text column (past the 24px slot icon and the 12px grid gap). */
  padding-left: 36px;

  display: flex;
  align-items: flex-start;
  gap: 4px;

  color: ${props => (props.$error ? 'var(--theme-error)' : 'var(--theme-on-surface-variant)')};
`

/** Spaced like the human's `RacePicker`, so the race columns line up between rows. */
const RaceButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const SlotRaceButton = styled(RaceButton)`
  /*
   * RaceButtons spaces the buttons itself: a disabled button sits alone in its tooltip's wrapper,
   * so the picker's sibling margin would land on some buttons and not others.
   */
  &:not(:first-child) {
    margin-left: 0;
  }
`

const DimmedRaceButton = styled(SlotRaceButton)`
  opacity: var(--theme-disabled-opacity);
`

const DashedRow = styled.button`
  ${labelLarge};

  width: 100%;
  padding: 8px;

  display: flex;
  align-items: center;
  gap: 12px;

  background: transparent;
  border: 1px dashed var(--theme-outline);
  border-radius: 8px;
  color: var(--theme-on-surface-variant);
  cursor: pointer;
  text-align: left;

  &:disabled {
    cursor: default;
    opacity: var(--theme-disabled-opacity);
  }
`

const StatusBar = styled.div`
  ${containerStyles(ContainerLevel.High)};

  /* Stays in view at the bottom while the slot list runs past the window. */
  position: sticky;
  bottom: 16px;
  z-index: 1;

  padding: 16px 20px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 10px;
`

const StatusText = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const StatusHeadline = styled.div<{ $ready: boolean }>`
  ${labelSmall};

  display: inline-flex;
  align-items: center;
  gap: 6px;

  color: ${props => (props.$ready ? 'var(--theme-on-surface-variant)' : 'var(--theme-error)')};
  text-transform: uppercase;
`

const StatusDetail = styled.div`
  ${bodyMedium};
`

const Aside = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const BrowseHeader = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 24px 0;
`

/** Fills what the browse header leaves, so only the map list inside scrolls. */
const BrowseArea = styled.div`
  flex-grow: 1;
  min-height: 0;
`

/** The number of players a map seats, which caps how many bots can be added. */
function mapSlotCount(map: MapInfoJson | undefined): number {
  return map?.mapData.slots ?? 0
}

function raceQualifier(
  bot: BotView,
  gameType: GameType,
  opponentCount: number,
  t: TFunction,
): string | undefined {
  if (bot.races.length === 1) {
    return undefined
  }

  const compat = botFormatCompatibility(bot, gameType, opponentCount)
  if (compat.support !== 'verified') {
    return undefined
  }
  switch (compat.format) {
    case 'teams':
      return t('practice.customGame.testedTeams', 'tested in team games')
    case 'free-for-all':
      return t('practice.customGame.testedFreeForAll', 'tested with several opponents')
    case 'one-v-one':
      return t('practice.customGame.testedOneVsOne', 'tested in 1v1')
    default:
      return compat.format satisfies never
  }
}

/** The note under a bot whose catalog entry doesn't vouch for the format it's about to play. */
function untestedGuidance(format: BotFormatId, name: string, t: TFunction): string {
  switch (format) {
    case 'teams':
      return t('practice.customGame.untestedTeams', {
        defaultValue: "{{name}} hasn't been tested in team games.",
        name,
      })
    case 'free-for-all':
      return t('practice.customGame.untestedFreeForAll', {
        defaultValue: "{{name}} hasn't been tested with more than one opponent.",
        name,
      })
    case 'one-v-one':
      return t('practice.customGame.untestedOneVsOne', {
        defaultValue: "{{name}} hasn't been tested in 1v1.",
        name,
      })
    default:
      return format satisfies never
  }
}

export interface CustomGameSetupProps {
  onBack: () => void
}

/** One-off game setup: pick the game type, fill the slots with bots, and pick a map. */
export function CustomGameSetup({ onBack }: CustomGameSetupProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const bots = useAtomValue(botViewsAtom)
  const store = useAtomValue(practiceStoreAtom)
  const installedMapHashes = useAtomValue(installedMapHashesAtom)
  const mapsById = useAppSelector(s => s.maps.byId)
  const [browsing, setBrowsing] = useState(false)

  const customGame = store.customGame
  const botsByKey = new Map(bots.map(bot => [bot.key, bot]))

  const findMap = (mapId: SbMapId | undefined): MapInfoJson | undefined => {
    if (!mapId) {
      return undefined
    }
    // Redux hands out a deeply-readonly view of its map cache. Practice only reads map metadata
    // and stores its own copies, so nothing here writes back into that cache.
    return store.knownMaps[mapId] ?? (mapsById.get(mapId) as unknown as MapInfoJson | undefined)
  }

  const map = findMap(customGame.mapId)

  // Recent maps are shared with lobby creation: the saved lobby preferences hold the list when
  // signed in, and the practice store keeps its own copy so the list survives offline. Picks made
  // here go to both.
  const lobbyPrefs = useAppSelector(s => s.lobbyPreferences)
  const loadLobbyPreferences = useEffectEvent(() => {
    if (selfUser && !lobbyPrefs.hasLoaded && !lobbyPrefs.isRequesting) {
      dispatch(getLobbyPreferences())
    }
  })
  useEffect(() => {
    loadLobbyPreferences()
  }, [selfUser?.id])
  const recentMapIds = Array.from(new Set([...store.recentMapIds, ...lobbyPrefs.recentMaps])).slice(
    0,
    NUM_RECENT_MAPS,
  )
  const recentMaps = recentMapIds.map(id => findMap(id)).filter((m): m is MapInfoJson => !!m)

  // The map panel reads map info from the redux map store, which only knows maps fetched this
  // session; maps the practice store remembered from earlier sessions are loaded into it here so
  // the panel works offline too.
  const unloadedMaps = [map, ...recentMaps].filter(
    (m): m is MapInfoJson => !!m && !mapsById.has(m.id),
  )
  const unloadedKey = unloadedMaps.map(m => m.id).join(',')
  const loadUnloadedMaps = useEffectEvent(() => {
    if (unloadedMaps.length > 0) {
      dispatch({ type: '@maps/loadMapInfos', payload: unloadedMaps })
    }
  })
  useEffect(() => {
    loadUnloadedMaps()
  }, [unloadedKey])

  const mapHashes = [map, ...recentMaps]
    .filter((m): m is MapInfoJson => !!m)
    .map(m => m.hash)
    .join(',')
  // Whether a map's files are present is re-checked before a game starts, so this only keeps the
  // "installed" hint honest.
  const refreshMapInstallState = useEffectEvent(() => {
    const maps = [map, ...recentMaps].filter((m): m is MapInfoJson => !!m)
    if (maps.length > 0) {
      runAsyncAction(refreshInstalledMaps(maps))
    }
  })
  useEffect(() => {
    refreshMapInstallState()
  }, [mapHashes])

  const observe = !!customGame.observe
  const gameType = customGameType(customGame)
  const opponentCount = customGame.slots.length
  // Each bot faces the other bots, plus the human when the human plays.
  const opponentsPerBot = observe ? Math.max(0, opponentCount - 1) : opponentCount
  const slotsUsed = observe ? opponentCount : opponentCount + 1
  const totalSlots = mapSlotCount(map)
  const botCapacity = customGameBotCapacity(customGame, map?.mapData.slots)
  const slotsFull = opponentCount >= botCapacity

  const setSlots = (recipe: (slots: CustomGameBotSlot[]) => CustomGameBotSlot[]) => {
    updatePracticeStore(draft => {
      draft.customGame.slots = recipe([...draft.customGame.slots])
    })
  }

  const onMapPicked = (mapId: SbMapId) => {
    const picked = findMap(mapId)
    if (picked) {
      rememberMaps([picked])
    }
    updatePracticeStore(draft => {
      draft.customGame.mapId = mapId
      draft.recentMapIds = [mapId, ...draft.recentMapIds.filter(id => id !== mapId)].slice(
        0,
        MAX_RECENT_PRACTICE_MAPS,
      )
    })
    setBrowsing(false)

    if (selfUser && lobbyPrefs.hasLoaded) {
      const recentMaps = [mapId, ...recentMapIds.filter(id => id !== mapId)].slice(
        0,
        NUM_RECENT_MAPS,
      )
      // The preferences endpoint replaces the whole record, so the other fields are sent back as
      // they are; the lobby's own selected map stays unless it just fell off the list.
      dispatch(
        updateLobbyPreferences({
          name: lobbyPrefs.name || undefined,
          gameType: lobbyPrefs.gameType,
          gameSubType: lobbyPrefs.gameSubType,
          useLegacyLimits: lobbyPrefs.useLegacyLimits,
          visibility: lobbyPrefs.visibility,
          allowObservers: lobbyPrefs.allowObservers,
          recentMaps,
          selectedMap:
            lobbyPrefs.selectedMap && recentMaps.includes(lobbyPrefs.selectedMap)
              ? lobbyPrefs.selectedMap
              : null,
        }),
      )
    }
  }

  // The first thing stopping the game from starting, in the order the user would fix them.
  let blockingProblem: string | undefined
  if (!map) {
    blockingProblem = t('practice.customGame.needMap', 'Choose a map to play on.')
  } else if (observe && opponentCount < 2) {
    blockingProblem = t('practice.customGame.needTwoBots', 'Add at least two bots to watch.')
  } else if (opponentCount === 0) {
    blockingProblem = t('practice.customGame.needBot', 'Add at least one bot to play against.')
  } else if (slotsUsed > totalSlots) {
    blockingProblem = t('practice.customGame.tooManySlots', {
      defaultValue: '{{map}} only seats {{count}} players.',
      map: map.name,
      count: totalSlots,
    })
  } else {
    for (const slot of customGame.slots) {
      const bot = botsByKey.get(slot.bot.key)
      if (!bot) {
        blockingProblem = t('practice.customGame.botMissing', {
          defaultValue: '{{name}} is no longer in your library.',
          name: slot.bot.name,
        })
        break
      }
      if (bot.readiness.state !== 'ready') {
        blockingProblem = t('practice.customGame.botNotReady', {
          defaultValue: "{{name}} isn't ready to play yet.",
          name: bot.name,
        })
        break
      }
      if (!canPlayPracticeRace(bot.races, slot.race)) {
        blockingProblem = t('practice.customGame.botCantPlayRace', {
          defaultValue: "{{name}} can't play that race.",
          name: bot.name,
        })
        break
      }
      if (botFormatCompatibility(bot, gameType, opponentsPerBot).support === 'incompatible') {
        blockingProblem = t('practice.customGame.botCantPlayFormat', {
          defaultValue: "{{name}} can't play this kind of game.",
          name: bot.name,
        })
        break
      }
    }
  }

  if (browsing) {
    return (
      <Root>
        <BrowseHeader>
          <TextButton
            label={t('common.actions.back', 'Back')}
            iconStart={<MaterialIcon icon='arrow_back' />}
            onClick={() => setBrowsing(false)}
          />
          <PageTitle>{t('practice.customGame.selectMap', 'Select map')}</PageTitle>
        </BrowseHeader>
        <BrowseArea>
          <BrowseServerMaps onMapClick={onMapPicked} />
        </BrowseArea>
      </Root>
    )
  }

  return (
    <Root>
      <Content>
        <Header>
          <TextButton
            label={t('common.actions.back', 'Back')}
            iconStart={<MaterialIcon icon='arrow_back' />}
            onClick={onBack}
          />
          <PageTitle>{t('practice.customGame.title', 'Set up a game')}</PageTitle>
          <HeaderSpacer />
          <TextButton
            label={t('practice.customGame.usePracticeInstead', 'Use practice matchmaking instead')}
            onClick={() => push(PRACTICE_SETUP_URL)}
          />
        </Header>

        <Columns>
          <MainColumn>
            <Section>
              <SectionLabel>{t('practice.customGame.gameType', 'Game type')}</SectionLabel>
              <Chips>
                <FilterChip
                  label={t('practice.customGame.youVsAllBots', 'You vs all bots')}
                  selected={gameType === GameType.TopVsBottom}
                  disabled={observe}
                  onClick={() =>
                    updatePracticeStore(draft => {
                      draft.customGame.gameType = GameType.TopVsBottom
                    })
                  }
                />
                <FilterChip
                  label={t('practice.customGame.freeForAll', 'Free for all')}
                  selected={gameType === GameType.FreeForAll}
                  onClick={() =>
                    updatePracticeStore(draft => {
                      draft.customGame.gameType = GameType.FreeForAll
                    })
                  }
                />
              </Chips>
              <Helper>
                {observe
                  ? t(
                      'practice.customGame.gameTypeHelperWatching',
                      'Watched games are free for all. Bots may not support every configuration.',
                    )
                  : t(
                      'practice.customGame.gameTypeHelper',
                      'Every bot on one team against you, or everyone for themselves. Bots may not support every configuration.',
                    )}
              </Helper>
            </Section>

            <Section>
              <SectionHeader>
                <SectionLabel>{t('practice.customGame.players', 'Players')}</SectionLabel>
                <FilterChip
                  label={t('practice.customGame.letMeWatch', 'Let me watch')}
                  icon={<MaterialIcon icon='visibility' size={18} />}
                  selected={observe}
                  onClick={() =>
                    updatePracticeStore(draft => {
                      draft.customGame.observe = !observe
                    })
                  }
                />
                <HeaderSpacer />
                {map ? (
                  <SectionDetail>
                    {t('practice.customGame.slotsOnMap', {
                      defaultValue: '{{used}} of {{total}} slots on {{map}}',
                      used: slotsUsed,
                      total: totalSlots,
                      map: map.name,
                    })}
                  </SectionDetail>
                ) : null}
              </SectionHeader>

              <SlotList>
                <SlotRow $highlighted={true}>
                  {selfUser ? <SelfAvatar userId={selfUser.id} showLiveIndicator={false} /> : null}
                  <SlotName>
                    {selfUser?.name ?? ''}
                    <SlotSubName>
                      {t('practice.customGame.youSuffix', { defaultValue: ' · you' })}
                    </SlotSubName>
                  </SlotName>
                  {observe ? (
                    <ObserverSeat>
                      {t('practice.customGame.observerSeat', 'Observer seat, no map slot used')}
                    </ObserverSeat>
                  ) : (
                    <RacePicker
                      race={store.matchmaking.playerRace}
                      size={RacePickerSize.Medium}
                      onSetRace={(race: RaceChar) =>
                        updatePracticeStore(draft => {
                          draft.matchmaking.playerRace = race
                        })
                      }
                    />
                  )}
                  <div />
                </SlotRow>

                {customGame.slots.map((slot, index) => {
                  const bot = botsByKey.get(slot.bot.key)
                  const compat = bot
                    ? botFormatCompatibility(bot, gameType, opponentsPerBot)
                    : undefined
                  const qualifier = bot
                    ? raceQualifier(bot, gameType, opponentsPerBot, t)
                    : undefined

                  return (
                    <SlotBlock key={`${slot.bot.key}-${index}`}>
                      <SlotRowInner>
                        <MaterialIcon icon='smart_toy' size={24} />
                        <SlotText>
                          <SlotName>
                            {slot.bot.name}
                            <SlotSubName> {slot.bot.version}</SlotSubName>
                          </SlotName>
                          {bot ? (
                            <SlotStatus>
                              <ReadinessBadge bot={bot} size='small' />
                              {qualifier ? <SlotSubName>· {qualifier}</SlotSubName> : null}
                            </SlotStatus>
                          ) : null}
                        </SlotText>
                        {bot ? (
                          <BotSlotRaces
                            bot={bot}
                            race={slot.race}
                            onSetRace={race =>
                              setSlots(slots =>
                                slots.map((s, i) => (i === index ? { ...s, race } : s)),
                              )
                            }
                          />
                        ) : (
                          <div />
                        )}
                        <Tooltip
                          text={t('practice.customGame.removeBot', {
                            defaultValue: 'Remove {{name}}',
                            name: slot.bot.name,
                          })}
                          position='left'>
                          <IconButton
                            icon={<MaterialIcon icon='close' />}
                            ariaLabel={t('practice.customGame.removeBot', {
                              defaultValue: 'Remove {{name}}',
                              name: slot.bot.name,
                            })}
                            onClick={() => setSlots(slots => slots.filter((_, i) => i !== index))}
                          />
                        </Tooltip>
                      </SlotRowInner>

                      {compat?.support === 'incompatible' ? (
                        <Guidance $error={true}>
                          <MaterialIcon icon='block' size={17} />
                          <span>
                            {t('practice.customGame.incompatibleFormat', {
                              defaultValue: "{{name}} can't play this kind of game.",
                              name: slot.bot.name,
                            })}
                          </span>
                        </Guidance>
                      ) : null}
                      {compat &&
                      (compat.support === 'experimental' || compat.support === 'unverified') ? (
                        <Guidance>
                          <MaterialIcon icon='info' size={17} />
                          <span>{untestedGuidance(compat.format, slot.bot.name, t)}</span>
                        </Guidance>
                      ) : null}
                    </SlotBlock>
                  )
                })}

                <DashedRow type='button' disabled={slotsFull} onClick={() => push(BOT_PICKER_URL)}>
                  <MaterialIcon icon='add' size={24} />
                  <span>
                    {slotsFull && map
                      ? t('practice.customGame.slotsFull', {
                          defaultValue: 'No more slots on {{map}}',
                          map: map.name,
                        })
                      : t('practice.customGame.addBot', 'Add another bot')}
                  </span>
                </DashedRow>
              </SlotList>
            </Section>

            <StatusBar>
              <StatusText>
                <StatusHeadline $ready={!blockingProblem}>
                  <MaterialIcon
                    icon={blockingProblem ? 'error' : 'check_circle'}
                    size={16}
                    filled={true}
                  />
                  {blockingProblem
                    ? t('practice.customGame.notReady', 'Not ready yet')
                    : t('practice.customGame.readyToStart', 'Ready to start')}
                </StatusHeadline>
                <StatusDetail>
                  {blockingProblem ??
                    t('practice.customGame.botsRunLocally', 'Bots run locally on your machine.')}
                </StatusDetail>
              </StatusText>
              <FilledButton
                label={t('practice.customGame.startGame', 'Start game')}
                iconStart={<MaterialIcon icon='play_arrow' size={18} />}
                disabled={!!blockingProblem}
                onClick={() => startCustomGame()}
              />
            </StatusBar>
          </MainColumn>

          <Aside>
            <MapSelectionPanel
              mapId={customGame.mapId}
              recentMaps={recentMapIds}
              metaSuffix={
                map && installedMapHashes.has(map.hash)
                  ? t('practice.customGame.mapInstalled', 'installed')
                  : t('practice.customGame.mapNotDownloaded', 'not downloaded')
              }
              onChangeMap={() => setBrowsing(true)}
              onSelectMap={onMapPicked}
            />
          </Aside>
        </Columns>
      </Content>
    </Root>
  )
}

/** The human's picker order, so each race sits in the same column in every row. */
const PICKER_RACES: ReadonlyArray<[RaceChar, PracticeBotRace]> = [
  ['z', 'zerg'],
  ['p', 'protoss'],
  ['t', 'terran'],
  ['r', 'random'],
]

/**
 * The race choices for one bot slot. Races the package can't play stay visible but disabled, so a
 * bot's limits are apparent rather than silently missing.
 */
function BotSlotRaces({
  bot,
  race,
  onSetRace,
}: {
  bot: BotView
  race: PracticeBotRace
  onSetRace: (race: PracticeBotRace) => void
}) {
  const { t } = useTranslation()

  return (
    <RaceButtons>
      {PICKER_RACES.map(([raceChar, pickerRace]) => {
        const canPlay = canPlayPracticeRace(bot.races, pickerRace)
        const Button = canPlay ? SlotRaceButton : DimmedRaceButton

        const button = (
          <Button
            key={raceChar}
            type='button'
            disabled={!canPlay}
            $size={RacePickerSize.Medium}
            $race={raceChar}
            $active={pickerRace === race}
            $allowInteraction={canPlay}
            onClick={() => onSetRace(pickerRace)}>
            <StyledRaceIcon race={raceChar} applyRaceColor={false} $size={RacePickerSize.Medium} />
          </Button>
        )

        return canPlay ? (
          button
        ) : (
          <Tooltip
            key={raceChar}
            text={
              pickerRace === 'random'
                ? t('practice.customGame.randomUnsupported', {
                    defaultValue: "{{name}} can't play every race, so it can't be random",
                    name: bot.name,
                  })
                : t('practice.customGame.raceUnsupported', {
                    defaultValue: "{{name}} can't play this race",
                    name: bot.name,
                  })
            }>
            {button}
          </Tooltip>
        )
      })}
    </RaceButtons>
  )
}

export default CustomGameSetup
