import { TFunction } from 'i18next'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import { assertUnreachable } from '../../common/assert-unreachable'
import { urlForMap } from '../../common/map-url'
import { filterColorCodes, makeMapFamilyId, SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MapFamilyActionKind } from '../dialogs/dialog-type'
import { graphql, useFragment } from '../gql'
import { MapFamilyAction_FamilyFragmentFragment, MapFamilyReportStatus } from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { FamilyFileFacts, predictCurrentFile } from './map-family-files'
import { MapFamilyCandidate, MapFamilySearch, useFamilyCandidate } from './map-family-search'
import { errorCode } from './map-owner-actions'
import { fileChangeErrorText } from './map-publish'
import { useSetReportStatus } from './map-report-status'

// Only staff can change which files make up a map, so this dialog isn't translated.

const MapFamilyAction_FamilyFragment = graphql(/* GraphQL */ `
  fragment MapFamilyAction_FamilyFragment on MapFamily {
    id
    name
    listed
    current {
      id
    }
    defaultMap {
      id
    }
    files {
      id
      name
      listed
      firstSeenAt
      favoriteCount
      stats {
        id
        games28d
        gamesTotal
      }
    }
  }
`)

const MapFamilyActionFamilyQuery = graphql(/* GraphQL */ `
  query MapFamilyActionFamily($id: UUID!) {
    mapFamily(id: $id) {
      id
      family {
        id
        ...MapFamilyAction_FamilyFragment
      }
    }
  }
`)

const MapFamilyActionSimilarQuery = graphql(/* GraphQL */ `
  query MapFamilyActionSimilar($fileId: SbMapId!) {
    similarFiles(fileId: $fileId) {
      id
      similarity
      map {
        id
        family {
          id
          name
          ...MapFamilySearch_FamilyFragment
        }
      }
    }
  }
`)

const SplitFileMutation = graphql(/* GraphQL */ `
  mutation MapFamilySplitFile($fileId: SbMapId!) {
    mapFamilySplitFile(fileId: $fileId) {
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
      }
      previousFamily {
        id
      }
    }
  }
`)

const MoveFileMutation = graphql(/* GraphQL */ `
  mutation MapFamilyMoveFile($fileId: SbMapId!, $familyId: UUID!) {
    mapFamilyMoveFile(fileId: $fileId, familyId: $familyId) {
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
      }
      previousFamily {
        id
      }
    }
  }
`)

const MergeMutation = graphql(/* GraphQL */ `
  mutation MapFamilyMerge($familyId: UUID!, $intoFamilyId: UUID!) {
    mapFamilyMerge(familyId: $familyId, intoFamilyId: $intoFamilyId) {
      id
      name
    }
  }
`)

type FamilyData = MapFamilyAction_FamilyFragmentFragment
type FileData = FamilyData['files'][number]

/**
 * Requests results without suspending: the dialog renders its own loading state. Module-level so
 * the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const uploadedFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

const StyledDialog = styled(Dialog)`
  max-width: 560px;
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

const Subject = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`

const SubjectName = styled.span`
  color: var(--theme-on-surface);
`

const Result = styled.div`
  ${bodyMedium};
  padding-top: 12px;

  display: flex;
  flex-direction: column;
  gap: 6px;

  border-top: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface);
  overflow-wrap: anywhere;
`

/** A result line about a default changing. */
const DefaultChangeLine = styled.div`
  color: var(--theme-amber);
`

const PlainText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

function factsOf(file: FileData): FamilyFileFacts {
  return {
    id: file.id,
    listed: file.listed,
    firstSeenAt: file.firstSeenAt,
    games28d: file.stats?.games28d ?? 0,
    gamesTotal: file.stats?.gamesTotal ?? 0,
  }
}

function mapName(family: { name: string }): string {
  return filterColorCodes(family.name)
}

/** How many users have favorited a map (counted per map, so any of its files says). */
function favoritesOf(family: FamilyData): number {
  return family.files[0]?.favoriteCount ?? 0
}

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function errorText(error: CombinedError): string {
  return error.graphQLErrors[0]?.message ?? error.message
}

