import styled, { css, keyframes } from 'styled-components'
import { assertUnreachable } from '../../../../../common/assert-unreachable'
import { hasObservers, hasOpposingSides, Lobby } from '../../../../../common/lobbies'
import { LobbyChangedSetting } from '../../../../../common/lobbies/lobby-network'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { FilledButton, IconButton, TextButton } from '../../../../material/button'
import {
  displayMedium,
  headlineMedium,
  labelLarge,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleMedium,
} from '../../../../styles/typography'
import { ScenarioData } from '../mock-data'
import {
  formatElapsed,
  gameSubTypeLabel,
  gameTypeLabel,
  getCountdownColor,
  getCountdownUrgency,
  getRoomLifecycle,
  RoomViewer,
} from './room-model'

const changedFlash = keyframes`
  0%, 100% {
    border-color: rgb(from var(--theme-amber) r g b / 0.55);
    background-color: rgb(from var(--theme-amber) r g b / 0.12);
  }
  50% {
    border-color: var(--theme-amber);
    background-color: rgb(from var(--theme-amber) r g b / 0.26);
  }
`

const Header = styled.div`
  flex-shrink: 0;
  padding: 16px 20px 12px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const TitleRow = styled.div`
  min-height: 56px;

  display: flex;
  align-items: center;
  gap: 12px;
`

const LobbyTitle = styled.div`
  ${titleLarge};
  ${singleLine};

  flex-shrink: 1;
`

const VisibilityBadge = styled.div`
  ${labelMedium};

  height: 24px;
  flex-shrink: 0;
  padding-inline: 8px;

  display: flex;
  align-items: center;
  gap: 4px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  border-radius: 12px;
  color: var(--theme-on-surface-variant);
`

const Spacer = styled.div`
  flex-grow: 1;
`

const StatusArea = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 16px;
`

const BenchPill = styled.div`
  ${labelLarge};

  height: 32px;
  padding-inline: 12px;

  display: flex;
  align-items: center;
  gap: 6px;

  background-color: rgb(from var(--theme-amber) r g b / 0.14);
  border-radius: 16px;
  color: var(--theme-amber);
`

const CountdownBlock = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const CountdownNumeral = styled.div<{ $color: string }>`
  ${displayMedium};

  min-width: 48px;

  color: ${props => props.$color};
  font-variant-numeric: tabular-nums;
  line-height: 48px;
  text-align: center;
`

const CountdownLabel = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const InGameStatus = styled.div`
  ${titleMedium};

  height: 36px;
  padding-inline: 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  background-color: rgb(from var(--theme-purple) r g b / 0.16);
  border-radius: 18px;
  color: var(--theme-on-surface);
  font-variant-numeric: tabular-nums;
`

const GameDot = styled.div`
  width: 8px;
  height: 8px;

  background-color: var(--theme-purple);
  border-radius: 50%;
`

const SeriesStrip = styled.div`
  padding-inline: 4px;

  display: flex;
  flex-direction: column;
  align-items: center;
`

const SeriesLabel = styled.div`
  ${labelSmall};

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.1em;
`

const SeriesScore = styled.div`
  ${headlineMedium};

  display: flex;
  align-items: baseline;
  gap: 8px;

  font-variant-numeric: tabular-nums;
`

const WinnerScore = styled.span`
  color: var(--theme-positive);
`

const LoserScore = styled.span`
  color: var(--theme-negative);
`

const SeriesDash = styled.span`
  color: var(--theme-on-surface-variant);
`

const WaitingNote = styled.div`
  ${labelLarge};

  color: var(--theme-on-surface-variant);
`

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const Chip = styled.div<{ $changed: boolean }>`
  ${labelMedium};

  height: 28px;
  padding-inline: 10px;

  display: flex;
  align-items: center;
  gap: 6px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 14px;
  color: var(--theme-on-surface-variant);

  ${props =>
    props.$changed
      ? css`
          animation: ${changedFlash} 1.8s ease-in-out infinite;
          color: var(--theme-amber);
        `
      : css``}
`

interface SettingChip {
  id: string
  icon: string
  label: string
  /** Which reported settings change makes this chip the one that just moved. */
  changedBy?: LobbyChangedSetting
}

