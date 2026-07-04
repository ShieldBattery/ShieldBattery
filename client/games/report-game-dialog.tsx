import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { required } from '../forms/validators'
import { graphql } from '../gql'
import { GameReportReason } from '../gql/graphql'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge, bodyLarge } from '../styles/typography'

const ReportGameMutation = graphql(/* GraphQL */ `
  mutation ReportGame($input: ReportGameInput!) {
    reportGame(input: $input) {
      id
    }
  }
`)

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

/** Keep in sync with MAX_DETAILS_LEN on the server (game_reports.rs). */
const MAX_DETAILS_LENGTH = 5000

interface ReportGameFormModel {
  reportedUserId?: SbUserId
  reason?: GameReportReason
  details: string
}

export interface ReportGameDialogProps extends CommonDialogProps {
  gameId: string
  /** The other (non-computer) players in the game — the candidates that can be reported. */
  reportedUserCandidates: SbUserId[]
}

export function ReportGameDialog({
  gameId,
  reportedUserCandidates,
  onCancel,
  close,
}: ReportGameDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const usersById = useAppSelector(s => s.users.byId)
  const [{ fetching }, reportGame] = useMutation(ReportGameMutation)
  const [errorMessage, setErrorMessage] = useState<string>()

  const { submit, bindCustom, bindInput, getInputValue, setInputValue, form } =
    useForm<ReportGameFormModel>(
      {
        // Pre-select the only opponent when there's just one (e.g. a 1v1).
        reportedUserId: reportedUserCandidates.length === 1 ? reportedUserCandidates[0] : undefined,
        reason: undefined,
        details: '',
      },
      {
        reportedUserId: required(t =>
          t('gameReport.reportedUserRequired', 'Please choose a player to report.'),
        ),
        reason: required(t => t('gameReport.reasonRequired', 'Please choose a reason.')),
        details: (value, model, _dirty, t) => {
          if (model.reason === GameReportReason.Other && !value.trim()) {
            return t('gameReport.detailsRequiredForOther', 'Please describe what happened.')
          }
          // Count code points (not UTF-16 units) to match the server's chars().count() exactly.
          if ([...value].length > MAX_DETAILS_LENGTH) {
            return t('gameReport.detailsTooLong', 'Details must be {{max}} characters or fewer.', {
              max: MAX_DETAILS_LENGTH,
            })
          }
          return undefined
        },
      },
    )

  useFormCallbacks(form, {
    onSubmit: model => {
      setErrorMessage(undefined)
      reportGame({
        input: {
          gameId,
          reportedUserId: model.reportedUserId!,
          reason: model.reason!,
          details: model.details.trim() ? model.details.trim() : undefined,
        },
      })
        .then(result => {
          if (result.error) {
            const code = result.error.graphQLErrors?.[0]?.extensions?.code
            if (code === 'ALREADY_REPORTED') {
              setErrorMessage(
                t(
                  'gameReport.alreadyReported',
                  "You've already reported this player for this game.",
                ),
              )
            } else if (code === 'RESTRICTED') {
              setErrorMessage(
                t('gameReport.restricted', 'You are currently restricted from reporting.'),
              )
            } else if (code === 'RATE_LIMITED') {
              setErrorMessage(
                t(
                  'gameReport.rateLimited',
                  "You've filed too many reports recently. Please try again later.",
                ),
              )
            } else if (code === 'BAD_REQUEST') {
              setErrorMessage(
                t(
                  'gameReport.badRequest',
                  'Your report could not be submitted. Please check the details and try again.',
                ),
              )
            } else {
              setErrorMessage(
                t(
                  'gameReport.error',
                  'Something went wrong submitting your report. Please try again later.',
                ),
              )
            }
            return
          }

          snackbarController.showSnackbar(t('gameReport.submitted', 'Report submitted.'))
          close()
        })
        .catch(swallowNonBuiltins)
    },
  })

  const reasonOptions: Array<[reason: GameReportReason, label: string]> = [
    [GameReportReason.Cheating, t('gameReport.reason.cheating', 'Cheating or exploiting')],
    [GameReportReason.Abandoning, t('gameReport.reason.abandoning', 'Left the game')],
    [GameReportReason.Griefing, t('gameReport.reason.griefing', 'Griefing')],
    [GameReportReason.AbusiveChat, t('gameReport.reason.abusiveChat', 'Abusive chat')],
    [GameReportReason.Other, t('gameReport.reason.other', 'Other')],
  ]

  const detailsRequired = getInputValue('reason') === GameReportReason.Other

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={fetching}
    />,
    <TextButton
      label={t('common.actions.submit', 'Submit')}
      key='submit'
      onClick={submit}
      disabled={fetching}
    />,
  ]

  return (
    <StyledDialog
      title={t('gameReport.title', 'Report a player')}
      buttons={buttons}
      onCancel={onCancel}>
      <form noValidate={true} onSubmit={submit}>
        <Layout>
          {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : undefined}

          <BodyLarge>
            {t(
              'gameReport.description',
              'Report a player for breaking the rules in this game. Reports are reviewed by ' +
                'ShieldBattery staff.',
            )}
          </BodyLarge>

          <Select
            {...bindCustom('reportedUserId')}
            label={t('gameReport.reportedUser', 'Player')}
            tabIndex={0}
            disabled={fetching}>
            {reportedUserCandidates.map(id => (
              <SelectOption
                key={id}
                value={id}
                text={usersById.get(id)?.name ?? t('gameReport.unknownPlayer', 'Unknown player')}
              />
            ))}
          </Select>

          <Select
            {...bindCustom('reason')}
            label={t('gameReport.reasonLabel', 'Reason')}
            tabIndex={0}
            disabled={fetching}
            onChange={value => {
              bindCustom('reason').onChange(value)
              // `details` is only required for the Other reason, and the form re-validates just the
              // dirty fields on change — so re-touch `details` to clear a stale "required" error
              // (e.g. left by a submit attempt) when the reason switches to one that doesn't need
              // it. Skipped when switching *to* Other, since re-touching would mark `details` dirty
              // and surface the required error before the user has typed anything.
              if (value !== GameReportReason.Other) {
                setInputValue('details', getInputValue('details'))
              }
            }}>
            {reasonOptions.map(([value, label]) => (
              <SelectOption key={value} value={value} text={label} />
            ))}
          </Select>

          <TextField
            {...bindInput('details')}
            multiline={true}
            allowErrors={true}
            rows={3}
            maxRows={8}
            floatingLabel={true}
            label={
              detailsRequired
                ? t('gameReport.details', 'Details')
                : t('gameReport.detailsOptional', 'Details (optional)')
            }
            disabled={fetching}
          />
        </Layout>
      </form>
    </StyledDialog>
  )
}