/** What a failed file move or split tells the user. */
function fileChangeFailedText(error: CombinedError, t: TFunction): string {
  return fileChangeErrorText(errorCode(error), errorText(error), t)
}

/** What a map's link and favorites do when the map goes away into `target`. */
function goesAwayText(family: FamilyData, target: string): string {
  const favorites = favoritesOf(family)
  return favorites
    ? `its link and ${pluralize(favorites, 'favorite', 'favorites')} move to ${target}.`
    : `its link moves to ${target}.`
}

/** Describes files the way staff can tell them apart from a map's other files. */
function useFileDescriptions() {
  const date = useFormat(uploadedFormat)
  const facts = (file: FileData) => [
    date.format(new Date(file.firstSeenAt)),
    pluralize(file.stats?.gamesTotal ?? 0, 'game', 'games'),
  ]
  return {
    /** The file as a sentence names it: `Name (Oct 5, 2024 · 51 games)`. */
    label: (file: FileData | undefined) =>
      file ? `${filterColorCodes(file.name)} (${facts(file).join(' · ')})` : 'no file',
    /** The file as a dialog's subject line shows it: `Name · Oct 5, 2024 · 51 games`. */
    subject: (file: FileData) => (
      <>
        <SubjectName>{filterColorCodes(file.name)}</SubjectName>
        {` · ${facts(file).join(' · ')}`}
      </>
    ),
  }
}

/**
 * Predicts the file players get from a map after `file` leaves it, as `{ changes, file }`. A pick
 * of the leaving file is cleared, so the default follows play.
 */
function predictSource(family: FamilyData, file: FileData) {
  const remaining = family.files.filter(f => f.id !== file.id)
  const wasPicked = family.defaultMap?.id === file.id
  const predicted = predictCurrentFile(remaining.map(factsOf), {
    defaultMapId: wasPicked ? undefined : family.defaultMap?.id,
    incumbentId: family.current.id,
    keepCurrent: true,
  })
  return {
    remaining,
    changes: predicted !== family.current.id,
    file: remaining.find(f => f.id === predicted),
  }
}

export interface MapFamilyActionDialogProps extends CommonDialogProps {
  action: MapFamilyActionKind
  familyId: string
  fileId?: SbMapId
  selectedId?: SbMapId
  reportId?: string
  targetFamilyId?: string
}

/**
 * Confirms a staff change to a map: splitting a file out of it, moving a file to another map, or
 * merging it into another map. Before anything is applied, it states what changes: which files
 * the maps hold, what happens to an emptied map's link and favorites, and any default that
 * changes. When opened for a report, a successful change also resolves the report.
 */
export function MapFamilyActionDialog({
  action,
  familyId,
  fileId,
  selectedId,
  reportId,
  targetFamilyId,
  onCancel,
  close,
}: MapFamilyActionDialogProps) {
  const [{ data, error }, refetch] = useQuery({
    query: MapFamilyActionFamilyQuery,
    variables: { id: familyId },
    requestPolicy: 'network-only',
    context: NO_SUSPENSE_CONTEXT,
  })
  const family = useFragment(MapFamilyAction_FamilyFragment, data?.mapFamily?.family)
  const file = family?.files.find(f => f.id === fileId)

  if (!family || (action !== 'merge' && !file)) {
    return (
      <StyledDialog title={actionTitle(action)} onCancel={onCancel} showCloseButton={true}>
        {error || data ? (
          <LoadErrorRow
            message={error ? "Couldn't load this map" : 'This file is no longer in this map'}
            onRetry={() => refetch({ requestPolicy: 'network-only' })}
          />
        ) : (
          <LoadingDotsArea />
        )}
      </StyledDialog>
    )
  }

  const props = { family, reportId, onCancel, close }
  switch (action) {
    case 'split':
      return <SplitDialog {...props} file={file!} selectedId={selectedId} />
    case 'move':
      return <MoveDialog {...props} file={file!} selectedId={selectedId} />
    case 'merge':
      return <MergeDialog {...props} selectedId={selectedId} targetFamilyId={targetFamilyId} />
    default:
      return assertUnreachable(action)
  }
}

