import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation } from 'urql'
import { SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { graphql } from '../gql'
import { MapFamilyReportKind } from '../gql/graphql'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { RadioButton, RadioGroup } from '../material/radio'
import { TextField } from '../material/text-field'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { MapFamilyCandidate, MapFamilySearch } from './map-family-search'

/** Keep in sync with `MAX_REPORT_NOTE_LENGTH` on the server (maps/families/edit.rs). */
const MAX_NOTE_LENGTH = 500

const ReportMutation = graphql(/* GraphQL */ `
  mutation MapFamilyReport($input: MapFamilyReportInput!) {
    mapFamilyReport(input: $input) {
      id
      status
    }
  }
`)

function errorMessage(error: CombinedError, t: TFunction): string {
  switch (error.graphQLErrors[0]?.extensions?.code) {
    case 'RATE_LIMITED':
      return t(
        'maps.report.rateLimited',
        "You've sent too many reports recently. Please try again later.",
      )
    case 'RESTRICTED':
      return t('maps.report.restricted', 'You are currently restricted from reporting.')
    default:
      return t('maps.report.error', 'Something went wrong. Please try again later.')
  }
}

function noteTooLong(note: string): boolean {
  // Counts code points (not UTF-16 units) to match the server's chars().count()
  return [...note].length > MAX_NOTE_LENGTH
}

const StyledDialog = styled(Dialog)`
  max-width: 560px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Intro = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

export interface MapFamilyReportDialogProps extends CommonDialogProps {
  familyId: string
  fileId: SbMapId
  /** How many of the map's files the reporter can see. */
  fileCount: number
}

type ReportKind = 'wrongMap' | 'sameMap'

/**
 * Tells staff that the file being viewed isn't part of the map it's in, or that its map is the
 * same as another map. Nothing changes until staff look at it.
 */
export function MapFamilyReportDialog({
  familyId,
  fileId,
  fileCount,
  onCancel,
  close,
}: MapFamilyReportDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [chosenKind, setChosenKind] = useState<ReportKind>()
  const [picked, setPicked] = useState<MapFamilyCandidate>()
  const [note, setNote] = useState('')
  const [submitError, setSubmitError] = useState<string>()
  const [{ fetching: sending }, report] = useMutation(ReportMutation)

  // A map with a single file has no file that could be in the wrong map
  const canReportWrongMap = fileCount > 1
  const kind = canReportWrongMap ? chosenKind : 'sameMap'
  const wrongMapLabel = t('maps.report.wrongMapOption', "This file doesn't belong in this map")
  const sameMapLabel = t('maps.report.sameMapOption', 'This map is the same as another map')

  const onSubmit = () => {
    if (!kind || (kind === 'sameMap' && !picked)) {
      return
    }
    setSubmitError(undefined)
    report({
      input:
        kind === 'wrongMap'
          ? { kind: MapFamilyReportKind.WrongMap, mapId: fileId, note: note.trim() || undefined }
          : {
              kind: MapFamilyReportKind.SameMap,
              familyId,
              otherFamilyId: picked!.familyId,
              note: note.trim() || undefined,
            },
    })
      .then(result => {
        if (result.error) {
          setSubmitError(errorMessage(result.error, t))
          return
        }
        snackbarController.showSnackbar(t('maps.report.sent', 'Thanks! Staff will take a look.'))
        close()
      })
      .catch(() =>
        setSubmitError(t('maps.report.error', 'Something went wrong. Please try again later.')),
      )
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={sending}
      onClick={onCancel}
    />,
    <TextButton
      key='submit'
      label={t('maps.report.send', 'Send to staff')}
      disabled={sending || noteTooLong(note) || !kind || (kind === 'sameMap' && !picked)}
      onClick={onSubmit}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.report.title', 'Report a problem')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {submitError ? <ErrorText>{submitError}</ErrorText> : null}
        {canReportWrongMap ? (
          <RadioGroup
            value={chosenKind}
            dense={true}
            onChange={e => setChosenKind(e.target.value as ReportKind)}>
            {[
              <RadioButton
                key='wrongMap'
                value='wrongMap'
                label={wrongMapLabel}
                disabled={sending}
              />,
              <RadioButton key='sameMap' value='sameMap' label={sameMapLabel} disabled={sending} />,
            ]}
          </RadioGroup>
        ) : (
          <Intro>{sameMapLabel}</Intro>
        )}
        {kind === 'sameMap' ? (
          <MapFamilySearch
            picked={picked}
            onPick={setPicked}
            excludeFamilyId={familyId}
            disabled={sending}
          />
        ) : null}
        <TextField
          label={t('maps.report.note', 'Anything staff should know? (optional)')}
          multiline={true}
          rows={2}
          maxRows={6}
          value={note}
          disabled={sending}
          errorText={
            noteTooLong(note)
              ? t('maps.report.noteTooLong', {
                  defaultValue: 'Keep it under {{max}} characters.',
                  max: MAX_NOTE_LENGTH,
                })
              : undefined
          }
          onChange={e => setNote(e.target.value)}
        />
      </Layout>
    </StyledDialog>
  )
}
