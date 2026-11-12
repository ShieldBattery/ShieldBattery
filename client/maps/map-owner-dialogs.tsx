import * as React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useClient, useMutation, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserErrorCode } from '../../common/users/user-network'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useSelfUser } from '../auth/auth-utils'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { graphql, useFragment } from '../gql'
import {
  MapDelistedKind,
  MapOwnerAddFileLibraryQuery,
  MapOwnerKind,
  MapPublishAnswerKind,
} from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { LoadErrorRow } from '../lists/load-error-row'
import { OutlinedButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { findUserByName } from '../users/action-creators'
import { ConnectedUsername } from '../users/connected-username'
import { mapUploadErrorMessage } from './action-creators'
import { AddFileFacts, addFileUnavailableText, joinedMessage, planAddFile } from './map-add-file'
import { MapFileImage } from './map-image'
import { MakeRecommendedCheckBox, useMakeRecommended } from './map-make-recommended'
import {
  claimErrorText,
  errorCode,
  MapOwner_FamilyOwnerFragment,
  MAX_CLAIM_NOTE_LENGTH,
  MAX_CREDIT_LENGTH,
  ownerErrorText,
  serverErrorText,
  textLength,
  useClaimMapOwner,
  useRemoveMapOwner,
} from './map-owner-actions'
import { publishErrorText, publishGenericErrorText } from './map-publish'
import { MAP_FILE_EXTENSIONS, uploadStatusText, useAddMapFileToLibrary } from './map-uploads'

/**
 * Requests results without suspending: the dialogs render their own loading states. Module-level
 * so the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const StyledDialog = styled(Dialog)`
  max-width: 560px;
`

const AddFileDialog = styled(Dialog)`
  max-width: 640px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const BodyText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface);
  overflow-wrap: anywhere;
`

const MutedText = styled.span`
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const MutedBody = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export interface MapOwnerClaimDialogProps extends CommonDialogProps {
  familyId: string
  /** The name of the map's current owner, if it has one. */
  ownerName?: string
}

/** Sends staff a user's claim to be the maker of a map, with a note saying how to tell. */
export function MapOwnerClaimDialog({
  familyId,
  ownerName,
  onCancel,
  close,
}: MapOwnerClaimDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [claim, sending] = useClaimMapOwner()
  const [note, setNote] = useState('')
  const [errorMessage, setErrorMessage] = useState<string>()

  const tooLong = textLength(note) > MAX_CLAIM_NOTE_LENGTH
  const onSend = () => {
    setErrorMessage(undefined)
    claim(familyId, note.trim())
      .then(granted => {
        close()
        snackbarController.showSnackbar(
          granted
            ? t('maps.owner.claimGranted', "You're now this map's maker.")
            : t('maps.owner.claimSent', 'Claim sent to staff.'),
        )
      })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof CombinedError ? claimErrorText(err, t) : ownerErrorText(t))
      })
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={sending}
      onClick={onCancel}
    />,
    <TextButton
      key='send'
      label={t('maps.owner.sendClaim', 'Send to staff')}
      disabled={sending || !note.trim() || tooLong}
      onClick={onSend}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.owner.claimTitle', 'I made this map')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        {ownerName ? (
          <MutedBody>
            {t('maps.owner.listedAsMaker', '{{name}} is listed as its maker.', {
              name: ownerName,
            })}
          </MutedBody>
        ) : null}
        <TextField
          label={t('maps.owner.claimNote', "How can staff tell it's yours?")}
          multiline={true}
          rows={3}
          maxRows={8}
          value={note}
          disabled={sending}
          errorText={
            tooLong
              ? t('maps.report.noteTooLong', {
                  defaultValue: 'Keep it under {{max}} characters.',
                  max: MAX_CLAIM_NOTE_LENGTH,
                })
              : undefined
          }
          onChange={e => setNote(e.target.value)}
        />
      </Layout>
    </StyledDialog>
  )
}

export interface MapOwnerRelinquishDialogProps extends CommonDialogProps {
  /** Gives up the ownership once the user confirms. */
  onConfirm: () => void
}