function getSettingChips(lobby: Lobby): SettingChip[] {
  const chips: SettingChip[] = [
    { id: 'map', icon: 'map', label: lobby.map?.name ?? 'No map', changedBy: 'map' },
    {
      id: 'gameType',
      icon: 'strategy',
      label: gameTypeLabel(lobby.gameType),
      changedBy: 'gameType',
    },
  ]

  const subType = gameSubTypeLabel(lobby)
  if (subType !== undefined) {
    chips.push({ id: 'gameSubType', icon: 'groups', label: subType, changedBy: 'gameSubType' })
  }

  chips.push({
    id: 'useLegacyLimits',
    icon: 'tune',
    label: lobby.useLegacyLimits ? 'Legacy limits' : 'Extended limits',
    changedBy: 'useLegacyLimits',
  })
  chips.push({
    id: 'allowObservers',
    icon: 'visibility',
    label: hasObservers(lobby) ? 'Observers on' : 'Observers off',
    changedBy: 'allowObservers',
  })

  return chips
}

function LifecycleStatus({ data, viewer }: { data: ScenarioData; viewer: RoomViewer }) {
  const lifecycle = getRoomLifecycle(data)

  switch (lifecycle) {
    case 'gathering':
      return viewer.isHost ? (
        <FilledButton
          label='Start game'
          iconStart={<MaterialIcon icon='play_arrow' size={20} />}
          disabled={!hasOpposingSides(data.lobby)}
          onClick={() => console.log('start game')}
        />
      ) : (
        <WaitingNote>Waiting for the host to start</WaitingNote>
      )

    case 'countingDown': {
      const secondsLeft = data.countdownTimer ?? 0
      return (
        <CountdownBlock>
          <CountdownLabel>Starting in</CountdownLabel>
          <CountdownNumeral $color={getCountdownColor(getCountdownUrgency(secondsLeft))}>
            {secondsLeft}
          </CountdownNumeral>
          {viewer.isHost ? (
            <TextButton label='Cancel' onClick={() => console.log('cancel countdown')} />
          ) : null}
        </CountdownBlock>
      )
    }

    case 'inGame':
      return (
        <InGameStatus>
          <GameDot />
          In game · {formatElapsed(data.runState?.elapsedMs ?? 0)}
        </InGameStatus>
      )

    case 'regroup': {
      const [wins, losses] = data.seriesScore ?? [0, 0]
      return (
        <SeriesStrip>
          <SeriesLabel>Series</SeriesLabel>
          <SeriesScore>
            <WinnerScore>{wins}</WinnerScore>
            <SeriesDash>–</SeriesDash>
            <LoserScore>{losses}</LoserScore>
          </SeriesScore>
        </SeriesStrip>
      )
    }

    default:
      return assertUnreachable(lifecycle)
  }
}

/**
 * The strip above the room's chat: what this lobby is (name, who can find it, how to invite), what
 * it's configured to play, and where it is in its life. The lifecycle indicator is deliberately the
 * only loud thing here — everything else is a settings chip that recedes until the host moves it.
 */
export function RoomHeader({ data, viewer }: { data: ScenarioData; viewer: RoomViewer }) {
  const lobby = data.lobby
  const changed = new Set(data.changedSettings ?? [])
  // Settings reshape the slot layout, so they're only the host's to touch while the lobby is
  // gathering -- not once it's committed to launching or already playing.
  const lifecycle = getRoomLifecycle(data)
  const canEditSettings = viewer.isHost && lifecycle !== 'countingDown' && lifecycle !== 'inGame'

  return (
    <Header>
      <TitleRow>
        <LobbyTitle>{lobby.name}</LobbyTitle>
        <VisibilityBadge>
          <MaterialIcon icon={lobby.visibility === 'unlisted' ? 'lock' : 'public'} size={16} />
          {lobby.visibility === 'unlisted' ? 'Unlisted' : 'Public'}
        </VisibilityBadge>
        <IconButton
          icon={<MaterialIcon icon='link' />}
          title='Copy invite link'
          ariaLabel='Copy invite link'
          onClick={() => console.log('copy invite link')}
        />
        {canEditSettings ? (
          <IconButton
            icon={<MaterialIcon icon='settings' />}
            title='Lobby settings'
            ariaLabel='Lobby settings'
            onClick={() => console.log('open lobby settings')}
          />
        ) : null}
        <Spacer />
        <StatusArea>
          {viewer.isBenched ? (
            <BenchPill>
              <MaterialIcon icon='event_seat' size={18} />
              {viewer.benchPosition === 1
                ? 'On the bench · next up'
                : `On the bench · #${viewer.benchPosition} in line`}
            </BenchPill>
          ) : null}
          <LifecycleStatus data={data} viewer={viewer} />
        </StatusArea>
      </TitleRow>
      <ChipRow>
        {getSettingChips(lobby).map(chip => (
          <Chip key={chip.id} $changed={!!chip.changedBy && changed.has(chip.changedBy)}>
            <MaterialIcon icon={chip.icon} size={16} />
            {chip.label}
          </Chip>
        ))}
      </ChipRow>
    </Header>
  )
}
