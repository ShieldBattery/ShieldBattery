import React, { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm } from '../forms/form-hook'
import { required } from '../forms/validators'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { useStableCallback } from '../state-hooks'
import { BodyLarge, bodyLarge, labelMedium } from '../styles/typography'
import { reportBug } from './action-creators'

const StyledDialog = styled(Dialog)`
  max-width: 640px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const LogUploadDescription = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

interface BugReportFormModel {
  details: string
}

export function BugReportDialog(props: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error>()

  const onFormSubmit = useStableCallback(({ details }: BugReportFormModel) => {
    setError(undefined)
    setLoading(true)
    dispatch(
      reportBug(
        { details },
        {
          onSuccess: () => {
            setLoading(false)
            props.onCancel()
            snackbarController.showSnackbar(t('bugReport.reportSubmitted', 'Bug report submitted.'))
          },
          onError: err => {
            setLoading(false)
            setError(err)
          },
        },
      ),
    )
  })

  const { onSubmit, bindInput } = useForm<BugReportFormModel>(
    {
      details: '',
    },
    {
      details: required(t => t('bugReport.detailsRequired', 'Bug reports must include details.')),
    },
    { onSubmit: onFormSubmit },
  )

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      color='accent'
      onClick={props.onCancel}
      disabled={loading}
    />,
    <TextButton
      label={t('common.actions.submit', 'Submit')}
      key='submit'
      color='accent'
      onClick={onSubmit}
      disabled={loading}
    />,
  ]

  return (
    <StyledDialog
      title={t('bugReport.title', 'Report a bug')}
      buttons={buttons}
      onCancel={props.onCancel}
      dialogRef={props.dialogRef}>
      <form noValidate={true} onSubmit={onSubmit}>
        <Layout>
          {error ? (
            <ErrorText>
              <Trans t={t} i18nKey='bugReport.error'>
                Error:{' '}
                {{
                  errorMessage: error.message,
                }}
              </Trans>
            </ErrorText>
          ) : undefined}

          <BodyLarge>
            {t(
              'bugReport.detailsDescription',
              'Please describe the bug and provide as much detail as possible about what you ' +
                'were doing when the bug occurred.',
            )}
          </BodyLarge>
          <TextField
            {...bindInput('details')}
            multiline={true}
            allowErrors={true}
            rows={4}
            maxRows={12}
            floatingLabel={true}
            label={t('bugReport.details', 'Details')}
            disabled={loading}
          />
          <LogUploadDescription>
            {t(
              'bugReport.logUploadDescription',
              'Your bug report will include ShieldBattery logs from your machine to help ' +
                'diagnose the issue. Logs may be kept for up to 30 days and are viewable only by ' +
                'ShieldBattery staff.',
            )}
          </LogUploadDescription>
          {
            /* TODO(tec27): Some better treatment that doesn't cause a layout shift */
            loading ? <LoadingDotsArea /> : undefined
          }
        </Layout>
      </form>
    </StyledDialog>
  )
}
