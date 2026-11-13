import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { urlForMapCollection, urlForMapCollections } from '../../common/map-url'
import { makeMapCollectionId } from '../../common/maps'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { graphql } from '../gql'
import { TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { push } from '../navigation/routing'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { collectionChangeErrorText, MapCollectionUpdateMutation } from './map-collection-actions'
import {
  isValidCollectionTitle,
  MAX_COLLECTION_DESCRIPTION_LENGTH,
  MAX_COLLECTION_NOTE_LENGTH,
  MAX_COLLECTION_TITLE_LENGTH,
  textLength,
} from './map-collection-text'

const MapCollectionCreateMutation = graphql(/* GraphQL */ `
  mutation MapCollectionCreate($title: String!, $staff: Boolean!) {
    mapCollectionCreate(title: $title, staff: $staff) {
      id
      kind
      title
    }
  }
`)

const MapCollectionDeleteMutation = graphql(/* GraphQL */ `
  mutation MapCollectionDelete($id: UUID!) {
    mapCollectionDelete(id: $id)
  }
`)

const MapCollectionReportMutation = graphql(/* GraphQL */ `
  mutation MapCollectionReport($id: UUID!, $note: String!) {
    mapCollectionReport(id: $id, note: $note) {
      id
    }
  }
`)

/** Selects what a collection's views show about it being hidden, so they update from the result. */
const MapCollectionHideMutation = graphql(/* GraphQL */ `
  mutation MapCollectionHide($id: UUID!, $note: String!) {
    mapCollectionHide(id: $id, note: $note) {
      id
      public
      hidden {
        id
        note
        hiddenAt
      }
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

const BodyText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

function titleTooLong(title: string): boolean {
  return textLength(title.trim()) > MAX_COLLECTION_TITLE_LENGTH
}

/**
 * Makes a collection of the viewer's, asking for its title, and opens it. Staff can make a staff
 * collection instead.
 */
export function MapCollectionCreateDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const [title, setTitle] = useState('')
  const [staff, setStaff] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()
  const [{ fetching }, create] = useMutation(MapCollectionCreateMutation)
  const canCreate = !fetching && isValidCollectionTitle(title)

  const onCreate = () => {
    if (!canCreate) {
      return
    }
    setErrorMessage(undefined)
    create({ title: title.trim(), staff: canManageMaps && staff })
      .then(result => {
        if (result.error || !result.data) {
          setErrorMessage(collectionChangeErrorText(result.error, 'create', t))
          return
        }
        const created = result.data.mapCollectionCreate
        close()
        push(urlForMapCollection(makeMapCollectionId(created.id), created.title ?? undefined))
      })
      .catch(swallowNonBuiltins)
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={fetching}
      onClick={onCancel}
    />,
    <TextButton
      key='create'
      label={t('maps.collections.create', 'Create')}
      disabled={!canCreate}
      onClick={onCreate}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.collections.newCollection', 'New collection')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <TextField
          label={t('maps.collections.titleLabel', 'Title')}
          value={title}
          maxLength={MAX_COLLECTION_TITLE_LENGTH}
          disabled={fetching}
          errorText={
            titleTooLong(title)
              ? t('maps.collections.titleTooLong', {
                  defaultValue: 'Keep it under {{max}} characters.',
                  max: MAX_COLLECTION_TITLE_LENGTH,
                })
              : undefined
          }
          inputProps={{ autoFocus: true }}
          onChange={e => setTitle(e.target.value)}
          onEnterKeyDown={onCreate}
        />
        {canManageMaps ? (
          // Only staff make staff collections, so this isn't translated
          <CheckBox
            checked={staff}
            label='Staff collection, shown to everyone'
            disabled={fetching}
            onChange={e => setStaff(e.target.checked)}
          />
        ) : null}
      </Layout>
    </StyledDialog>
  )
}

export interface MapCollectionEditDialogProps extends CommonDialogProps {
  collectionId: string
  title: string
  description: string
}

/** Changes a collection's title and description. */
export function MapCollectionEditDialog({
  collectionId,
  title: initialTitle,
  description: initialDescription,
  onCancel,
  close,
}: MapCollectionEditDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [errorMessage, setErrorMessage] = useState<string>()
  const [{ fetching }, update] = useMutation(MapCollectionUpdateMutation)
  const descriptionTooLong = textLength(description.trim()) > MAX_COLLECTION_DESCRIPTION_LENGTH
  const canSave = !fetching && isValidCollectionTitle(title) && !descriptionTooLong

  const onSave = () => {
    if (!canSave) {
      return
    }
    setErrorMessage(undefined)
    update({ id: collectionId, title: title.trim(), description: description.trim() })
      .then(result => {
        if (result.error || !result.data) {
          setErrorMessage(collectionChangeErrorText(result.error, 'edit', t))
          return
        }
        close()
      })
      .catch(swallowNonBuiltins)
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={fetching}
      onClick={onCancel}
    />,
    <TextButton
      key='save'
      label={t('common.actions.save', 'Save')}
      disabled={!canSave}
      onClick={onSave}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.collections.editDetails', 'Edit details')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <TextField
          label={t('maps.collections.titleLabel', 'Title')}
          value={title}
          maxLength={MAX_COLLECTION_TITLE_LENGTH}
          disabled={fetching}
          errorText={
            titleTooLong(title)
              ? t('maps.collections.titleTooLong', {
                  defaultValue: 'Keep it under {{max}} characters.',
                  max: MAX_COLLECTION_TITLE_LENGTH,
                })
              : undefined
          }
          onChange={e => setTitle(e.target.value)}
        />
        <TextField
          label={t('maps.collections.descriptionLabel', 'Description (optional)')}
          value={description}
          multiline={true}
          rows={3}
          maxRows={8}
          maxLength={MAX_COLLECTION_DESCRIPTION_LENGTH}
          disabled={fetching}
          onChange={e => setDescription(e.target.value)}
        />
      </Layout>
    </StyledDialog>
  )
}

export interface MapCollectionDeleteDialogProps extends CommonDialogProps {
  collectionId: string
  /** The collection's title, as the viewer sees it. */
  title: string
  /** How many maps the viewer sees in it. */
  mapCount: number
}

/** Deletes a collection once the viewer confirms, then goes to the Collections tab. */
export function MapCollectionDeleteDialog({
  collectionId,
  title,
  mapCount,
  onCancel,
  close,
}: MapCollectionDeleteDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [{ fetching }, deleteCollection] = useMutation(MapCollectionDeleteMutation)

  const onDelete = () => {
    setErrorMessage(undefined)
    deleteCollection({ id: collectionId })
      .then(result => {
        if (result.error) {
          setErrorMessage(collectionChangeErrorText(result.error, 'delete', t))
          return
        }
        close()
        push(urlForMapCollections())
        snackbarController.showSnackbar(t('maps.collections.deleted', 'Collection deleted'))
      })
      .catch(swallowNonBuiltins)
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={fetching}
      onClick={onCancel}
    />,
    <TextButton
      key='delete'
      label={t('common.actions.delete', 'Delete')}
      disabled={fetching}
      onClick={onDelete}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.collections.deleteTitle', { defaultValue: 'Delete {{title}}?', title })}
      buttons={buttons}
      onCancel={onCancel}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <BodyText>
          {t('maps.collections.deleteText', {
            defaultValue: 'This deletes the collection and its list of {{count}} maps.',
            defaultValue_one: 'This deletes the collection and its list of {{count}} map.',
            count: mapCount,
          })}
        </BodyText>
      </Layout>
    </StyledDialog>
  )
}

export interface MapCollectionReportDialogProps extends CommonDialogProps {
  collectionId: string
}

/** Tells staff something is wrong with a player's public collection. */
export function MapCollectionReportDialog({
  collectionId,
  onCancel,
  close,
}: MapCollectionReportDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [note, setNote] = useState('')
  const [errorMessage, setErrorMessage] = useState<string>()
  const [{ fetching }, report] = useMutation(MapCollectionReportMutation)
  const noteTooLong = textLength(note.trim()) > MAX_COLLECTION_NOTE_LENGTH
  const canSend = !fetching && !!note.trim() && !noteTooLong

  const onSend = () => {
    if (!canSend) {
      return
    }
    setErrorMessage(undefined)
    report({ id: collectionId, note: note.trim() })
      .then(result => {
        if (result.error) {
          setErrorMessage(collectionChangeErrorText(result.error, 'report', t))
          return
        }
        snackbarController.showSnackbar(t('maps.report.sent', 'Thanks! Staff will take a look.'))
        close()
      })
      .catch(swallowNonBuiltins)
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={fetching}
      onClick={onCancel}
    />,
    <TextButton
      key='send'
      label={t('maps.report.send', 'Send to staff')}
      disabled={!canSend}
      onClick={onSend}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.report.title', 'Report a problem')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <TextField
          label={t('maps.collections.reportNote', "What's wrong with this collection?")}
          value={note}
          multiline={true}
          rows={2}
          maxRows={6}
          maxLength={MAX_COLLECTION_NOTE_LENGTH}
          disabled={fetching}
          inputProps={{ autoFocus: true }}
          onChange={e => setNote(e.target.value)}
        />
      </Layout>
    </StyledDialog>
  )
}

export interface MapCollectionHideDialogProps extends CommonDialogProps {
  collectionId: string
  /** The collection's title. */
  title: string
}

/**
 * Hides a player's collection as staff, with a note its owner sees. Hiding resolves the
 * collection's open reports. Only staff hide collections, so this dialog isn't translated.
 */
export function MapCollectionHideDialog({
  collectionId,
  title,
  onCancel,
  close,
}: MapCollectionHideDialogProps) {
  const snackbarController = useSnackbarController()
  const [note, setNote] = useState('')
  const [errorMessage, setErrorMessage] = useState<string>()
  const [{ fetching }, hide] = useMutation(MapCollectionHideMutation)
  const noteTooLong = textLength(note.trim()) > MAX_COLLECTION_NOTE_LENGTH
  const canHide = !fetching && !!note.trim() && !noteTooLong

  const onHide = () => {
    if (!canHide) {
      return
    }
    setErrorMessage(undefined)
    hide({ id: collectionId, note: note.trim() })
      .then(result => {
        if (result.error) {
          setErrorMessage(
            result.error.graphQLErrors[0]?.message ?? 'Something went wrong. Please try again.',
          )
          return
        }
        close()
        snackbarController.showSnackbar('Hidden')
      })
      .catch(swallowNonBuiltins)
  }

  const buttons = [
    <TextButton key='cancel' label='Cancel' disabled={fetching} onClick={onCancel} />,
    <TextButton key='hide' label='Hide' disabled={!canHide} onClick={onHide} />,
  ]

  return (
    <StyledDialog
      title={`Hide ${title}?`}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <BodyText>Only its owner and staff will see it, until staff unhide it.</BodyText>
        <TextField
          label='Note for the owner'
          value={note}
          multiline={true}
          rows={2}
          maxRows={6}
          maxLength={MAX_COLLECTION_NOTE_LENGTH}
          disabled={fetching}
          inputProps={{ autoFocus: true }}
          onChange={e => setNote(e.target.value)}
        />
      </Layout>
    </StyledDialog>
  )
}
