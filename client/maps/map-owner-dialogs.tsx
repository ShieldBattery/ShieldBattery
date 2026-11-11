import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { filterColorCodes } from '../../common/maps'
import { UserErrorCode } from '../../common/users/user-network'
import { useSelfUser } from '../auth/auth-utils'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { graphql, useFragment } from '../gql'
import { MapOwnerAddFileLibraryQuery, MapOwnerKind } from '../gql/graphql'
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
  singleLine,
  titleSmall,
} from '../styles/typography'
import { findUserByName } from '../users/action-creators'
import { ConnectedUsername } from '../users/connected-username'
import { MapFileImage } from './map-image'
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

/**
 * Requests results without suspending: the dialogs render their own loading states. Module-level
 * so the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const StyledDialog = styled(Dialog)`
  max-width: 560px;
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

const AddFileLibraryQuery = graphql(/* GraphQL */ `
  query MapOwnerAddFileLibrary($after: String, $first: Int) {
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
            family {
              id
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

/** How many files of the viewer's library each page of the dialog looks through. */
const LIBRARY_PAGE_SIZE = 100

const publishedFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

const FileRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
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

type LibraryFile = NonNullable<
  MapOwnerAddFileLibraryQuery['currentUser']
>['mapLibrary']['edges'][number]['node']

export interface MapOwnerAddFileDialogProps extends CommonDialogProps {
  familyId: string
  mapName: string
}

/**
 * Adds files a map's owner published to that map: the listed files they published that are alone
 * in maps of their own, each moved in with one button.
 */
export function MapOwnerAddFileDialog({
  familyId,
  mapName,
  onCancel,
  close,
}: MapOwnerAddFileDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  const [{ fetching: adding }, link] = useMutation(AddFileLinkMutation)
  const [errorMessage, setErrorMessage] = useState<string>()

  const name = filterColorCodes(mapName)
  const onAdd = (file: LibraryFile) => {
    setErrorMessage(undefined)
    link({ fileId: file.id, familyId })
      .then(result => {
        if (result.error || !result.data) {
          const code = result.error ? errorCode(result.error) : undefined
          if (code === 'RESTRICTED') {
            setErrorMessage(t('maps.owner.restricted', "You're restricted from publishing maps."))
          } else if (code === 'PROTECTED_MAP') {
            setErrorMessage(
              t(
                'maps.publish.protectedMap',
                "This file's map has a maker, so it can't be added to another map.",
              ),
            )
          } else {
            setErrorMessage(ownerErrorText(t))
          }
          return
        }
        close()
        snackbarController.showSnackbar(
          t('maps.publish.linked', 'Added to {{mapName}}', { mapName: name }),
        )
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <StyledDialog
      title={t('maps.owner.addFileTitle', 'Add one of my files')}
      buttons={[
        <TextButton
          key='close'
          label={t('common.actions.close', 'Close')}
          disabled={adding}
          onClick={onCancel}
        />,
      ]}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        <FileRows>
          {pageCursors.map((cursor, i) => (
            <AddFilePage
              key={cursor ?? 'first'}
              familyId={familyId}
              after={cursor}
              isFirst={i === 0}
              isLast={i === pageCursors.length - 1}
              disabled={adding}
              onAdd={onAdd}
              onLoadMore={endCursor =>
                setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
              }
            />
          ))}
        </FileRows>
      </Layout>
    </StyledDialog>
  )
}

/**
 * One page of the viewer's library, showing the files on it that can be added to the map. The
 * first page says when there's nothing to add, and the last one offers to look further.
 */
function AddFilePage({
  familyId,
  after,
  isFirst,
  isLast,
  disabled,
  onAdd,
  onLoadMore,
}: {
  familyId: string
  after: string | null
  isFirst: boolean
  isLast: boolean
  disabled: boolean
  onAdd: (file: LibraryFile) => void
  onLoadMore: (endCursor: string) => void
}) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const publishedDate = useFormat(publishedFormat)
  const [{ data, error }, refetch] = useQuery({
    query: AddFileLibraryQuery,
    variables: { after: after ?? undefined, first: LIBRARY_PAGE_SIZE },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  const connection = data?.currentUser?.mapLibrary
  if (!connection) {
    return error ? (
      <LoadErrorRow
        message={t('maps.owner.filesLoadError', "Couldn't load your files")}
        onRetry={() => refetch({ requestPolicy: 'network-only' })}
      />
    ) : (
      <LoadingDotsArea />
    )
  }

  // A file moves in by taking the place of its own map, which only the publisher's listed file
  // can do while it's alone there
  const files = connection.edges
    .map(e => e.node)
    .filter(
      f =>
        f.listed &&
        !f.official &&
        !!selfUser &&
        f.publisher?.id === selfUser.id &&
        f.family.id !== familyId &&
        f.family.files.length === 1,
    )
  const { hasNextPage, endCursor } = connection.pageInfo

  return (
    <>
      {files.map(file => {
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
          <FileRow key={file.id}>
            <FileThumbnail>
              <MapFileImage file={file.file} name={fileName} size={64} forceAspectRatio={1} />
            </FileThumbnail>
            <FileName>{fileName}</FileName>
            <FileMeta>{meta.join(' · ')}</FileMeta>
            <TextButton
              label={t('maps.owner.addFile', 'Add')}
              disabled={disabled}
              onClick={() => onAdd(file)}
            />
          </FileRow>
        )
      })}
      {isFirst && !files.length && !hasNextPage ? (
        <BodyText>
          <MutedText>
            {t('maps.owner.noFilesToAdd', 'You have no other published files to add.')}
          </MutedText>
        </BodyText>
      ) : null}
      {isLast && hasNextPage && endCursor ? (
        <LoadMoreRow>
          <TextButton
            label={t('maps.owner.lookFurther', 'Look through older files')}
            onClick={() => onLoadMore(endCursor)}
          />
        </LoadMoreRow>
      ) : null}
    </>
  )
}
