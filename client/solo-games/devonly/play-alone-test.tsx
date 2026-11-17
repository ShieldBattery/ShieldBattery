import { useState } from 'react'
import styled from 'styled-components'
import { makeSbMapId, MapForce, MapForcePlayer, MapInfoJson } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { ScenarioPicker } from '../../lobbies/devonly/scenario-picker'
import { BigGameHunters, FightingSpirit } from '../../maps/devonly/maps-for-testing'
import { BodyMedium } from '../../styles/typography'
import { PlayAloneBusyReason, PlayAloneDialogView, PlayAloneMapState } from '../play-alone-dialog'

type ScenarioId = 'oneSlot' | 'twoForces' | 'hiddenSlots' | 'notPlayable' | 'loading' | 'error'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'oneSlot', label: 'One slot, fixed race' },
  { id: 'twoForces', label: 'Two human forces, free races' },
  { id: 'hiddenSlots', label: 'Hidden slots' },
  { id: 'notPlayable', label: "Can't be played alone" },
  { id: 'loading', label: 'Loading' },
  { id: 'error', label: 'Load error' },
]

type BusyId = 'none' | PlayAloneBusyReason

const BUSY: ReadonlyArray<{ id: BusyId; label: string }> = [
  { id: 'none', label: 'Free' },
  { id: 'inLobby', label: 'In a lobby' },
  { id: 'searching', label: 'Searching' },
  { id: 'inGame', label: 'In a game' },
]

function human(id: number, race: MapForcePlayer['race'] = 'any'): MapForcePlayer {
  return { id, race, typeId: 6, computer: false }
}

function computer(id: number, race: RaceChar = 'z', typeId = 5): MapForcePlayer {
  return { id, race, typeId, computer: true }
}

function umsMap(
  base: MapInfoJson,
  id: string,
  name: string,
  umsForces: MapForce[],
  kind: MapInfoJson['kind'] = 'ums',
): MapInfoJson {
  return {
    ...base,
    id: makeSbMapId(id),
    name,
    kind,
    mapData: { ...base.mapData, umsForces },
  }
}

const MAPS: Record<'oneSlot' | 'twoForces' | 'hiddenSlots' | 'notPlayable', MapInfoJson> = {
  oneSlot: umsMap(FightingSpirit, 'f00d0000-0000-4000-8000-0000000050a1', 'Marine Survival', [
    { name: 'Survivor', teamId: 1, players: [human(0, 't')] },
    {
      name: 'Horde',
      teamId: 2,
      players: [computer(1), computer(2), computer(3), computer(4, 'p')],
    },
  ]),
  twoForces: umsMap(
    BigGameHunters,
    'f00d0000-0000-4000-8000-0000000050a2',
    '\x03Tower \x04Defense 2v2',
    [
      { name: 'North', teamId: 1, players: [human(0), human(1)] },
      { name: 'South', teamId: 2, players: [human(2), human(3, 'p')] },
      { name: 'Creeps', teamId: 3, players: [computer(4), computer(5), computer(6)] },
    ],
  ),
  hiddenSlots: umsMap(FightingSpirit, 'f00d0000-0000-4000-8000-0000000050a3', 'Rescue Op', [
    { name: '', teamId: 1, players: [human(0), human(1, 'z')] },
    {
      name: 'Enemies',
      teamId: 2,
      // A rescuable and a neutral slot, which the summary leaves out
      players: [computer(2), computer(3, 't', 3), computer(4, 'p', 7)],
    },
  ]),
  notPlayable: umsMap(FightingSpirit, 'f00d0000-0000-4000-8000-0000000050a4', 'Team Melee Only', [
    { name: 'Team 1', teamId: 1, players: [human(0), human(1)] },
    { name: 'Team 2', teamId: 2, players: [human(2), human(3)] },
  ]),
}

const Controls = styled.div`
  padding-bottom: 16px;
`

const LastStart = styled(BodyMedium)`
  margin: 16px 16px 0;
  color: var(--theme-on-surface-variant);
`

export function PlayAloneTest() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('oneSlot')
  const [busyId, setBusyId] = useState<BusyId>('none')
  const [lastStart, setLastStart] = useState<string>()

  let mapState: PlayAloneMapState
  switch (scenarioId) {
    case 'loading':
      mapState = { kind: 'loading' }
      break
    case 'error':
      mapState = { kind: 'error', onRetry: () => setScenarioId('loading') }
      break
    default:
      mapState = { kind: 'loaded', map: MAPS[scenarioId] }
  }

  return (
    <>
      <Controls>
        <ScenarioPicker scenarios={SCENARIOS} active={scenarioId} onChange={setScenarioId} />
        <ScenarioPicker scenarios={BUSY} active={busyId} onChange={setBusyId} label='Activity' />
        <LastStart>{lastStart ? `Started: ${lastStart}` : 'Not started yet'}</LastStart>
      </Controls>
      <PlayAloneDialogView
        key={scenarioId}
        mapState={mapState}
        busyReason={busyId === 'none' ? undefined : busyId}
        onStart={(slot, race) => setLastStart(`slot ${slot}, race ${race ?? '(map)'}`)}
        onCancel={() => setLastStart('canceled')}
      />
    </>
  )
}
