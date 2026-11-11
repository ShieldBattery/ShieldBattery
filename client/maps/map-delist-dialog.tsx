import { useState } from 'react'
import styled from 'styled-components'
import { useMutation } from 'urql'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { graphql } from '../gql'
import { MapFamilyReportStatus } from '../gql/graphql'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { useSetReportStatus } from './map-report-status'

// Only staff delist files, so this dialog isn't translated.

/** Keep in sync with `MAX_DELIST_NOTE_LENGTH` on the server (maps/families/publish.rs). */
const MAX_NOTE_LENGTH = 500

/** Selects what the views of a file show about its listing, so they update from the result. */
const DelistMutation = graphql(/* GraphQL */ `
  mutation MapDelist($fileId: SbMapId!, $note: String) {
    mapDelist(fileId: $fileId, note: $note) {
      id
      listed
      publishedAt
      publisher {
        id
        name
      }
      moderation {
        id
        publishedAt
        delistedAt
        delistedKind
        delistedNote
        delistedBy {
          id
          name
        }
      }
    }
  }
`)

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

const Text = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

export interface MapDelistDialogProps extends CommonDialogProps {
  fileId: SbMapId
  /** The file's name. */
  name: string
  /** Whether the file is listed right now. */
  listed: boolean
  /** A map report to resolve once the file is delisted. */
  reportId?: string
}

/**
 * Takes a file out of the listings as staff, or keeps an unlisted file from being published, with
 * an optional note for its publisher. When opened for a report, delisting also resolves the report.
 */
export function MapDelistDialog({
  fileId,
  name,
  listed,
  reportId,
  onCancel,
  close,
}: MapDelistDialogProps) {
  const snackbarController = useSnackbarController()
  const setReportStatus = useSetReportStatus()
  const [note, setNote] = useState('')
  const [errorMessage, setErrorMessage] = useState<string>()
  const [{ fetching: sending }, delist] = useMutation(DelistMutation)

  const onDelist = () => {
    setErrorMessage(undefined)
    delist({ fileId, note: note.trim() || undefined })
      .then(async result => {
        if (result.error || !result.data) {
          setErrorMessage(
            result.error?.graphQLErrors[0]?.message ??
              result.error?.message ??
              'Something went wrong. Please try again.',
          )
          return
        }
        let message = 'Delisted'
        if (reportId) {
          try {
            await setReportStatus(reportId, MapFamilyReportStatus.Resolved)
            message = 'Delisted and resolved the report'
          } catch (err) {
            message = `Delisted, but couldn't resolve the report: ${(err as Error).message}`
          }
        }
        close()
        snackbarController.showSnackbar(message)
      })
      .catch((err: Error) => setErrorMessage(err.message))
  }

  const buttons = [
    <TextButton key='cancel' label='Cancel' disabled={sending} onClick={onCancel} />,
    <TextButton
      key='delist'
      label='Delist'
      disabled={sending || noteTooLong(note)}
      onClick={onDelist}
    />,
  ]

  return (
    <StyledDialog
      title={`Delist ${filterColorCodes(name).trim()}?`}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <Text>
          {listed
            ? 'Takes this file out of the listings. Only staff can list it again.'
            : "Players won't be able to publish this file."}
        </Text>
        <TextField
          label={listed ? 'Note for the publisher (optional)' : 'Note (optional)'}
          multiline={true}
          rows={2}
          maxRows={6}
          value={note}
          disabled={sending}
          errorText={noteTooLong(note) ? `Keep it under ${MAX_NOTE_LENGTH} characters.` : undefined}
          onChange={e => setNote(e.target.value)}
        />
      </Layout>
    </StyledDialog>
  )
}
