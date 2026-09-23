import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import keycode from 'keycode'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BotLearningMode, botRaceToRaceChar } from '../../common/bots/bot-catalog'
import { BotView } from '../../common/bots/bot-view'
import {
  customGameType,
  PracticeGameOpponent,
  PracticeGameRecord,
} from '../../common/bots/practice'
import { GameType } from '../../common/games/game-type'
import { getGameDurationString } from '../../common/games/games'
import { MapInfoJson } from '../../common/maps'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { RaceIcon } from '../lobbies/race-icon'
import logger from '../logging/logger'
import { FilledButton, FilledTonalButton, IconButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { replace } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { startReplay } from '../replays/action-creators'
import { getRaceColor } from '../styles/colors'
import {
  bodyMedium,
  bodySmall,
  displayLarge,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { BotAvatar } from './bot-avatar'
import { botDisplayTags, PlayStyleTags, StrengthBadge } from './bot-badges'
import { botViewsAtom, practiceSessionAtom, practiceStoreAtom } from './practice-atoms'
import { LaunchOpponent, launchPracticeGame, startPracticeMatchmaking } from './practice-launch'
import { closePracticeResult } from './practice-result-overlay'

const Root = styled.div`
  position: absolute;
  inset: 0;

  overflow-x: hidden;
  overflow-y: auto;
  contain: paint;
`

const ResultMapImage = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
`

/** Dims the map down toward the page background so the centered headline stays readable. */
const ResultMapShade = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    var(--theme-surface) 0%,
    rgb(from var(--theme-surface) r g b / 0.8) 45%,
    rgb(from var(--theme-surface) r g b / 0.35) 75%,
    transparent 100%
  );
`

/** Shown when the played map has no image to draw, so the page renders the same offline. */
const ResultFallback = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    rgb(from var(--color-blue30) r g b / 0.22) 0%,
    var(--theme-surface) 70%
  );
`

function hasResultMapImage(map: MapInfoJson): boolean {
  return !!(map.image512Url || map.image1024Url || map.image2048Url)
}

/**
 * The result page's backdrop: the played map's image, dimmed toward the page background, or a
 * gradient when the map has no image or the image can't be fetched.
 */
function ResultBackdrop({ map }: { map: MapInfoJson | undefined }) {
  const [failedMapId, setFailedMapId] = useState<string | undefined>()
  if (!map || !hasResultMapImage(map) || failedMapId === map.id) {
    return <ResultFallback />
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
      <ResultMapImage
        key={map.id}
        src={map.image1024Url ?? map.image512Url ?? map.image2048Url}
        srcSet={srcSet}
        sizes='100vw'
        alt=''
        decoding='async'
        onError={() => setFailedMapId(map.id)}
      />
      <ResultMapShade />
    </>
  )
}

const CloseButton = styled(IconButton)`
  position: absolute;
  top: 16px;
  right: 16px;
`

const Content = styled.div`
  /* Above the backdrop, which is positioned and would otherwise paint over static content. */
  position: relative;
  min-height: 100%;
  padding: 64px 24px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
`

const Headline = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
`

const Eyebrow = styled.div`
  ${labelMedium};
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: var(--theme-amber);
`

/**
 * The headline's glow color: what the outcome felt like for whoever the page is about (the player,
 * or in a watched game the bot that won). Outcomes with nothing to celebrate or mourn get none.
 */
type OutcomeGlow = 'positive' | 'negative' | 'winner'

const OUTCOME_GLOW_COLORS: Record<OutcomeGlow, string> = {
  positive: 'var(--theme-positive)',
  negative: 'var(--theme-negative)',
  winner: 'var(--theme-amber)',
}

const Outcome = styled.div<{ $glow?: OutcomeGlow }>`
  ${displayLarge};
  text-transform: uppercase;
  letter-spacing: 6px;
  text-shadow: ${props =>
    props.$glow ? `0 0 24px rgb(from ${OUTCOME_GLOW_COLORS[props.$glow]} r g b / 0.55),` : ''}
    0 2px 4px rgb(0 0 0 / 0.6);
`

const MatchLine = styled.div`
  ${bodyMedium};

  display: inline-flex;
  align-items: center;
  gap: 10px;
`

const RaceChip = styled.span<{ $race: RaceChar }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${props => getRaceColor(props.$race)};
`

const RaceMark = styled(RaceIcon)`
  width: 20px;
  height: 20px;
`

const Separator = styled.span`
  color: var(--theme-on-surface-variant);
`

const OpponentCard = styled.section`
  width: 640px;
  max-width: 100%;
  padding: 20px 24px 12px;
  border-radius: 8px;
  background-color: rgb(from var(--theme-container-high) r g b / 0.92);

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const OpponentRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const IconTile = styled.span`
  width: 64px;
  height: 64px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  background-color: var(--color-grey-blue40);
  color: var(--theme-on-surface-variant);
`

const OpponentText = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const OpponentName = styled.div`
  ${titleLarge};
  ${singleLine};
`

const OpponentMeta = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const StrengthColumn = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`

const StrengthLabel = styled.div`
  ${labelSmall};
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const LearningRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const LearningNote = styled.div`
  ${bodySmall};
  flex-grow: 1;
  color: var(--theme-on-surface-variant);
`

const DetailsIconButton = styled(IconButton)`
  color: var(--theme-on-surface-variant);
`

const BotList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const BotRow = styled.div<{ $winner: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px 8px 12px;
  border-radius: 8px;

  background-color: rgb(from var(--theme-container-highest) r g b / 0.5);
  /* A flat amber tint muddies against the blue card, so the winner's wash fades out instead. */
  background-image: ${props =>
    props.$winner
      ? `linear-gradient(
          90deg,
          rgb(from var(--theme-amber) r g b / 0.14),
          rgb(from var(--theme-amber) r g b / 0) 70%
        )`
      : 'none'};
  box-shadow: ${props =>
    props.$winner ? 'inset 0 0 0 1px rgb(from var(--theme-amber) r g b / 0.4)' : 'none'};
`

const BotRowText = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const BotRowName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const BotRowMeta = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const WinnerMark = styled.div`
  ${labelMedium};
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--theme-amber);
`

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const BigButton = styled(FilledButton)`
  min-height: 48px;
  min-width: 200px;
`

const BigTonalButton = styled(FilledTonalButton)`
  min-height: 48px;
`

const ErrorText = styled.div`
  ${bodyMedium};
  max-width: 640px;
  text-align: center;
  color: var(--theme-on-surface-variant);
`

const SectionEyebrow = styled.div`
  ${labelMedium};
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

/** The result screen covers the play page, so leaving it always lands back on the practice home. */
const ESCAPE = keycode('esc')

function closeResult() {
  closePracticeResult()
}

function learningNote(mode: BotLearningMode | undefined, t: TFunction): string {
  switch (mode) {
    case 'persistent':
      return t('practice.result.willRemember', 'It will remember this game next time you meet.')
    case 'none':
      return t('practice.result.noMemory', 'It starts fresh every game.')
    default:
      return t(
        'practice.result.unknownMemory',
        'Whether it remembers this game depends on the bot.',
      )
  }
}

/** How many people were on the field: the human counts once, unless they only watched. */
function participantCount(record: PracticeGameRecord): number {
  return record.observed ? record.opponents.length : record.opponents.length + 1
}

/**
 * The match line's summary for more than two participants, where a race chip per player stops
 * being readable and a plain count reads better.
 */
function matchGroupSummary(record: PracticeGameRecord, t: TFunction): string {
  if (record.observed) {
    return t('practice.result.watchedGroup', {
      defaultValue_one: 'Watched · {{count}} bot',
      defaultValue_other: 'Watched · {{count}} bots',
      count: record.opponents.length,
    })
  }
  return t('practice.result.playerVsGroup', {
    defaultValue_one: 'You vs {{count}} bot',
    defaultValue_other: 'You vs {{count}} bots',
    count: record.opponents.length,
  })
}

/**
 * Whether the opponent card gives the first opponent the big featured treatment instead of
 * listing everyone evenly. A hidden matchmaking draw stays featured even with extra opponents,
 * since concealing which bot it drew is the point; a custom game with several bots is not hiding
 * anything, so it lists them all the same way.
 */
function showFeaturedOpponent(record: PracticeGameRecord): boolean {
  if (record.observed) {
    return false
  }
  return record.opponents.length <= 1 || (record.hidden && record.mode === 'matchmaking')
}

function opponentCardEyebrow(record: PracticeGameRecord, t: TFunction): string {
  if (record.observed) {
    return t('practice.result.botsWere', 'The bots were')
  }
  if (showFeaturedOpponent(record)) {
    return t('practice.result.opponentWas', 'Your opponent was')
  }
  return t('practice.result.opponentsWere', 'Your opponents were')
}

function OpponentDetailsButton({ onClick, t }: { onClick: () => void; t: TFunction }) {
  return (
    <Tooltip text={t('practice.result.details', 'Details')} position='top'>
      <DetailsIconButton
        icon={<MaterialIcon icon='info' size={18} />}
        ariaLabel={t('practice.result.details', 'Details')}
        onClick={onClick}
      />
    </Tooltip>
  )
}

/** One row of an evenly listed opponent, used both under a featured primary and on its own. */
function OpponentListRow({
  opponent,
  bot,
  isWinner,
  t,
  onOpenDetails,
}: {
  opponent: PracticeGameOpponent
  bot: BotView | undefined
  isWinner: boolean
  t: TFunction
  onOpenDetails: (botKey: string) => void
}) {
  return (
    <BotRow $winner={isWinner}>
      <BotAvatar races={[opponent.race]} size={40} />
      <BotRowText>
        <BotRowName>{opponent.name}</BotRowName>
        <BotRowMeta>
          {bot?.source === 'local'
            ? t('practice.result.botRowMetaLocal', {
                defaultValue: '{{version}} · local build',
                version: opponent.version,
              })
            : t('practice.result.botRowMeta', {
                defaultValue: '{{version}} · by {{author}}',
                version: opponent.version,
                author:
                  bot?.authors[0]?.name ?? t('practice.result.unknownAuthor', 'an unknown author'),
              })}
        </BotRowMeta>
      </BotRowText>
      {isWinner ? (
        <WinnerMark>
          <MaterialIcon icon='trophy' size={18} />
          {t('practice.result.winner', 'Winner')}
        </WinnerMark>
      ) : null}
      {bot ? <OpponentDetailsButton onClick={() => onOpenDetails(opponent.key)} t={t} /> : null}
    </BotRow>
  )
}

/**
 * The opponents in the order the evenly listed card shows them: winners first, then everyone else
 * in seat order, each paired with its index in the record's `opponents`.
 */
function listedOpponents(
  record: PracticeGameRecord,
): Array<{ opponent: PracticeGameOpponent; index: number; isWinner: boolean }> {
  const winners = new Set(record.winnerIndices ?? [])
  const listed = record.opponents.map((opponent, index) => ({
    opponent,
    index,
    isWinner: winners.has(index),
  }))
  return [...listed.filter(o => o.isWinner), ...listed.filter(o => !o.isWinner)]
}

export function PracticeResult() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const session = useAtomValue(practiceSessionAtom)
  const store = useAtomValue(practiceStoreAtom)
  const bots = useAtomValue(botViewsAtom)

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.keyCode === ESCAPE) {
        closeResult()
        return true
      }
      return false
    },
  })

  if (!session) {
    return (
      <Root>
        <ResultBackdrop map={undefined} />
        <CloseButton
          icon={<MaterialIcon icon='close' />}
          ariaLabel={t('common.actions.close', 'Close')}
          onClick={closeResult}
        />
        <Content>
          <Headline>
            <Eyebrow>{t('practice.result.eyebrow', 'Practice · Unranked')}</Eyebrow>
            <Outcome>{t('practice.result.noGame', 'No recent game')}</Outcome>
          </Headline>
          <BigButton label={t('common.actions.close', 'Close')} onClick={closeResult} />
        </Content>
      </Root>
    )
  }

  const { record } = session
  const resultMap = store.knownMaps[record.mapId]
  const playerRace = (session.playerAssignedRace ?? record.playerRace) as RaceChar
  const primary: PracticeGameOpponent | undefined = record.opponents[0]
  const primaryBot = primary ? bots.find(b => b.key === primary.key) : undefined
  const primaryRace = primary ? botRaceToRaceChar(primary.race) : undefined
  const featured = showFeaturedOpponent(record)

  let outcomeText = t('practice.result.gameOver', 'Game over')
  let outcomeGlow: OutcomeGlow | undefined
  if (record.observed) {
    const winnerNames = new Set(
      (record.winnerIndices ?? []).flatMap(index => record.opponents[index]?.name ?? []),
    )
    if (winnerNames.size) {
      outcomeText = t('practice.result.botWon', {
        defaultValue: '{{name}} won',
        name: [...winnerNames].join(', '),
      })
      outcomeGlow = 'winner'
    }
  } else if (record.result === 'victory') {
    outcomeText = t('practice.result.victory', 'Victory')
    outcomeGlow = 'positive'
  } else if (record.result === 'defeat') {
    outcomeText = t('practice.result.defeat', 'Defeat')
    outcomeGlow = 'negative'
  }
  // What the headline's match line leads with: the human's race, or for a watched game each
  // bot's race in turn. Only meaningful for two participants; beyond that the line switches to a
  // plain count (matchSummary) instead.
  const matchRaces: RaceChar[] = record.observed
    ? record.opponents.map(opponent => botRaceToRaceChar(opponent.race))
    : [playerRace, ...(primaryRace ? [primaryRace] : [])]
  const matchSummary = participantCount(record) > 2 ? matchGroupSummary(record, t) : undefined

  const openBotDetails = (botKey: string) => {
    dispatch(openDialog({ type: DialogType.BotDetails, initData: { botKey } }))
  }

  const rematch = () => {
    const map = store.knownMaps[record.mapId]
    if (!map) {
      return
    }
    const opponents: LaunchOpponent[] = []
    for (const opponent of record.opponents) {
      const bot = bots.find(b => b.key === opponent.key)
      if (!bot) {
        return
      }
      opponents.push({ bot, race: opponent.race })
    }

    launchPracticeGame({
      mode: record.mode,
      map,
      gameType:
        record.gameType ??
        (record.mode === 'custom' ? customGameType(store.customGame) : GameType.Melee),
      playerRace: record.playerRace,
      opponents,
      hidden: record.hidden,
      observe: record.observed,
    }).catch(err => {
      logger.error(`Failed to launch a practice rematch: ${err?.stack ?? err}`)
    })
  }

  return (
    <Root>
      <ResultBackdrop map={resultMap} />
      <CloseButton
        icon={<MaterialIcon icon='close' />}
        ariaLabel={t('common.actions.close', 'Close')}
        onClick={closeResult}
      />
      <Content>
        <Headline>
          <Eyebrow>{t('practice.result.eyebrow', 'Practice · Unranked')}</Eyebrow>
          <Outcome $glow={session.error ? undefined : outcomeGlow}>
            {session.error ? t('practice.result.noResult', 'No result') : outcomeText}
          </Outcome>
          <MatchLine>
            {matchSummary ? (
              <span>{matchSummary}</span>
            ) : (
              <>
                {record.observed ? <span>{t('practice.result.watched', 'Watched')}</span> : null}
                {matchRaces.map((race, index) => (
                  <Fragment key={index}>
                    {index > 0 ? <Separator>{t('practice.result.vs', 'vs')}</Separator> : null}
                    <RaceChip $race={race}>
                      <RaceMark race={race} />
                      {raceCharToLabel(race, t)}
                    </RaceChip>
                  </Fragment>
                ))}
              </>
            )}
            <Separator>{'·'}</Separator>
            <span>{record.mapName}</span>
            {record.timeMs !== undefined ? (
              <>
                <Separator>{'·'}</Separator>
                <span>{getGameDurationString(record.timeMs)}</span>
              </>
            ) : null}
          </MatchLine>
        </Headline>

        {session.error ? (
          <ErrorText>
            {t(
              'practice.result.errorBody',
              'Something went wrong with the bots and the game had to stop. Rematch to try again.',
            )}
          </ErrorText>
        ) : null}

        {!session.error && primary ? (
          <OpponentCard>
            <SectionEyebrow>{opponentCardEyebrow(record, t)}</SectionEyebrow>

            {featured ? (
              <>
                <OpponentRow>
                  <IconTile aria-hidden={true}>
                    <MaterialIcon
                      icon={primaryBot?.source === 'local' ? 'code' : 'smart_toy'}
                      size={36}
                    />
                  </IconTile>
                  <OpponentText>
                    <OpponentName>{primary.name}</OpponentName>
                    <OpponentMeta>
                      {primaryBot?.source === 'local'
                        ? t('practice.result.opponentBylineLocal', {
                            defaultValue: '{{version}} · local build',
                            version: primary.version,
                          })
                        : t('practice.result.opponentByline', {
                            defaultValue: '{{version}} · by {{author}}',
                            version: primary.version,
                            author:
                              primaryBot?.authors[0]?.name ??
                              t('practice.result.unknownAuthor', 'an unknown author'),
                          })}
                    </OpponentMeta>
                  </OpponentText>
                  {primaryBot ? <BotAvatar races={primaryBot.races} size={48} /> : null}
                  {primaryBot ? (
                    <StrengthColumn>
                      <StrengthLabel>{t('practice.result.strength', 'Strength')}</StrengthLabel>
                      <StrengthBadge bot={primaryBot} race={primary.race} size={40} />
                    </StrengthColumn>
                  ) : null}
                </OpponentRow>

                {primaryBot ? <PlayStyleTags tags={botDisplayTags(primaryBot, t)} /> : null}

                {record.opponents.length > 1 ? (
                  <BotList>
                    {listedOpponents(record)
                      .filter(({ index }) => index > 0)
                      .map(({ opponent, index, isWinner }) => (
                        <OpponentListRow
                          key={index}
                          opponent={opponent}
                          bot={bots.find(b => b.key === opponent.key)}
                          isWinner={isWinner}
                          t={t}
                          onOpenDetails={openBotDetails}
                        />
                      ))}
                  </BotList>
                ) : null}

                <LearningRow>
                  <LearningNote>{learningNote(primaryBot?.learning.mode, t)}</LearningNote>
                  <OpponentDetailsButton onClick={() => openBotDetails(primary.key)} t={t} />
                </LearningRow>
              </>
            ) : (
              <BotList>
                {listedOpponents(record).map(({ opponent, index, isWinner }) => (
                  <OpponentListRow
                    key={index}
                    opponent={opponent}
                    bot={bots.find(b => b.key === opponent.key)}
                    isWinner={isWinner}
                    t={t}
                    onOpenDetails={openBotDetails}
                  />
                ))}
              </BotList>
            )}
          </OpponentCard>
        ) : null}

        <Actions>
          <BigTonalButton
            label={t('practice.result.watchReplay', 'Watch replay')}
            iconStart={<MaterialIcon icon='movie' />}
            disabled={!record.replayPath}
            onClick={() => {
              if (record.replayPath) {
                dispatch(startReplay({ path: record.replayPath, name: record.mapName }))
              }
            }}
          />
          <BigTonalButton
            label={
              record.observed
                ? t('practice.result.watchAgain', 'Watch again')
                : t('practice.result.rematch', 'Rematch')
            }
            iconStart={<MaterialIcon icon='replay' />}
            onClick={rematch}
          />
          {record.mode === 'matchmaking' ? (
            <BigButton
              label={t('practice.result.findNewOpponent', 'Find new opponent')}
              iconStart={<MaterialIcon icon='shuffle' />}
              onClick={startPracticeMatchmaking}
            />
          ) : (
            <BigButton
              label={t('practice.result.backToSetup', 'Back to setup')}
              iconStart={<MaterialIcon icon='tune' />}
              // Swapping out the result's own history entry keeps back from reopening it.
              onClick={() => replace('/play/practice/game')}
            />
          )}
        </Actions>
      </Content>
    </Root>
  )
}