function actionTitle(action: MapFamilyActionKind): string {
  switch (action) {
    case 'split':
      return 'Split into its own map?'
    case 'move':
      return 'Move to another map'
    case 'merge':
      return 'Merge into another map'
    default:
      return assertUnreachable(action)
  }
}

interface ActionProps {
  family: FamilyData
  /** A report to resolve once the change is made. */
  reportId?: string
  onCancel: () => void
  close: () => void
}

/** The dialog frame shared by every action: a subject line, an error line, the content and buttons. */
function ActionFrame({
  action,
  subject,
  confirmLabel,
  canConfirm,
  pending,
  errorMessage,
  onConfirm,
  onCancel,
  children,
}: {
  action: MapFamilyActionKind
  /** What the action is about, shown directly under the title. */
  subject: React.ReactNode
  confirmLabel: string
  canConfirm: boolean
  pending: boolean
  errorMessage: string | undefined
  onConfirm: () => void
  onCancel: () => void
  children: React.ReactNode
}) {
  const buttons = [
    <TextButton key='cancel' label='Cancel' disabled={pending} onClick={onCancel} />,
    <TextButton
      key='confirm'
      label={confirmLabel}
      disabled={pending || !canConfirm}
      onClick={onConfirm}
    />,
  ]
  return (
    <StyledDialog
      title={actionTitle(action)}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        <Subject>{subject}</Subject>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        {children}
      </Layout>
    </StyledDialog>
  )
}

/**
 * Runs a mutation, reporting a failure in the dialog and a success with a snackbar. A success also
 * resolves `reportId`'s report, and the snackbar says if that didn't work.
 */
function useRunAction(close: () => void, reportId: string | undefined) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const setReportStatus = useSetReportStatus()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [pending, setPending] = useState(false)

  const run = <T,>(
    request: Promise<{ data?: T; error?: CombinedError }>,
    onSuccess: (data: T) => { message: string; open?: string },
  ) => {
    setPending(true)
    setErrorMessage(undefined)
    request
      .then(async result => {
        if (result.error || !result.data) {
          setPending(false)
          setErrorMessage(
            result.error
              ? fileChangeFailedText(result.error, t)
              : 'Something went wrong. Please try again.',
          )
          return
        }
        const { message, open } = onSuccess(result.data)
        let fullMessage = message
        if (reportId) {
          try {
            await setReportStatus(reportId, MapFamilyReportStatus.Resolved)
            fullMessage = `${message} and resolved the report`
          } catch (err) {
            fullMessage = `${message}, but couldn't resolve the report: ${(err as Error).message}`
          }
        }
        setPending(false)
        close()
        snackbarController.showSnackbar(
          fullMessage,
          undefined,
          open ? { action: { label: 'Open', onClick: () => push(open) } } : undefined,
        )
      })
      .catch((err: Error) => {
        setPending(false)
        setErrorMessage(err.message)
      })
  }

  return { run, pending, errorMessage }
}

function SplitDialog({
  family,
  reportId,
  file,
  selectedId,
  onCancel,
  close,
}: ActionProps & { file: FileData; selectedId?: SbMapId }) {
  const { label, subject } = useFileDescriptions()
  const [, splitFile] = useMutation(SplitFileMutation)
  const { run, pending, errorMessage } = useRunAction(close, reportId)
  const source = predictSource(family, file)

  return (
    <ActionFrame
      action='split'
      subject={subject(file)}
      confirmLabel='Split'
      canConfirm={true}
      pending={pending}
      errorMessage={errorMessage}
      onCancel={onCancel}
      onConfirm={() =>
        run(splitFile({ fileId: file.id }), data => {
          const moved = data.mapFamilySplitFile
          return {
            message: `Split ${filterColorCodes(file.name)} into its own map`,
            open:
              selectedId && file.id === selectedId
                ? undefined
                : urlForMap(makeMapFamilyId(moved.family.id), moved.family.name),
          }
        })
      }>
      <Result>
        <div>
          {`It becomes a separate map with its own page${file.listed ? ' and a catalog tile' : ''}. `}
          {`This map keeps ${
            source.remaining.length === 1
              ? 'its other file'
              : `its other ${source.remaining.length} files`
          }${source.changes ? '' : ' and its recommended file'}.`}
        </div>
        {source.changes ? (
          <DefaultChangeLine>
            {`This map's recommended file changes to ${label(source.file)}.`}
          </DefaultChangeLine>
        ) : null}
      </Result>
    </ActionFrame>
  )
}

