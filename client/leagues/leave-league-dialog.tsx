import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LeagueId } from '../../common/leagues/leagues'
import { SbUserId } from '../../common/users/sb-user-id'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import logger from '../logging/logger'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge } from '../styles/typography'
import { adminRemoveLeagueUser, leaveLeague } from './action-creators'

export function LeaveLeagueDialog({
  leagueId,
  userId,
  onRemoved,
  onCancel,
}: CommonDialogProps & { leagueId: LeagueId; userId?: SbUserId; onRemoved: () => void }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbar = useSnackbarController()
  const [isRemoving, setIsRemoving] = useState(false)
  const actionLabel = userId
    ? t('leagues.remove.action', 'Remove from league')
    : t('leagues.leave.action', 'Leave league')

  const onConfirm = () => {
    if (isRemoving) return
    setIsRemoving(true)
    const spec = {
      onSuccess() {
        onRemoved()
        dispatch(closeDialog(DialogType.LeaveLeague))
        snackbar.showSnackbar(
          userId
            ? t('leagues.remove.success', 'Player removed from league')
            : t('leagues.leave.success', 'League left'),
        )
      },
      onError(err: Error) {
        setIsRemoving(false)
        snackbar.showSnackbar(
          t('leagues.leave.error', 'Could not remove league membership. Please try again.'),
        )
        logger.error(`Error removing league membership: ${String(err.stack ?? err)}`)
      },
    }
    dispatch(userId ? adminRemoveLeagueUser(leagueId, userId, spec) : leaveLeague(leagueId, spec))
  }

  return (
    <Dialog
      title={actionLabel}
      onCancel={isRemoving ? undefined : onCancel}
      buttons={[
        <TextButton
          key='cancel'
          label={t('common.actions.cancel', 'Cancel')}
          disabled={isRemoving}
          onClick={onCancel}
        />,
        <TextButton key='confirm' label={actionLabel} disabled={isRemoving} onClick={onConfirm} />,
      ]}>
      <BodyLarge>
        {userId
          ? t(
              'leagues.remove.confirm',
              'This player will be removed from the leaderboard and forfeit all league points and stats. They can rejoin before the league ends, starting from zero. Any league ban will still apply.',
            )
          : t(
              'leagues.leave.confirm',
              'You will be removed from the leaderboard and forfeit all your league points and stats. You can rejoin before the league ends, starting from zero. Any league ban will still apply.',
            )}
      </BodyLarge>
    </Dialog>
  )
}
