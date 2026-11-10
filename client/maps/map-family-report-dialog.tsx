import { TFunction } from 'i18next'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { graphql } from '../gql'
import { MapFamilyReportKind } from '../gql/graphql'
import { TransInterpolation } from '../i18n/i18next'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { MapFamilyCandidate, MapFamilySearch } from './map-family-search'

/** Keep in sync with `MAX_REPORT_NOTE_LENGTH` on the server (maps/families/edit.rs). */
const MAX_NOTE_LENGTH = 500

const MapFamilyReportDialogQuery = graphql(/* GraphQL */ `
  query MapFamilyReportDialog($familyId: UUID!, $fileId: SbMapId!) {
    mapFamily(id: $familyId) {
      id
      family {
        id
        name
      }
    }
    map(id: $fileId) {
      id
      name
    }
  }
`)

const ReportMutation = graphql(/* GraphQL */ `
  mutation MapFamilyReport($input: MapFamilyReportInput!) {
    mapFamilyReport(input: $input) {
      id
      status
    }
  }
`)

/**
 * Requests results without suspending: the dialog renders its own loading state. Module-level so
 * the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

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
  overflow-wrap: anywhere;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

export interface MapFamilyReportDialogProps extends CommonDialogProps {
  kind: 'wrongMap' | 'sameMap'
  familyId: string
  fileId: SbMapId
}

/**
 * Tells staff that a file isn't part of the map it's in (`wrongMap`), or that a map is the same as
 * another map (`sameMap`). Nothing changes until staff look at it.
 */
export function MapFamilyReportDialog({
  kind,
  familyId,
  fileId,
  onCancel,
  close,
}: MapFamilyReportDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [{ data, error }, refetch] = useQuery({
    query: MapFamilyReportDialogQuery,
    variables: { familyId, fileId },
    context: NO_SUSPENSE_CONTEXT,
  })
  const [picked, setPicked] = useState<MapFamilyCandidate>()
  const [note, setNote] = useState('')
  const [submitError, setSubmitError] = useState<string>()
  const [{ fetching: sending }, report] = useMutation(ReportMutation)

  const title =
    kind === 'wrongMap'
      ? t('maps.report.wrongMapTitle', "This file isn't part of this map")
      : t('maps.report.sameMapTitle', 'This map is the same as…')

  const family = data?.mapFamily?.family
  const file = data?.map
  if (!family || !file) {
    return (
      <StyledDialog title={title} onCancel={onCancel} showCloseButton={true}>
        {error || data ? (
          <LoadErrorRow
            message={t('maps.page.loadError', "Couldn't load this map")}
            onRetry={() => refetch({ requestPolicy: 'network-only' })}
          />
        ) : (
          <LoadingDotsArea />
        )}
      </StyledDialog>
    )
  }

  const mapName = filterColorCodes(family.name)
  const fileName = filterColorCodes(file.name)

  const onSubmit = () => {
    if (kind === 'sameMap' && !picked) {
      setSubmitError(t('maps.report.pickRequired', 'Pick the map it’s the same as.'))
      return
    }
    setSubmitError(undefined)
    report({
      input:
        kind === 'wrongMap'
          ? { kind: MapFamilyReportKind.WrongMap, mapId: fileId, note: note.trim() || undefined }
          : {
              kind: MapFamilyReportKind.SameMap,
              familyId: family.id,
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
      disabled={sending || noteTooLong(note) || (kind === 'sameMap' && !picked)}
      onClick={onSubmit}
    />,
  ]

  return (
    <StyledDialog title={title} buttons={buttons} onCancel={onCancel} showCloseButton={true}>
      <Layout>
        {submitError ? <ErrorText>{submitError}</ErrorText> : null}
        <Intro>
          {kind === 'wrongMap' ? (
            <Trans t={t} i18nKey='maps.report.wrongMapIntro'>
              Tell staff that the file <strong>{{ fileName } as TransInterpolation}</strong> doesn’t
              belong with the other files of <strong>{{ mapName } as TransInterpolation}</strong>.
              Nothing changes until staff check it.
            </Trans>
          ) : (
            <Trans t={t} i18nKey='maps.report.sameMapIntro'>
              Tell staff that <strong>{{ mapName } as TransInterpolation}</strong> is the same map
              as another one, so they can combine them. Nothing changes until staff check it.
            </Trans>
          )}
        </Intro>
        {kind === 'sameMap' ? (
          <MapFamilySearch
            picked={picked}
            onPick={setPicked}
            excludeFamilyId={family.id}
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