/** The map picked in a dialog, loaded with its files so the result can be spelled out. */
function usePickedFamily(picked: MapFamilyCandidate | undefined) {
  const [{ data, error, fetching }] = useQuery({
    query: MapFamilyActionFamilyQuery,
    variables: { id: picked?.familyId ?? '' },
    pause: !picked,
    requestPolicy: 'network-only',
    context: NO_SUSPENSE_CONTEXT,
  })
  const family = useFragment(MapFamilyAction_FamilyFragment, data?.mapFamily?.family)
  return {
    target: picked && family?.id === picked.familyId ? family : undefined,
    loading: !!picked && fetching,
    error,
  }
}

function MoveDialog({
  family,
  reportId,
  file,
  selectedId,
  onCancel,
  close,
}: ActionProps & { file: FileData; selectedId?: SbMapId }) {
  const { label, subject } = useFileDescriptions()
  const [picked, setPicked] = useState<MapFamilyCandidate>()
  const { target, loading, error } = usePickedFamily(picked)
  const [{ data: similarData, fetching: similarFetching }] = useQuery({
    query: MapFamilyActionSimilarQuery,
    variables: { fileId: file.id },
    context: NO_SUSPENSE_CONTEXT,
  })
  const [, moveFile] = useMutation(MoveFileMutation)
  const { run, pending, errorMessage } = useRunAction(close, reportId)
  const source = predictSource(family, file)
  const emptied = source.remaining.length === 0

  // One suggestion per map, at the similarity of its most similar file
  const suggestions: MapFamilyCandidate[] = []
  for (const similar of similarData?.similarFiles ?? []) {
    const other = similar.map.family
    if (other.id !== family.id && !suggestions.some(s => s.familyId === other.id)) {
      suggestions.push({
        familyId: other.id,
        family: other,
        note: `${Math.floor(similar.similarity * 100)}% similar`,
      })
    }
  }

  let result: React.ReactNode
  if (!picked) {
    result =
      suggestions.length || !similarData || similarFetching ? null : (
        <PlainText>No listed map has a file with similar terrain.</PlainText>
      )
  } else if (!target) {
    result = loading ? (
      <LoadingDotsArea />
    ) : (
      <ErrorText>{error ? errorText(error) : "Couldn't load that map"}</ErrorText>
    )
  } else {
    const targetName = mapName(target)
    const targetFiles = [...target.files, file]
    const predictedTarget = predictCurrentFile(targetFiles.map(factsOf), {
      defaultMapId: target.defaultMap?.id,
      incumbentId: target.current.id,
      keepCurrent: true,
    })
    const targetChanges = predictedTarget !== target.current.id
    const nothingChanges = !targetChanges && (emptied || !source.changes)
    const unchangedText = emptied
      ? " Its recommended file doesn't change."
      : " Neither map's recommended file changes."
    result = (
      <Result>
        <div>
          {`${targetName} will have ${pluralize(targetFiles.length, 'file', 'files')}.`}
          {nothingChanges ? unchangedText : null}
        </div>
        {targetChanges ? (
          <DefaultChangeLine>
            {`${targetName}'s recommended file changes to ${label(targetFiles.find(f => f.id === predictedTarget))}.`}
          </DefaultChangeLine>
        ) : null}
        {!emptied && source.changes ? (
          <DefaultChangeLine>
            {`This map's recommended file changes to ${label(source.file)}.`}
          </DefaultChangeLine>
        ) : null}
        {emptied ? (
          <div>{`This map has no other files, so it goes away: ${goesAwayText(family, targetName)}`}</div>
        ) : null}
      </Result>
    )
  }

  return (
    <ActionFrame
      action='move'
      subject={subject(file)}
      confirmLabel='Move'
      canConfirm={!!target}
      pending={pending}
      errorMessage={errorMessage}
      onCancel={onCancel}
      onConfirm={() => {
        if (!target) {
          return
        }
        run(moveFile({ fileId: file.id, familyId: target.id }), () => ({
          message: `Moved ${filterColorCodes(file.name)} to ${mapName(target)}`,
          open:
            selectedId && (emptied || file.id === selectedId)
              ? undefined
              : urlForMap(makeMapFamilyId(target.id), target.name),
        }))
      }}>
      <MapFamilySearch
        picked={picked}
        onPick={setPicked}
        excludeFamilyId={family.id}
        suggestions={suggestions}
        disabled={pending}
      />
      {result}
    </ActionFrame>
  )
}

