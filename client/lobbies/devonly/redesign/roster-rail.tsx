import { useEffect, useState } from 'react'
import styled, { css, keyframes } from 'styled-components'
import { BenchedUser, MAX_OBSERVERS, Team } from '../../../../common/lobbies'
import { Slot, SlotType } from '../../../../common/lobbies/slot'
import { RaceChar } from '../../../../common/races'
import { ConnectedAvatar } from '../../../avatars/avatar'
import { MaterialIcon } from '../../../icons/material/material-icon'
import { openMapPreviewDialog } from '../../../maps/action-creators'
import { ReduxMapThumbnail } from '../../../maps/map-thumbnail'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../../../material/button'
import { useAppDispatch } from '../../../redux-hooks'
import { ContainerLevel, containerStyles, getRaceColor } from '../../../styles/colors'
import {
  displaySmall,
  labelLarge,
  labelMedium,
  singleLine,
  titleMedium,
  titleSmall,
} from '../../../styles/typography'
import { ConnectedUsername } from '../../../users/connected-username'
import {
  getObserverSlots,
  getReadyCount,
  getSeatCounts,
  isClosedSeat,
  isComputerSeat,
  isEmptySeat,
  isEveryoneReady,
  LobbyView,
  logAction,
  mapDetailsLine,
  teamLabel,
} from './lobby-model'
import { HostBadge, RaceBadge, ReadyMark, SectionLabel, SectionNote } from './lobby-parts'

const RAIL_WIDTH_PX = 340
const MAP_CARD_HEIGHT_PX = 196
const BLIND_COUNTDOWN_SECONDS = 5

/** Where a map's start locations sit, as a fraction of the minimap's width and height. */
const START_LOCATIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.12, y: 0.12 },
  { x: 0.88, y: 0.12 },
  { x: 0.88, y: 0.88 },
  { x: 0.12, y: 0.88 },
  { x: 0.5, y: 0.08 },
  { x: 0.92, y: 0.5 },
  { x: 0.5, y: 0.92 },
  { x: 0.08, y: 0.5 },
]

const Rail = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  width: ${RAIL_WIDTH_PX}px;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;

  border-left: 1px solid var(--theme-outline-variant);
`

const RailBody = styled.div`
  flex-grow: 1;
  min-height: 0;
  padding: 12px 12px 16px;

  overflow-y: auto;
`

// --- map card ----------------------------------------------------------------------------------

const MapFrame = styled.div`
  position: relative;
  height: ${MAP_CARD_HEIGHT_PX}px;

  border-radius: 8px;
  contain: paint;
`

const MapMarker = styled.div<{ $color: string }>`
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;

  background-color: ${props => props.$color};
  border-radius: 2px;
  pointer-events: none;
`

const ExpandButton = styled(IconButton)`
  position: absolute;
  right: 4px;
  bottom: 4px;

  background-color: rgb(from var(--color-blue10) r g b / 0.72);
`

const MapNameRow = styled.div`
  padding: 10px 4px 4px;

  display: flex;
  align-items: flex-start;
  gap: 8px;
`

const MapNameBlock = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const MapName = styled.div`
  ${titleMedium};
  ${singleLine};
`

const MapDetails = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
`