/** Confirms giving up a map that staff confirmed the user made. */
export function MapOwnerRelinquishDialog({
  onConfirm,
  onCancel,
  close,
}: MapOwnerRelinquishDialogProps) {
  const { t } = useTranslation()
  const buttons = [
    <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
    <TextButton
      key='confirm'
      label={t('maps.owner.relinquishConfirm', 'Remove')}
      onClick={() => {
        close()
        onConfirm()
      }}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.owner.relinquish', 'Remove me as maker')}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyText>
        {t(
          'maps.owner.relinquishVerified',
          "Staff confirmed you as this map's maker. Getting it back would need staff again.",
        )}
      </BodyText>
    </StyledDialog>
  )
}

// Only staff change a map's owner or credit, so what follows up to the next dialog isn't translated.

const MapOwnerEditFamilyQuery = graphql(/* GraphQL */ `
  query MapOwnerEditFamily($id: UUID!) {
    mapFamily(id: $id) {
      id
      family {
        id
        name
        ...MapOwner_FamilyOwnerFragment
      }
    }
  }
`)

const SetOwnerMutation = graphql(/* GraphQL */ `
  mutation MapFamilySetOwner($familyId: UUID!, $userId: SbUserId!) {
    mapFamilySetOwner(familyId: $familyId, userId: $userId) {
      id
      ...MapOwner_FamilyOwnerFragment
    }
  }
`)

const SetCreditMutation = graphql(/* GraphQL */ `
  mutation MapFamilySetCredit($familyId: UUID!, $credit: String) {
    mapFamilySetCredit(familyId: $familyId, credit: $credit) {
      id
      ...MapOwner_FamilyOwnerFragment
    }
  }
`)

const setAtFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface);
`

const SectionLine = styled.div`
  min-height: 40px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 4px;

  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`

const SectionValue = styled.span`
  color: var(--theme-on-surface);
`

/** Pushes the button after it to the end of its line. */
const LineSpacer = styled.div`
  flex-grow: 1;
`

const FieldRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;

  & > :first-child {
    flex-grow: 1;
  }
`

/** Lines a button up with the dense text field next to it. */
const FieldButton = styled(OutlinedButton)`
  flex-shrink: 0;
  margin-top: 2px;
`

export interface MapOwnerEditDialogProps extends CommonDialogProps {
  familyId: string
}

/**
 * Changes who made a map as staff: its owner, set by username or removed, and the maker's name it's
 * credited to. Each change applies on its own, and the dialog shows the map as it is afterwards.
 */
