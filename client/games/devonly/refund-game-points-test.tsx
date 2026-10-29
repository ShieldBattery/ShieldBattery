import { makeSbUserId } from '../../../common/users/sb-user-id'
import { RefundGamePointsDialog } from '../refund-game-points-dialog'

const noop = () => {}

const ONE_V_ONE = [
  [{ id: makeSbUserId(1), name: 'Flash' }],
  [{ id: makeSbUserId(2), name: 'Jaedong' }],
]

const TWO_V_TWO = [
  [
    { id: makeSbUserId(1), name: 'Flash' },
    { id: makeSbUserId(3), name: 'Bisu' },
  ],
  [
    { id: makeSbUserId(2), name: 'Jaedong' },
    { id: makeSbUserId(4), name: 'Stork' },
  ],
]

export function RefundFromResultsTest() {
  return <RefundGamePointsDialog gameId='dev-game' teams={ONE_V_ONE} onCancel={noop} close={noop} />
}

export function RefundTeamGameTest() {
  return (
    <RefundGamePointsDialog
      gameId='dev-game'
      teams={TWO_V_TWO}
      initialPunishedIds={[makeSbUserId(3)]}
      onCancel={noop}
      close={noop}
    />
  )
}

export function RefundFromReportTest() {
  return (
    <RefundGamePointsDialog
      gameId='dev-game'
      teams={ONE_V_ONE}
      initialPunishedIds={[makeSbUserId(2)]}
      onCancel={noop}
      close={noop}
    />
  )
}