function MapCard({ view }: { view: LobbyView }) {
  const dispatch = useAppDispatch()
  const map = view.lobby.map
  if (!map) {
    return null
  }

  const seatedRaces = view.lobby.teams
    .filter(team => !team.isObserver)
    .flatMap(team => team.slots)
    .filter(slot => !isEmptySeat(slot))
    .map(slot => slot.race)

  return (
    <>
      <MapFrame>
        <ReduxMapThumbnail
          mapId={map.id}
          size={512}
          hasMapPreviewAction={false}
          hasFavoriteAction={false}
          hasRegenMapImageAction={false}
          onClick={() => dispatch(openMapPreviewDialog(map.id))}
        />
        {seatedRaces.map((race, i) =>
          i < START_LOCATIONS.length ? (
            <MapMarker
              key={i}
              $color={getRaceColor(race)}
              style={{
                left: `${START_LOCATIONS[i].x * 100}%`,
                top: `${START_LOCATIONS[i].y * 100}%`,
              }}
            />
          ) : null,
        )}
        <ExpandButton
          icon={<MaterialIcon icon='fullscreen' size={20} />}
          title='Expand map'
          ariaLabel='Expand map'
          onClick={() => dispatch(openMapPreviewDialog(map.id))}
        />
      </MapFrame>
      <MapNameRow>
        <MapNameBlock>
          <MapName>{map.name}</MapName>
          <MapDetails>{mapDetailsLine(map)}</MapDetails>
        </MapNameBlock>
        <IconButton
          icon={<MaterialIcon icon='info' size={20} />}
          title='Map details'
          ariaLabel='Map details'
          onClick={() => logAction('openMapDetails', map.id)}
        />
      </MapNameRow>
    </>
  )
}

// --- slot rows ---------------------------------------------------------------------------------

const Row = styled.div<{ $self?: boolean; $muted?: boolean }>`
  min-height: 40px;
  margin-bottom: 6px;
  padding: 4px 4px 4px 8px;

  display: flex;
  align-items: center;
  gap: 6px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border: 1px solid transparent;
  border-radius: 6px;

  ${props =>
    props.$self
      ? css`
          border-color: var(--color-blue70);
          background-color: rgb(from var(--color-blue70) r g b / 0.12);
        `
      : css``}

  opacity: ${props => (props.$muted ? 0.6 : 1)};
`

const OpenRow = styled(Row)<{ $static?: boolean }>`
  background-color: transparent;
  border: 1px dashed var(--theme-outline);
  cursor: ${props => (props.$static ? 'default' : 'pointer')};

  &:hover {
    background-color: ${props =>
      props.$static ? 'transparent' : 'rgb(from var(--theme-on-surface) r g b / 0.04)'};
  }
`

const ClosedRow = styled(Row)`
  background-color: transparent;
  border-color: transparent;
`

const BenchRowRoot = styled(Row)`
  background-color: rgb(from var(--theme-amber) r g b / 0.08);
  border: 1px dashed rgb(from var(--theme-amber) r g b / 0.6);
`

const RowAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const SeatIcon = styled.div<{ $dashed?: boolean }>`
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px ${props => (props.$dashed ? 'dashed' : 'solid')}
    rgb(from var(--theme-on-surface) r g b / 0.24);
  border-radius: 50%;
  color: var(--theme-on-surface-variant);
`

const RowName = styled.div`
  ${titleSmall};
  ${singleLine};

  min-width: 0;
`

const EmptyRowName = styled(RowName)`
  color: rgb(from var(--theme-on-surface) r g b / 0.5);
`

const RowSpacer = styled.div`
  flex-grow: 1;
`

const RacePicker = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 2px;
`

const MenuButton = styled(IconButton)`
  width: 28px;
  min-height: 28px;
  flex-shrink: 0;
  padding: 0;
`

/** Holds the trailing menu column open on rows the viewer has no actions for. */
const MenuSpacer = styled.div`
  width: 28px;
  flex-shrink: 0;
`

const LoadedMark = styled.div`
  ${labelMedium};

  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-positive);
  letter-spacing: 0.06em;
`

const loadingSlide = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
`

const LoadingTrack = styled.div`
  width: 88px;
  height: 4px;
  flex-shrink: 0;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.16);
  border-radius: 2px;
  contain: paint;
`

const LoadingFill = styled.div`
  width: 40%;
  height: 100%;

  animation: ${loadingSlide} 1.4s ease-in-out infinite;
  background-color: var(--color-blue70);
  border-radius: 2px;
`

