import styled, { css } from 'styled-components'
import { Slot } from '../../../../common/lobbies/slot'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { MaterialIcon } from '../../../icons/material/material-icon'
import { FilledButton, TextButton } from '../../../material/button'
import { useAppSelector } from '../../../redux-hooks'
import {
  displaySmall,
  headlineMedium,
  labelLarge,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../../../styles/typography'
import { ConnectedUsername } from '../../../users/connected-username'
import {
  formatCountdown,
  formatElapsed,
  getPlayingCount,
  isEmptySeat,
  LobbyView,
  logAction,
} from './lobby-model'
import { HostBadge, RaceBadge, SectionLabel } from './lobby-parts'

const Panel = styled.div`
  flex-shrink: 0;
  padding: 16px 20px 0;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

// --- launching ---------------------------------------------------------------------------------

const LaunchBanner = styled.div`
  padding: 14px 16px;

  display: flex;
  align-items: center;
  gap: 14px;

  background-color: rgb(from var(--color-blue70) r g b / 0.16);
  border: 1px solid rgb(from var(--color-blue70) r g b / 0.4);
  border-radius: 8px;
`

const LaunchIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--color-blue90);
`

const LaunchText = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const LaunchTitle = styled.div`
  ${titleLarge};
`

const LaunchNote = styled.div`
  ${labelLarge};

  color: var(--theme-on-surface-variant);
`

const LaunchNumeral = styled.div`
  ${displaySmall};

  flex-shrink: 0;

  color: var(--color-blue90);
  font-variant-numeric: tabular-nums;
`

const PanelFootNote = styled.div`
  ${labelMedium};

  color: rgb(from var(--theme-on-surface) r g b / 0.5);
`

/** The launch, presented in the room rather than over it — the lobby never becomes a modal. */
export function LaunchingPanel({ view }: { view: LobbyView }) {
  const launch = view.data.launch!
  const loadedCount = launch.loadedUserIds.length

  return (
    <Panel>
      <LaunchBanner>
        <LaunchIcon icon='rocket_launch' size={28} />
        <LaunchText>
          <LaunchTitle>Launching game {view.data.gameNumber}…</LaunchTitle>
          <LaunchNote>
            {loadedCount} of {view.participants.length} loaded · auto-aborts at 75s and everyone
            returns here
          </LaunchNote>
        </LaunchText>
        <LaunchNumeral>{formatCountdown(launch.secondsLeft)}</LaunchNumeral>
      </LaunchBanner>
      <PanelFootNote>
        Races stay changeable until launch; everything else is locked. If someone fails to load, the
        lobby just… continues, with a system message naming them.
      </PanelFootNote>
    </Panel>
  )
}

// --- in game -----------------------------------------------------------------------------------

const GameCard = styled.div`
  padding: 12px 16px;

  display: flex;
  align-items: center;
  gap: 14px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const GameMapTile = styled.div`
  width: 44px;
  height: 44px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(from var(--color-blue70) r g b / 0.3);
  border-radius: 6px;
  color: var(--color-blue90);
`

const GameTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const GameTitle = styled.div`
  ${titleMedium};
`

const LivePill = styled.div`
  ${labelMedium};

  height: 20px;
  padding-inline: 8px;

  display: flex;
  align-items: center;
  gap: 6px;

  background-color: rgb(from var(--theme-positive) r g b / 0.16);
  border-radius: 10px;
  color: var(--theme-positive);
  font-variant-numeric: tabular-nums;
`

const LiveDot = styled.div`
  width: 6px;
  height: 6px;

  background-color: var(--theme-positive);
  border-radius: 50%;
`

const GameNote = styled.div`
  ${labelLarge};

  color: var(--theme-on-surface-variant);
`

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const MemberChip = styled.div<{ $waiting?: boolean }>`
  ${labelMedium};

  height: 26px;
  padding-inline: 10px;

  display: flex;
  align-items: center;

  border-radius: 4px;
  letter-spacing: 0.06em;
  text-transform: uppercase;

  ${props =>
    props.$waiting
      ? css`
          background-color: var(--theme-amber);
          color: var(--color-blue10);
        `
      : css`
          background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
          color: var(--theme-on-surface-variant);
        `}
`

const VoteStrip = styled.div`
  flex-shrink: 0;
  margin: 0 20px 16px;
  padding: 10px 12px;

  display: flex;
  align-items: center;
  gap: 12px;

  border: 1px dashed var(--theme-outline);
  border-radius: 8px;
`

const VoteLabel = styled.div`
  ${labelLarge};

  color: var(--theme-on-surface-variant);
`

const VoteChip = styled.button<{ $leading: boolean }>`
  ${labelLarge};

  height: 28px;
  padding-inline: 10px;

  border: 1px solid
    ${props => (props.$leading ? 'rgb(from var(--color-blue70) r g b / 0.6)' : 'var(--theme-outline)')};
  border-radius: 6px;
  cursor: pointer;

  background-color: ${props =>
    props.$leading ? 'rgb(from var(--color-blue70) r g b / 0.24)' : 'transparent'};
  color: ${props => (props.$leading ? 'var(--color-blue90)' : 'var(--theme-on-surface-variant)')};
`

function MemberName({ userId }: { userId: SbUserId }) {
  const name = useAppSelector(s => s.users.byId.get(userId)?.name)
  return <>{name ?? '…'}</>
}

const IN_GAME_CHIP_LIMIT = 3

/** What everyone who isn't in the running game sees: the game, and each other. */
export function InGamePanel({ view }: { view: LobbyView }) {
  const runState = view.data.runState!
  const inGame = new Set(runState.inGameUsers)
  const viewerInGame = inGame.has(view.viewer.userId)

  const inGameIds = view.participants.filter(id => inGame.has(id))
  const waitingIds = [
    ...view.participants.filter(id => !inGame.has(id)),
    ...view.lobby.bench.map(benched => benched.userId),
  ]

  return (
    <Panel>
      <GameCard>
        <GameMapTile>
          <MaterialIcon icon='map' />
        </GameMapTile>
        <div>
          <GameTitleRow>
            <GameTitle>Game {view.data.gameNumber} in progress</GameTitle>
            <LivePill>
              <LiveDot />
              {formatElapsed(runState.elapsedMs)}
            </LivePill>
          </GameTitleRow>
          <GameNote>
            {view.lobby.map?.name} · {getPlayingCount(view.lobby)} playing ·{' '}
            {viewerInGame ? "you're in this one" : "you're in the next one"}
          </GameNote>
        </div>
      </GameCard>
      <ChipRow>
        {inGameIds.slice(0, IN_GAME_CHIP_LIMIT).map(id => (
          <MemberChip key={id}>
            <MemberName userId={id} /> · in game
          </MemberChip>
        ))}
        {inGameIds.length > IN_GAME_CHIP_LIMIT ? (
          <MemberChip>+{inGameIds.length - IN_GAME_CHIP_LIMIT} in game</MemberChip>
        ) : null}
        {waitingIds.map(id => (
          <MemberChip key={id} $waiting={true}>
            {id === view.viewer.userId ? 'you' : <MemberName userId={id} />} · waiting
          </MemberChip>
        ))}
      </ChipRow>
    </Panel>
  )
}

/** The next game's map, decided while this one plays out. */
export function MapVoteStrip({ view }: { view: LobbyView }) {
  const options = view.data.mapVote
  if (!options) {
    return null
  }
  const leader = Math.max(...options.map(option => option.votes))

  return (
    <VoteStrip>
      <MaterialIcon icon='how_to_vote' size={20} />
      <VoteLabel>Next map — vote while you wait:</VoteLabel>
      {options.map(option => (
        <VoteChip
          key={option.name}
          $leading={option.votes === leader && leader > 0}
          onClick={() => logAction('voteForMap', option.name)}>
          {option.name} · {option.votes}
        </VoteChip>
      ))}
    </VoteStrip>
  )
}

// --- regroup -----------------------------------------------------------------------------------

const SeriesBox = styled.div`
  padding: 12px 16px;

  display: flex;
  align-items: center;
  gap: 16px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const SeriesHeading = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const SeriesLabel = styled.div`
  ${labelSmall};

  color: var(--theme-on-surface-variant);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`

const SeriesScore = styled.div`
  ${headlineMedium};

  display: flex;
  align-items: baseline;
  gap: 12px;
`

const SeriesTeam = styled.span`
  ${titleLarge};
`

const SeriesNumbers = styled.span`
  color: var(--theme-amber);
  font-variant-numeric: tabular-nums;
`

const GameChips = styled.div`
  flex-shrink: 0;

  display: flex;
  gap: 8px;
`

const GameChip = styled.div<{ $current: boolean }>`
  padding: 4px 10px;

  display: flex;
  flex-direction: column;
  align-items: center;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border: 1px solid
    ${props => (props.$current ? 'rgb(from var(--color-blue70) r g b / 0.6)' : 'transparent')};
  border-radius: 6px;
`

const GameChipLabel = styled.div`
  ${labelSmall};

  color: var(--theme-on-surface-variant);
`

const GameChipResult = styled.div`
  ${labelLarge};

  font-variant-numeric: tabular-nums;
`

const SeatsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
`

const SeatColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SeatRow = styled.div<{ $promoted?: boolean }>`
  min-height: 36px;
  padding: 4px 12px 4px 8px;

  display: flex;
  align-items: center;
  gap: 8px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border: 1px solid transparent;
  border-radius: 6px;

  ${props =>
    props.$promoted
      ? css`
          background-color: rgb(from var(--theme-amber) r g b / 0.08);
          border: 1px dashed rgb(from var(--theme-amber) r g b / 0.6);
        `
      : css``}
`

const SeatName = styled.div`
  ${titleSmall};
  ${singleLine};

  min-width: 0;
`

const SeatSpacer = styled.div`
  flex-grow: 1;
`

const SeatWins = styled.div`
  ${labelMedium};

  flex-shrink: 0;

  color: var(--theme-amber);
`

const PromotionNote = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
`

const ActionRow = styled.div`
  padding: 12px;

  display: flex;
  align-items: center;
  gap: 16px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border-radius: 8px;
`

const RunItBackButton = styled(FilledButton)`
  min-height: 44px;
  padding-inline: 24px;
`

const ActionNote = styled.div`
  ${labelMedium};

  color: rgb(from var(--theme-on-surface) r g b / 0.5);
`

function RegroupSeat({ view, slot }: { view: LobbyView; slot: Slot }) {
  const promotion = view.data.promotion
  const promoted = promotion?.userId === slot.userId
  const wins = slot.userId !== undefined ? view.data.winsByUser?.get(slot.userId) : undefined

  return (
    <SeatRow $promoted={promoted}>
      <RaceBadge race={slot.race} />
      <SeatName>
        {slot.userId !== undefined ? (
          <ConnectedUsername userId={slot.userId} interactive={false} />
        ) : (
          'Computer'
        )}
      </SeatName>
      {slot.id === view.lobby.host.id ? <HostBadge>HOST</HostBadge> : null}
      {promoted ? <PromotionNote>{promotion!.note}</PromotionNote> : null}
      <SeatSpacer />
      {wins !== undefined ? <SeatWins>{wins}W</SeatWins> : null}
    </SeatRow>
  )
}

/** The payoff moment: what just happened, who's still here, and how fast you can do it again. */
export function RegroupPanel({ view }: { view: LobbyView }) {
  const series = view.data.series!
  const playerTeams = view.lobby.teams.filter(team => !team.isObserver)

  return (
    <Panel>
      <SeriesBox>
        <SeriesHeading>
          <SeriesLabel>Tonight's series</SeriesLabel>
          <SeriesScore>
            <SeriesTeam>{series.teamNames[0]}</SeriesTeam>
            <SeriesNumbers>
              {series.score[0]} — {series.score[1]}
            </SeriesNumbers>
            <SeriesTeam>{series.teamNames[1]}</SeriesTeam>
          </SeriesScore>
        </SeriesHeading>
        <GameChips>
          {series.games.map((game, i) => (
            <GameChip key={game.label} $current={i === series.games.length - 1}>
              <GameChipLabel>{game.label}</GameChipLabel>
              <GameChipResult>
                {game.winner} · {game.duration}
              </GameChipResult>
            </GameChip>
          ))}
        </GameChips>
      </SeriesBox>

      <div>
        <SectionLabel>Seats &amp; races kept from last game</SectionLabel>
        <SeatsGrid>
          {playerTeams.map(team => (
            <SeatColumn key={team.teamId}>
              {team.slots
                .filter(slot => !isEmptySeat(slot))
                .map(slot => (
                  <RegroupSeat key={slot.id} view={view} slot={slot} />
                ))}
            </SeatColumn>
          ))}
        </SeatsGrid>
      </div>

      <ActionRow>
        {view.viewer.isHost ? (
          <>
            <RunItBackButton label='RUN IT BACK' onClick={() => logAction('runItBack')} />
            <TextButton
              label='SWAP TEAMS'
              iconStart={<MaterialIcon icon='swap_horiz' size={20} />}
              onClick={() => logAction('swapTeams')}
            />
            <TextButton
              label='SHUFFLE'
              iconStart={<MaterialIcon icon='shuffle' size={20} />}
              onClick={() => logAction('shuffle')}
            />
            <TextButton
              label='BALANCE'
              iconStart={<MaterialIcon icon='balance' size={20} />}
              onClick={() => logAction('balance')}
            />
            <ActionNote>balance uses MMR, host-only</ActionNote>
          </>
        ) : (
          <ActionNote>Same seats, same races — waiting for the host to run it back.</ActionNote>
        )}
      </ActionRow>
    </Panel>
  )
}