export function MapOwnerEditDialog({ familyId, onCancel }: MapOwnerEditDialogProps) {
  const dispatch = useAppDispatch()
  const setAtDate = useFormat(setAtFormat)
  const [{ data, error }, refetch] = useQuery({
    query: MapOwnerEditFamilyQuery,
    variables: { id: familyId },
    requestPolicy: 'network-only',
    context: NO_SUSPENSE_CONTEXT,
  })
  const family = data?.mapFamily?.family
  const owner = useFragment(MapOwner_FamilyOwnerFragment, family)
  const [{ fetching: settingOwner }, setOwner] = useMutation(SetOwnerMutation)
  const [{ fetching: settingCredit }, setCredit] = useMutation(SetCreditMutation)
  const [removeOwner, removingOwner] = useRemoveMapOwner()
  const [lookingUp, setLookingUp] = useState(false)
  const [username, setUsername] = useState('')
  // The credit field starts out as the map's credit once that loads
  const [creditInput, setCreditInput] = useState<string>()
  const [errorMessage, setErrorMessage] = useState<string>()

  const pending = settingOwner || settingCredit || removingOwner || lookingUp
  const buttons = [<TextButton key='close' label='Close' onClick={onCancel} />]

  if (!family || !owner) {
    return (
      <StyledDialog title='Maker' buttons={buttons} onCancel={onCancel} showCloseButton={true}>
        {error || data ? (
          <LoadErrorRow
            message="Couldn't load this map"
            onRetry={() => refetch({ requestPolicy: 'network-only' })}
          />
        ) : (
          <LoadingDotsArea />
        )}
      </StyledDialog>
    )
  }

  const credit = creditInput ?? owner.credit ?? ''
  const creditTooLong = textLength(credit.trim()) > MAX_CREDIT_LENGTH

  const onSetOwner = () => {
    const name = username.trim()
    if (!name) {
      return
    }
    setErrorMessage(undefined)
    setLookingUp(true)
    dispatch(
      findUserByName(name, {
        onSuccess: user => {
          setLookingUp(false)
          setOwner({ familyId: family.id, userId: user.id })
            .then(result => {
              if (result.error) {
                setErrorMessage(`Couldn't set the maker: ${serverErrorText(result.error)}`)
              } else {
                setUsername('')
              }
            })
            .catch(swallowNonBuiltins)
        },
        onError: err => {
          setLookingUp(false)
          setErrorMessage(
            isFetchError(err) && err.code === UserErrorCode.NotFound
              ? `No user is named ${name}`
              : `Couldn't look up ${name}: ${err.message}`,
          )
        },
      }),
    )
  }

  const onRemoveOwner = () => {
    setErrorMessage(undefined)
    removeOwner(family.id).catch((err: Error) =>
      setErrorMessage(`Couldn't remove the maker: ${err.message}`),
    )
  }

  const onSaveCredit = () => {
    setErrorMessage(undefined)
    const text = credit.trim()
    setCredit({ familyId: family.id, credit: text || undefined })
      .then(result => {
        if (result.error) {
          setErrorMessage(`Couldn't save the credit: ${serverErrorText(result.error)}`)
        } else {
          setCreditInput(undefined)
        }
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <StyledDialog
      title={`Maker of ${filterColorCodes(family.name)}`}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <Section>
          <SectionTitle>Maker</SectionTitle>
          <SectionLine>
            {owner.owner ? (
              <>
                <ConnectedUsername userId={owner.owner.id} />
                <span>
                  {owner.ownerKind === MapOwnerKind.Staff ? '· Verified' : '· Claimed'}
                  {owner.ownerSetAt ? ` ${setAtDate.format(new Date(owner.ownerSetAt))}` : ''}
                </span>
                <LineSpacer />
                <TextButton label='Remove maker' disabled={pending} onClick={onRemoveOwner} />
              </>
            ) : (
              <MutedText>No maker</MutedText>
            )}
          </SectionLine>
          <FieldRow>
            <TextField
              label='Username'
              dense={true}
              allowErrors={false}
              value={username}
              disabled={pending}
              onChange={e => setUsername(e.target.value)}
              onEnterKeyDown={onSetOwner}
            />
            <FieldButton
              label='Set maker'
              disabled={pending || !username.trim()}
              onClick={onSetOwner}
            />
          </FieldRow>
        </Section>
        <Section>
          <SectionTitle>Credit</SectionTitle>
          <SectionLine>
            {owner.credit ? (
              <SectionValue>{owner.credit}</SectionValue>
            ) : (
              <MutedText>No credit</MutedText>
            )}
          </SectionLine>
          <FieldRow>
            <TextField
              label="Maker's name, for a maker with no account"
              dense={true}
              value={credit}
              disabled={pending}
              errorText={
                creditTooLong ? `Keep it under ${MAX_CREDIT_LENGTH} characters.` : undefined
              }
              onChange={e => setCreditInput(e.target.value)}
              onEnterKeyDown={onSaveCredit}
            />
            <FieldButton
              label='Save credit'
              disabled={pending || creditTooLong || credit.trim() === (owner.credit ?? '')}
              onClick={onSaveCredit}
            />
          </FieldRow>
        </Section>
      </Layout>
    </StyledDialog>
  )
}

/**
 * The viewer's library, newest first. A file's map is selected with what deciding how the file can
 * join another map needs (see {@link planAddFile}).
 */
const AddFileLibraryQuery = graphql(/* GraphQL */ `
  query MapOwnerAddFileLibrary($after: String, $first: Int, $canManageMaps: Boolean!) {
    currentUser {
      id
      mapLibrary(sort: NEWEST, after: $after, first: $first) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            name
            listed
            official
            playerCount
            publishedAt
            publisher {
              id
            }
            moderation @include(if: $canManageMaps) {
              id
              delistedKind
            }
            family {
              id
              name
              listed
              credit
              owner {
                id
              }
              files {
                id
              }
            }
            file {
              id
              width
              height
              ...MapFileImage_FileFragment
            }
          }
        }
      }
    }
  }
`)

/** A file the viewer just uploaded, selected as {@link AddFileLibraryQuery} selects its files. */
const AddFileUploadedQuery = graphql(/* GraphQL */ `
  query MapOwnerAddFileUploaded($id: SbMapId!, $canManageMaps: Boolean!) {
    map(id: $id) {
      id
      name
      listed
      official
      playerCount
      publishedAt
      publisher {
        id
      }
      moderation @include(if: $canManageMaps) {
        id
        delistedKind
      }
      family {
        id
        name
        listed
        credit
        owner {
          id
        }
        files {
          id
        }
      }
      file {
        id
        width
        height
        ...MapFileImage_FileFragment
      }
    }
  }
`)

const AddFileLinkMutation = graphql(/* GraphQL */ `
  mutation MapOwnerAddFileLink($fileId: SbMapId!, $familyId: UUID!) {
    mapFileLink(fileId: $fileId, familyId: $familyId) {
      id
      file {
        id
        family {
          id
          name
        }
      }
      family {
        id
        name
        current {
          id
        }
      }
      previousFamily {
        id
      }
    }
  }
`)

/** Selects what the views of the file show about its listing, so they update from the result. */
const AddFilePublishMutation = graphql(/* GraphQL */ `
  mutation MapOwnerAddFilePublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {
    mapPublish(fileId: $fileId, answer: $answer) {
      id
      heldForReview
      file {
        id
        listed
        publishedAt
        publisher {
          id
          name
        }
        family {
          id
          name
        }
      }
      family {
        id
        name
        current {
          id
        }
      }
    }
  }
`)

/** How many files of the viewer's library each page of the dialog looks through. */
const LIBRARY_PAGE_SIZE = 100

const publishedFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

const UploadRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
`

const HiddenFileInput = styled.input`
  display: none;
`

const FileGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const GroupLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const FileRow = styled.div`
  min-height: 48px;
  padding-block: 4px;

  display: flex;
  align-items: center;
  gap: 12px;
`

const FileThumbnail = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  overflow: hidden;

  border-radius: 4px;
  background-color: var(--theme-container-low);
`

const FileName = styled.div`
  ${titleSmall};
  ${singleLine};
  flex: 1 1 auto;
  min-width: 0;
`

const FileMeta = styled.div`
  ${bodySmall};
  flex-shrink: 0;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
`

/** A file of the viewer's library, as the dialog lists it. */
export type AddFileData = NonNullable<
  MapOwnerAddFileLibraryQuery['currentUser']
>['mapLibrary']['edges'][number]['node']

function addFileFacts(file: AddFileData): AddFileFacts {
  return {
    name: file.name,
    listed: file.listed,
    official: file.official,
    publisherId: file.publisher?.id,
    staffDelisted: file.moderation?.delistedKind === MapDelistedKind.Staff,
    family: {
      id: file.family.id,
      name: file.family.name,
      fileCount: file.family.files.length,
      listed: file.family.listed,
      ownerId: file.family.owner?.id,
      credited: !!file.family.credit,
    },
  }
}

/** What the add file dialog is doing. */
export type AddFileBusy =
  /** Uploading a file the viewer picked, with the fraction of it sent so far once that's known. */
  | { kind: 'uploading'; progress?: number }
  /** Adding a file to the map: one of the listed files, or (without `fileId`) the uploaded one. */
  | { kind: 'adding'; fileId?: SbMapId }

/** The viewer's library as the dialog has loaded it so far. */
export interface AddFileListing {
  files: ReadonlyArray<AddFileData>
  status: 'loading' | 'failed' | 'loaded'
  /** Set while there are older files to look through. */
  onLoadMore?: () => void
  onRetry: () => void
}

export interface MapOwnerAddFileDialogProps extends CommonDialogProps {
  familyId: string
  mapName: string
}

/**
 * Adds a file to a map the viewer owns: one they upload, a listed file of theirs that's alone in a
 * map of its own, or an unlisted one from their library, which is published into the map. The
 * file can become the map's recommended file along the way.
 */
export function MapOwnerAddFileDialog({
  familyId,
  mapName,
  onCancel,
  close,
}: MapOwnerAddFileDialogProps) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const client = useClient()
  const snackbarController = useSnackbarController()
  const addToLibrary = useAddMapFileToLibrary()
  const makeFileRecommended = useMakeRecommended()
  const [, link] = useMutation(AddFileLinkMutation)
  const [, publish] = useMutation(AddFilePublishMutation)
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  const [busy, setBusy] = useState<AddFileBusy>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [makeRecommended, setMakeRecommended] = useState(true)

  const fail = (message: string) => {
    setBusy(undefined)
    setErrorMessage(message)
  }

  const finishJoined = async (fileId: SbMapId) => {
    close()
    const recommended = await makeFileRecommended(fileId, makeRecommended)
    snackbarController.showSnackbar(joinedMessage({ mapName, recommended }, t))
  }

  const loadFile = async (id: SbMapId): Promise<AddFileData | undefined> => {
    const result = await client
      .query(AddFileUploadedQuery, { id, canManageMaps }, { requestPolicy: 'network-only' })
      .toPromise()
    return result.data?.map ?? undefined
  }

  /**
   * Adds `file` to the map as {@link planAddFile} says it can join. A file that turns out to have
   * been published meanwhile is looked at again, once, when `recheck` is set.
   */
  const addFile = async (file: AddFileData, recheck: boolean): Promise<void> => {
    if (!selfUser) {
      return
    }
    const plan = planAddFile(addFileFacts(file), familyId, selfUser.id)
    switch (plan.kind) {
      case 'alreadyHere':
        await finishJoined(file.id)
        return
      case 'unavailable':
        fail(addFileUnavailableText(plan, t))
        return
      case 'link': {
        const result = await link({ fileId: file.id, familyId })
        if (result.error || !result.data) {
          fail(publishErrorText(result.error ? errorCode(result.error) : undefined, t))
          return
        }
        await finishJoined(file.id)
        return
      }
      case 'publish': {
        const result = await publish({
          fileId: file.id,
          answer: {
            kind: plan.answer,
            familyId: plan.answer === MapPublishAnswerKind.Join ? familyId : undefined,
          },
        })
        if (result.error || !result.data) {
          fail(publishErrorText(result.error ? errorCode(result.error) : undefined, t))
          return
        }
        const published = result.data.mapPublish
        if (published.heldForReview) {
          close()
          snackbarController.showSnackbar(
            t(
              'maps.owner.addHeldForReview',
              "Sent to staff for review. It joins {{mapName}} once it's listed.",
              { mapName: filterColorCodes(mapName) },
            ),
          )
          return
        }
        if (published.family.id === familyId) {
          await finishJoined(file.id)
          return
        }
        // Publishing leaves a file that's already listed as it is
        const fresh = recheck ? await loadFile(file.id) : undefined
        if (fresh) {
          await addFile(fresh, false)
        } else {
          fail(
            addFileUnavailableText(
              { kind: 'unavailable', reason: 'listedElsewhere', mapName: published.family.name },
              t,
            ),
          )
        }
        return
      }
      default:
        plan satisfies never
    }
  }

  const onAdd = (file: AddFileData) => {
    setErrorMessage(undefined)
    setBusy({ kind: 'adding', fileId: file.id })
    addFile(file, true).catch(() => fail(publishGenericErrorText(t)))
  }

  const onUpload = (picked: File) => {
    setErrorMessage(undefined)
    setBusy({ kind: 'uploading' })
    addToLibrary(picked, progress => setBusy({ kind: 'uploading', progress }))
      .then(
        async ({ map }) => {
          setBusy({ kind: 'adding' })
          try {
            const file = await loadFile(map.id)
            if (file) {
              await addFile(file, true)
            } else {
              fail(publishGenericErrorText(t))
            }
          } catch {
            fail(publishGenericErrorText(t))
          }
        },
        (err: unknown) => fail(mapUploadErrorMessage(err)),
      )
      .catch(swallowNonBuiltins)
  }

  return (
    <MapOwnerAddFileFrame mapName={mapName} busy={busy} onCancel={onCancel}>
      {selfUser ? (
        <LibraryPages
          cursors={pageCursors}
          index={0}
          before={[]}
          canManageMaps={canManageMaps}
          onLoadMore={endCursor =>
            setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
          }>
          {listing => (
            <MapOwnerAddFileBody
              familyId={familyId}
              viewerId={selfUser.id}
              listing={listing}
              busy={busy}
              errorMessage={errorMessage}
              makeRecommended={makeRecommended}
              onMakeRecommendedChange={setMakeRecommended}
              onUpload={onUpload}
              onAdd={onAdd}
            />
          )}
        </LibraryPages>
      ) : null}
    </MapOwnerAddFileFrame>
  )
}

/**
 * The pages of the viewer's library that the dialog has asked for, from `index` on, each loaded
 * after the ones before it (whose files come in `before`). The last page renders the listing.
 */
function LibraryPages({
  cursors,
  index,
  before,
  canManageMaps,
  onLoadMore,
  children,
}: {
  cursors: ReadonlyArray<string | null>
  index: number
  before: ReadonlyArray<AddFileData>
  canManageMaps: boolean
  onLoadMore: (endCursor: string) => void
  children: (listing: AddFileListing) => React.ReactNode
}) {
  const [{ data, error }, refetch] = useQuery({
    query: AddFileLibraryQuery,
    variables: { after: cursors[index] ?? undefined, first: LIBRARY_PAGE_SIZE, canManageMaps },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  const onRetry = () => refetch({ requestPolicy: 'network-only' })
  const connection = data?.currentUser?.mapLibrary
  if (!connection) {
    return children({ files: before, status: error ? 'failed' : 'loading', onRetry })
  }

  const files = [...before, ...connection.edges.map(e => e.node)]
  if (index < cursors.length - 1) {
    return (
      <LibraryPages
        cursors={cursors}
        index={index + 1}
        before={files}
        canManageMaps={canManageMaps}
        onLoadMore={onLoadMore}>
        {children}
      </LibraryPages>
    )
  }
  const { hasNextPage, endCursor } = connection.pageInfo
  return children({
    files,
    status: 'loaded',
    onLoadMore: hasNextPage && endCursor ? () => onLoadMore(endCursor) : undefined,
    onRetry,
  })
}

/** The add file dialog's frame: its title and its Close button. */
export function MapOwnerAddFileFrame({
  mapName,
  busy,
  onCancel,
  children,
}: {
  mapName: string
  busy?: AddFileBusy
  onCancel: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <AddFileDialog
      title={t('maps.owner.addFileTitle', 'Add a file to {{mapName}}', {
        mapName: filterColorCodes(mapName),
      })}
      buttons={[
        <TextButton
          key='close'
          label={t('common.actions.close', 'Close')}
          disabled={!!busy}
          onClick={onCancel}
        />,
      ]}
      onCancel={onCancel}
      showCloseButton={true}>
      {children}
    </AddFileDialog>
  )
}

export interface MapOwnerAddFileBodyProps {
  familyId: string
  viewerId: SbUserId
  listing: AddFileListing
  busy?: AddFileBusy
  errorMessage?: string
  makeRecommended: boolean
  onMakeRecommendedChange: (checked: boolean) => void
  /** Uploads a map file the viewer picked and adds it to the map. */
  onUpload: (file: File) => void
  onAdd: (file: AddFileData) => void
}

/**
 * What the add file dialog shows: a button uploading a new file, the choice of making the added
 * file the recommended one, and the viewer's files that can join the map, the listed ones apart
 * from the ones that would be published.
 */
export function MapOwnerAddFileBody({
  familyId,
  viewerId,
  listing,
  busy,
  errorMessage,
  makeRecommended,
  onMakeRecommendedChange,
  onUpload,
  onAdd,
}: MapOwnerAddFileBodyProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const published: AddFileData[] = []
  const unpublished: AddFileData[] = []
  for (const file of listing.files) {
    const plan = planAddFile(addFileFacts(file), familyId, viewerId)
    if (plan.kind === 'link') {
      published.push(file)
    } else if (plan.kind === 'publish') {
      unpublished.push(file)
    }
  }
  const hasRows = published.length > 0 || unpublished.length > 0
  const showGroupLabels = published.length > 0 && unpublished.length > 0

  let uploadLabel = t('maps.owner.uploadFile', 'Upload a file')
  if (busy?.kind === 'uploading') {
    uploadLabel = uploadStatusText(busy.progress, t)
  } else if (busy?.kind === 'adding' && !busy.fileId) {
    uploadLabel = t('maps.owner.adding', 'Adding…')
  }

  const rowsOf = (files: AddFileData[], label: string) =>
    files.map(file => (
      <AddFileRow
        key={file.id}
        file={file}
        label={
          busy?.kind === 'adding' && busy.fileId === file.id
            ? t('maps.owner.adding', 'Adding…')
            : label
        }
        disabled={!!busy}
        onAdd={onAdd}
      />
    ))

  return (
    <Layout>
      {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
      <UploadRow>
        <OutlinedButton
          label={uploadLabel}
          iconStart='upload'
          disabled={!!busy}
          onClick={() => fileInputRef.current?.click()}
        />
        {listing.status === 'loaded' && !hasRows ? (
          <MutedBody>{t('maps.owner.uploadHint', 'Upload the new version to add it.')}</MutedBody>
        ) : null}
        <HiddenFileInput
          ref={fileInputRef}
          type='file'
          accept={MAP_FILE_EXTENSIONS.map(e => `.${e}`).join(',')}
          onChange={event => {
            const picked = event.target.files?.[0]
            event.target.value = ''
            if (picked) {
              onUpload(picked)
            }
          }}
        />
      </UploadRow>
      <MakeRecommendedCheckBox
        checked={makeRecommended}
        disabled={!!busy}
        onChange={onMakeRecommendedChange}
      />
      {published.length ? (
        <FileGroup>
          {showGroupLabels ? (
            <GroupLabel>{t('maps.owner.publishedGroup', 'Published')}</GroupLabel>
          ) : null}
          {rowsOf(published, t('maps.owner.addFile', 'Add'))}
        </FileGroup>
      ) : null}
      {unpublished.length ? (
        <FileGroup>
          {showGroupLabels ? (
            <GroupLabel>{t('maps.owner.unpublishedGroup', 'Not published yet')}</GroupLabel>
          ) : null}
          {rowsOf(unpublished, t('maps.owner.publishAndAdd', 'Publish and add'))}
        </FileGroup>
      ) : null}
      {listing.status === 'failed' ? (
        <LoadErrorRow
          message={t('maps.owner.filesLoadError', "Couldn't load your files")}
          onRetry={listing.onRetry}
        />
      ) : null}
      {listing.status === 'loading' ? <LoadingDotsArea /> : null}
      {listing.onLoadMore ? (
        <LoadMoreRow>
          <TextButton
            label={t('maps.owner.lookFurther', 'Look through older files')}
            disabled={!!busy}
            onClick={listing.onLoadMore}
          />
        </LoadMoreRow>
      ) : null}
    </Layout>
  )
}

/** One of the viewer's files: its image, name, size, players and publish date, and a button. */
function AddFileRow({
  file,
  label,
  disabled,
  onAdd,
}: {
  file: AddFileData
  label: string
  disabled: boolean
  onAdd: (file: AddFileData) => void
}) {
  const { t } = useTranslation()
  const publishedDate = useFormat(publishedFormat)
  const fileName = filterColorCodes(file.name)
  const meta = [
    `${file.file.width}×${file.file.height}`,
    t('maps.catalog.players', {
      defaultValue: '{{count}} players',
      defaultValue_one: '{{count}} player',
      count: file.playerCount,
    }),
  ]
  if (file.publishedAt) {
    meta.push(publishedDate.format(new Date(file.publishedAt)))
  }
  return (
    <FileRow>
      <FileThumbnail>
        <MapFileImage file={file.file} name={fileName} size={64} forceAspectRatio={1} />
      </FileThumbnail>
      <FileName>{fileName}</FileName>
      <FileMeta>{meta.join(' · ')}</FileMeta>
      <TextButton label={label} disabled={disabled} onClick={() => onAdd(file)} />
    </FileRow>
  )
}