const RACE_PICKER_ORDER: ReadonlyArray<RaceChar> = ['z', 'p', 't', 'r']

/** The viewer's own seat carries the race picker inline, so picking never leaves the roster. */
function RowRace({ view, slot }: { view: LobbyView; slot: Slot }) {
  if (slot.type === SlotType.Observer) {
    return null
  }
  if (slot.userId !== view.viewer.userId || view.lifecycle !== 'gathering') {
    return <RaceBadge race={slot.race} />
  }

  return (
    <RacePicker>
      {RACE_PICKER_ORDER.map(race => (
        <RaceBadge
          key={race}
          race={race}
          selected={race === slot.race}
          dimmed={race !== slot.race}
          small={true}
          title={`Pick ${race.toUpperCase()}`}
          onClick={() => logAction('pickRace', race)}
        />
      ))}
    </RacePicker>
  )
}

function RowStatus({ view, slot }: { view: LobbyView; slot: Slot }) {
  const userId = slot.userId

  if (view.lifecycle === 'launching') {
    const loaded = userId !== undefined && view.data.launch!.loadedUserIds.includes(userId)
    return loaded ? (
      <LoadedMark>
        <MaterialIcon icon='check' size={16} />
        LOADED
      </LoadedMark>
    ) : (
      <LoadingTrack>
        <LoadingFill />
      </LoadingTrack>
    )
  }

  return (
    <>
      <RowRace view={view} slot={slot} />
      {view.readyChecks && view.lifecycle === 'gathering' && userId !== undefined ? (
        <ReadyMark ready={view.readyUserIds.has(userId)} />
      ) : null}
    </>
  )
}

const ObserverEye = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

function OccupiedRow({ view, slot }: { view: LobbyView; slot: Slot }) {
  const isSelf = slot.userId === view.viewer.userId
  const isHostSlot = slot.id === view.lobby.host.id
  const hostActions = view.viewer.isHost && view.lifecycle !== 'launching'

  if (isComputerSeat(slot)) {
    return (
      <Row>
        <SeatIcon>
          <MaterialIcon icon='smart_toy' size={16} />
        </SeatIcon>
        <RowName>Computer</RowName>
        <RowSpacer />
        <RaceBadge race={slot.race} />
        {hostActions ? (
          <MenuButton
            icon={<MaterialIcon icon='more_vert' size={20} />}
            title='Computer actions'
            ariaLabel='Computer actions'
            onClick={() => logAction('computerActions', slot.id)}
          />
        ) : (
          <MenuSpacer />
        )}
      </Row>
    )
  }

  return (
    <Row $self={isSelf}>
      <RowAvatar userId={slot.userId!} />
      <RowName>
        <ConnectedUsername userId={slot.userId!} interactive={false} />
      </RowName>
      {isHostSlot ? <HostBadge>HOST</HostBadge> : null}
      {slot.type === SlotType.Observer ? <ObserverEye icon='visibility' size={16} /> : null}
      <RowSpacer />
      <RowStatus view={view} slot={slot} />
      {hostActions || (isSelf && view.lifecycle !== 'launching') ? (
        <MenuButton
          icon={<MaterialIcon icon='more_vert' size={20} />}
          title='Player actions'
          ariaLabel='Player actions'
          onClick={() => logAction('playerActions', slot.id)}
        />
      ) : (
        <MenuSpacer />
      )}
    </Row>
  )
}

