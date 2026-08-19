import { CSSProperties, useEffect } from 'react'
import { GameType } from '../../../common/games/game-type'
import { BenchedUser, Lobby, Team } from '../../../common/lobbies'
import { LobbyVisibility } from '../../../common/lobbies/lobby-visibility'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { createHuman, Slot } from '../../../common/lobbies/slot'
import { MapInfo } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { SbUser, SelfUserJson } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { FightingSpirit, loadMapsForTesting } from '../../maps/devonly/maps-for-testing'
import { useAppDispatch } from '../../redux-hooks'
import LobbyComponent, { LobbyProps } from '../lobby'
import { LobbyLoadingState } from '../lobby-reducer'

const MOCK_MAP: MapInfo = { ...FightingSpirit, uploadDate: new Date(FightingSpirit.uploadDate) }

const SLOT_USERS: ReadonlyArray<{ user: SbUser; race: RaceChar }> = [
  { user: { id: makeSbUserId(1), name: 'tec27', created: 0 }, race: 'p' },
  { user: { id: makeSbUserId(2), name: '2Pacalypse-', created: 0 }, race: 't' },
  { user: { id: makeSbUserId(3), name: 'dronebabo', created: 0 }, race: 'z' },
  { user: { id: makeSbUserId(4), name: 'pachi', created: 0 }, race: 'r' },
  { user: { id: makeSbUserId(5), name: 'Heyoka', created: 0 }, race: 'r' },
  { user: { id: makeSbUserId(6), name: 'Legionnaire', created: 0 }, race: 'p' },
  { user: { id: makeSbUserId(7), name: 'boesthius', created: 0 }, race: 't' },
  { user: { id: makeSbUserId(8), name: 'harem', created: 0 }, race: 'z' },
]

const BENCH_USERS: ReadonlyArray<SbUser> = [
  { id: makeSbUserId(9), name: 'Flash', created: 0 },
  { id: makeSbUserId(10), name: 'Bisu', created: 0 },
]

const ALL_MOCK_USERS: SbUser[] = [...SLOT_USERS.map(({ user }) => user), ...BENCH_USERS]

const USER: SelfUserJson = {
  id: SLOT_USERS[0].user.id,
  name: SLOT_USERS[0].user.name,
  created: 0,
  loginName: SLOT_USERS[0].user.name,
  email: 'tec27@example.org',
  emailVerified: true,
  acceptedPrivacyVersion: 1,
  acceptedTermsVersion: 1,
  acceptedUsePolicyVersion: 1,
  nameChangeTokens: 0,
}

const LOADING_STATE: LobbyLoadingState = {
  isCountingDown: false,
  countdownTimer: -1,
  isLoading: false,
}

function makeBenchedUser(userId: SbUserId, race: RaceChar): BenchedUser {
  return { userId, race, joinedAt: Date.now() }
}

function makeLobby(
  numSlots: number,
  options: { visibility?: LobbyVisibility; bench?: BenchedUser[] } = {},
): Lobby {
  const slots: Slot[] = SLOT_USERS.slice(0, numSlots).map(({ user, race }) =>
    createHuman(user.id, race),
  )
  const team: Team = {
    teamId: 0,
    name: 'Team 1',
    isObserver: false,
    slots,
    hiddenSlots: [],
  }

  return {
    id: makeSbLobbyId(`mock-lobby-${numSlots}`),
    name: `My ${numSlots}-slot Lobby`,
    map: MOCK_MAP,
    gameType: GameType.Melee,
    gameSubType: 0,
    createdAt: 1722500000000,
    teams: [team],
    bench: options.bench ?? [],
    host: slots[0],
    useLegacyLimits: false,
    visibility: options.visibility ?? 'listed',
  }
}

const LOBBIES: Lobby[] = Array.from({ length: 7 }, (_, i) => i + 2).map(numSlots => {
  if (numSlots === 8) {
    // Full teams and a benched user waiting for a seat.
    return makeLobby(numSlots, { bench: [makeBenchedUser(BENCH_USERS[0].id, 'z')] })
  }
  if (numSlots === 4) {
    return makeLobby(numSlots, { bench: [makeBenchedUser(BENCH_USERS[1].id, 'p')] })
  }
  if (numSlots === 3) {
    return makeLobby(numSlots, { visibility: 'unlisted' })
  }
  return makeLobby(numSlots)
})

const HANDLERS: Omit<LobbyProps, 'lobby' | 'loadingState' | 'chat' | 'user'> = {
  onLeaveLobbyClick: () => console.log('onLeaveLobbyClick'),
  onSetRace: (slotId, race) => console.log('onSetRace', slotId, race),
  onAddComputer: slotId => console.log('onAddComputer', slotId),
  onSendChatMessage: msg => console.log('onSendChatMessage', msg),
  onSwitchSlot: slotId => console.log('onSwitchSlot', slotId),
  onOpenSlot: slotId => console.log('onOpenSlot', slotId),
  onCloseSlot: slotId => console.log('onCloseSlot', slotId),
  onKickPlayer: slotId => console.log('onKickPlayer', slotId),
  onBanPlayer: slotId => console.log('onBanPlayer', slotId),
  onMakeObserver: slotId => console.log('onMakeObserver', slotId),
  onRemoveObserver: slotId => console.log('onRemoveObserver', slotId),
  onMoveSlot: slotId => console.log('onMoveSlot', slotId),
  onMapPreview: () => console.log('onMapPreview'),
  onStartGame: () => console.log('onStartGame'),
  onOpenLobbySettings: () => console.log('onOpenLobbySettings'),
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexFlow: 'row wrap',
  justifyContent: 'space-around',
  padding: 8,
}

const cellStyle: CSSProperties = {
  width: 400,
  height: 360,
  border: '1px solid rgba(255,255,255,0.12)',
  margin: '4px',
  overflow: 'hidden',
}

const scaledStyle: CSSProperties = {
  width: 800,
  height: 720,
  transformOrigin: '0 0',
  transform: 'scale(0.5)',
}

export default function LobbyTest() {
  const dispatch = useAppDispatch()

  useEffect(() => {
    dispatch(loadMapsForTesting())
    dispatch({ type: '@users/loadUsers', payload: ALL_MOCK_USERS })
  }, [dispatch])

  return (
    <div style={containerStyle}>
      {LOBBIES.map(lobby => (
        <div key={lobby.id} style={cellStyle}>
          <div style={scaledStyle}>
            <LobbyComponent
              lobby={lobby}
              user={USER}
              chat={[]}
              loadingState={LOADING_STATE}
              {...HANDLERS}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