function MergeDialog({
  family,
  reportId,
  selectedId,
  targetFamilyId,
  onCancel,
  close,
}: ActionProps & { selectedId?: SbMapId; targetFamilyId?: string }) {
  const { label } = useFileDescriptions()
  const [chosen, setChosen] = useState<MapFamilyCandidate>()
  // The map to merge into is `targetFamilyId`'s until another one is chosen
  const preselected = useFamilyCandidate(targetFamilyId !== family.id ? targetFamilyId : undefined)
  const picked = chosen ?? preselected
  const { target, loading, error } = usePickedFamily(picked)
  const [, merge] = useMutation(MergeMutation)
  const { run, pending, errorMessage } = useRunAction(close, reportId)
  const name = mapName(family)

  let result: React.ReactNode
  if (!picked) {
    result = null
  } else if (!target) {
    result = loading ? (
      <LoadingDotsArea />
    ) : (
      <ErrorText>{error ? errorText(error) : "Couldn't load that map"}</ErrorText>
    )
  } else {
    const targetName = mapName(target)
    const merged = [...target.files, ...family.files]
    const predictedTarget = predictCurrentFile(merged.map(factsOf), {
      defaultMapId: target.defaultMap?.id,
      incumbentId: target.current.id,
      keepCurrent: true,
    })
    result = (
      <Result>
        <div>
          {`${
            family.files.length === 1
              ? 'The only file moves'
              : `All ${family.files.length} files move`
          } to ${targetName}, which will have ${pluralize(merged.length, 'file', 'files')}.`}
        </div>
        <div>{`This map goes away: ${goesAwayText(family, targetName)}`}</div>
        {predictedTarget !== target.current.id ? (
          <DefaultChangeLine>
            {`${targetName}'s recommended file changes to ${label(merged.find(f => f.id === predictedTarget))}.`}
          </DefaultChangeLine>
        ) : (
          <div>{`${targetName}'s recommended file doesn't change.`}</div>
        )}
      </Result>
    )
  }

  return (
    <ActionFrame
      action='merge'
      subject={
        <>
          <SubjectName>{name}</SubjectName>
          {` · ${pluralize(family.files.length, 'file', 'files')}`}
        </>
      }
      confirmLabel='Merge'
      canConfirm={!!target}
      pending={pending}
      errorMessage={errorMessage}
      onCancel={onCancel}
      onConfirm={() => {
        if (!target) {
          return
        }
        run(merge({ familyId: family.id, intoFamilyId: target.id }), () => ({
          message: `Merged ${name} into ${mapName(target)}`,
          open: selectedId ? undefined : urlForMap(makeMapFamilyId(target.id), target.name),
        }))
      }}>
      <MapFamilySearch
        picked={picked}
        onPick={setChosen}
        excludeFamilyId={family.id}
        disabled={pending}
      />
      {result}
    </ActionFrame>
  )
}