function EmptyRow({ view, slot, seatNumber }: { view: LobbyView; slot: Slot; seatNumber: number }) {
  const hostActions = view.viewer.isHost && view.lifecycle !== 'launching'
  const menu = hostActions ? (
    <MenuButton
      icon={<MaterialIcon icon='more_vert' size={20} />}
      title='Slot actions'
      ariaLabel='Slot actions'
      onClick={() => logAction('slotActions', slot.id)}
    />
  ) : (
    <MenuSpacer />
  )

  if (isClosedSeat(slot)) {
    return (
      <ClosedRow>
        <SeatIcon>
          <MaterialIcon icon='block' size={16} />
        </SeatIcon>
        <EmptyRowName>Closed</EmptyRowName>
        <RowSpacer />
        {menu}
      </ClosedRow>
    )
  }

  // The seat only takes sitters while the lobby is a lobby: mid-launch its layout is what the game
  // is being built from.
  const canSit = view.lifecycle !== 'launching' && view.lifecycle !== 'inGame'

  return (
    <OpenRow $static={!canSit} onClick={canSit ? () => logAction('sitHere', slot.id) : undefined}>
      <SeatIcon $dashed={true}>
        <MaterialIcon icon='add' size={16} />
      </SeatIcon>
      <EmptyRowName>
        {canSit ? `Sit here — slot ${seatNumber}` : `Open slot ${seatNumber}`}
      </EmptyRowName>
      <RowSpacer />
      {menu}
    </OpenRow>
  )
}

function TeamSection({ view, team, index }: { view: LobbyView; team: Team; index: number }) {
  return (
    <>
      <SectionLabel>{teamLabel(team, index)}</SectionLabel>
      {team.slots.map((slot, slotIndex) =>
        isEmptySeat(slot) ? (
          <EmptyRow key={slot.id} view={view} slot={slot} seatNumber={slotIndex + 1} />
        ) : (
          <OccupiedRow key={slot.id} view={view} slot={slot} />
        ),
      )}
    </>
  )
}

const BenchNote = styled.div`
  ${labelMedium};

  min-width: 0;
  flex-grow: 1;

  color: var(--theme-on-surface-variant);
`

const SeatNowButton = styled(TextButton)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

function BenchRow({
  view,
  benched,
  first,
}: {
  view: LobbyView
  benched: BenchedUser
  first: boolean
}) {
  const isSelf = benched.userId === view.viewer.userId

  return (
    <BenchRowRoot>
      <RowAvatar userId={benched.userId} />
      <RowName>
        <ConnectedUsername userId={benched.userId} interactive={false} />
      </RowName>
      {first ? <BenchNote>joined while slots were full — next opening is theirs</BenchNote> : null}
      <RowSpacer />
      {isSelf ? (
        <SeatNowButton label='SEAT NOW' onClick={() => logAction('seatNow', benched.userId)} />
      ) : null}
    </BenchRowRoot>
  )
}

// --- rail foot ---------------------------------------------------------------------------------

const Foot = styled.div`
  flex-shrink: 0;
  padding: 12px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  border-top: 1px solid var(--theme-outline-variant);
`

const ReadyLine = styled.div`
  ${labelLarge};
`

const ReadyTrack = styled.div`
  height: 4px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.16);
  border-radius: 2px;
`

const ReadyFill = styled.div`
  height: 100%;

  background-color: var(--theme-positive);
  border-radius: 2px;
  transition: width 200ms linear;
`

const FootNote = styled.div`
  ${labelMedium};

  color: rgb(from var(--theme-on-surface) r g b / 0.5);
`

const WaitingNote = styled.div`
  ${labelLarge};

  padding-block: 8px;

  color: var(--theme-on-surface-variant);
`

const StartButton = styled(FilledButton)`
  width: 100%;
  min-height: 44px;
`

const CountdownRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const CountdownNumeral = styled.div`
  ${displaySmall};

  min-width: 48px;

  color: var(--theme-amber);
  font-variant-numeric: tabular-nums;
  text-align: center;
`

const CountdownNote = styled.div`
  ${labelMedium};

  flex-grow: 1;

  color: var(--theme-on-surface-variant);
`

const BottomActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const BottomButton = styled(OutlinedButton)`
  width: 100%;
`

function StartArea({ view }: { view: LobbyView }) {
  const [countdown, setCountdown] = useState<number | undefined>(undefined)
  const allReady = isEveryoneReady(view)
  const readyCount = getReadyCount(view)

  useEffect(() => {
    if (countdown === undefined) {
      return () => {}
    }

    const timer = setTimeout(() => {
      setCountdown(countdown > 1 ? countdown - 1 : undefined)
    }, 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  if (countdown !== undefined) {
    return (
      <CountdownRow>
        <CountdownNumeral>{countdown}</CountdownNumeral>
        <CountdownNote>Starting — nobody gets to change anything now</CountdownNote>
        {view.viewer.isHost ? (
          <TextButton label='CANCEL' onClick={() => setCountdown(undefined)} />
        ) : null}
      </CountdownRow>
    )
  }

  if (!view.readyChecks) {
    return view.viewer.isHost ? (
      <>
        <StartButton label='START GAME' onClick={() => setCountdown(BLIND_COUNTDOWN_SECONDS)} />
        <FootNote>
          Everyone gets a {BLIND_COUNTDOWN_SECONDS}-second countdown — no ready check
        </FootNote>
      </>
    ) : (
      <WaitingNote>Waiting for the host to start</WaitingNote>
    )
  }

  return (
    <>
      <ReadyLine>
        {readyCount} of {view.participants.length} ready
      </ReadyLine>
      <ReadyTrack>
        <ReadyFill style={{ width: `${(readyCount / view.participants.length) * 100}%` }} />
      </ReadyTrack>
      {view.viewer.isHost ? (
        <>
          <StartButton
            label={allReady ? 'START GAME' : 'START WHEN READY'}
            onClick={() => logAction('startGame')}
          />
          <FootNote>Enables when everyone's ready · or hold to force-start now</FootNote>
        </>
      ) : (
        <WaitingNote>Waiting for the host to start</WaitingNote>
      )}
    </>
  )
}

/**
 * The lobby's roster, which is also its slot layout: the map everyone's about to play heads it,
 * every seat below is a real target (sit in it, pick your race in it, run host actions on it), and
 * the foot holds the one thing that turns the room into a game.
 */
export function RosterRail({ view }: { view: LobbyView }) {
  const { lobby, lifecycle, viewer } = view
  const playerTeams = lobby.teams.filter(team => !team.isObserver)
  const observers = getObserverSlots(lobby)
  const { open } = getSeatCounts(lobby)

  return (
    <Rail>
      <RailBody>
        <MapCard view={view} />
        {playerTeams.map((team, i) => (
          <TeamSection key={team.teamId} view={view} team={team} index={i} />
        ))}

        <SectionLabel>
          Watching · {observers.length}/{MAX_OBSERVERS}
          <SectionNote>— observers pick this role themselves, host can move anyone</SectionNote>
        </SectionLabel>
        {observers.map(slot => (
          <OccupiedRow key={slot.id} view={view} slot={slot} />
        ))}

        {lobby.bench.length > 0 ? (
          <>
            <SectionLabel $amber={true}>Waiting for a seat · {lobby.bench.length}</SectionLabel>
            {lobby.bench.map((benched, i) => (
              <BenchRow key={benched.userId} view={view} benched={benched} first={i === 0} />
            ))}
          </>
        ) : null}
      </RailBody>

      {lifecycle !== 'launching' ? (
        <Foot>
          {lifecycle === 'gathering' ? <StartArea view={view} /> : null}
          <BottomActions>
            {!viewer.isObserver && !viewer.isBenched ? (
              <BottomButton
                label='SWITCH TO WATCHING'
                iconStart={<MaterialIcon icon='visibility' size={20} />}
                onClick={() => logAction('switchToWatching')}
              />
            ) : null}
            <BottomButton
              label='INVITE'
              iconStart={<MaterialIcon icon='link' size={20} />}
              onClick={() => logAction('invite', { openSeats: open })}
            />
          </BottomActions>
        </Foot>
      ) : null}
    </Rail>
  )
}
