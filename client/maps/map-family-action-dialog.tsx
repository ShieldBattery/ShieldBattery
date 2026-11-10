import * as React from 'react'
import { useState } from 'react'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import { assertUnreachable } from '../../common/assert-unreachable'
import { urlForMap } from '../../common/map-url'
import { filterColorCodes, makeMapFamilyId, SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MapFamilyActionKind } from '../dialogs/dialog-type'
import { graphql, useFragment } from '../gql'
import { MapFamilyAction_FamilyFragmentFragment } from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium, labelLarge } from '../styles/typography'
import { FamilyFileFacts, predictCurrentFile } from './map-family-files'
import { MapFamilyCandidate, MapFamilySearch } from './map-family-search'

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
        name
        family {
          id
          name
          ...MapFamilySearch_FamilyFragment
        }
      }
    }
  }
`)

const SetDefaultMutation = graphql(/* GraphQL */ `
  mutation MapFamilySetDefault($fileId: SbMapId!) {
    mapFamilySetDefault(fileId: $fileId) {
      id
      name
      current {
        id
      }
      defaultMap {
        id
      }
      defaultSetAt
    }
  }
`)

const ClearDefaultMutation = graphql(/* GraphQL */ `
  mutation MapFamilyClearDefault($familyId: UUID!) {
    mapFamilyClearDefault(familyId: $familyId) {
      id
      name
      current {
        id
      }
      defaultMap {
        id
      }
      defaultSetAt
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

const EffectsHeading = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface);
`

const Effects = styled.ul`
  ${bodyMedium};
  margin: 0;
  padding-left: 20px;

  display: flex;
  flex-direction: column;
  gap: 6px;

  color: var(--theme-on-surface);
  overflow-wrap: anywhere;
`

const PlainText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const FileList = styled.ul`
  margin: 4px 0 0;
  padding-left: 20px;
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

/** Names a file the way staff can tell it apart from its map's other files. */
function useFileLabel(): (file: FileData | undefined) => string {
  const date = useFormat(uploadedFormat)
  return file =>
    file
      ? `${filterColorCodes(file.name)} (uploaded ${date.format(new Date(file.firstSeenAt))}, ` +
        `${pluralize(file.stats?.gamesTotal ?? 0, 'game', 'games')})`
      : 'no file'
}

/** What happens to the favorites of a map merged into `target`. */
function favoritesMove(family: FamilyData, target: string): string {
  const count = favoritesOf(family)
  return count
    ? `its ${pluralize(count, 'favorite', 'favorites')} move to ${target}`
    : 'it has no favorites to move'
}

/** What players who pick a map get afterwards, compared with what they get now. */
function PlayersGet({
  map,
  predicted,
  currentId,
  files,
}: {
  /** The map, as the sentence should name it ("this map", or its name in bold). */
  map: React.ReactNode
  predicted: SbMapId | undefined
  currentId: SbMapId | undefined
  files: ReadonlyArray<FileData>
}) {
  const label = useFileLabel()
  const predictedFile = files.find(f => f.id === predicted)
  const currentFile = files.find(f => f.id === currentId)
  if (!predictedFile) {
    return null
  }
  let comparison = '.'
  if (predicted === currentId) {
    comparison = ', the same file as now.'
  } else if (currentFile) {
    comparison = `, instead of ${label(currentFile)}.`
  }
  return (
    <li>
      Players who pick {map} will get <strong>{label(predictedFile)}</strong>
      {comparison}
    </li>
  )
}

export interface MapFamilyActionDialogProps extends CommonDialogProps {
  action: MapFamilyActionKind
  familyId: string
  fileId?: SbMapId
  selectedId: SbMapId
}

/**
 * Confirms a staff change to a map: picking or clearing its default, splitting a file out of it,
 * moving a file to another map, or merging it into another map. Before anything is applied, it
 * spells out what moves, what happens to an emptied map's link and favorites, and which file
 * players get afterwards.
 */
export function MapFamilyActionDialog({
  action,
  familyId,
  fileId,
  selectedId,
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

  const props = { family, onCancel, close }
  switch (action) {
    case 'makeDefault':
      return <MakeDefaultDialog {...props} file={file!} selectedId={selectedId} />
    case 'clearDefault':
      return <ClearDefaultDialog {...props} selectedId={selectedId} />
    case 'split':
      return <SplitDialog {...props} file={file!} selectedId={selectedId} />
    case 'move':
      return <MoveDialog {...props} file={file!} selectedId={selectedId} />
    case 'merge':
      return <MergeDialog {...props} />
    default:
      return assertUnreachable(action)
  }
}

function actionTitle(action: MapFamilyActionKind): string {
  switch (action) {
    case 'makeDefault':
      return 'Make default'
    case 'clearDefault':
      return 'Clear default'
    case 'split':
      return 'Split into its own map'
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
  onCancel: () => void
  close: () => void
}

/** The dialog frame shared by every action: an error line, the content and the two buttons. */
function ActionFrame({
  action,
  confirmLabel,
  canConfirm,
  pending,
  errorMessage,
  onConfirm,
  onCancel,
  children,
}: {
  action: MapFamilyActionKind
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
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        {children}
      </Layout>
    </StyledDialog>
  )
}

/** Runs a mutation, reporting a failure in the dialog and a success with a snackbar. */
function useRunAction(close: () => void) {
  const snackbarController = useSnackbarController()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [pending, setPending] = useState(false)

  const run = <T,>(
    request: Promise<{ data?: T; error?: CombinedError }>,
    onSuccess: (data: T) => { message: string; open?: string },
  ) => {
    setPending(true)
    setErrorMessage(undefined)
    request
      .then(result => {
        setPending(false)
        if (result.error || !result.data) {
          setErrorMessage(
            result.error ? errorText(result.error) : 'Something went wrong. Please try again.',
          )
          return
        }
        const { message, open } = onSuccess(result.data)
        close()
        snackbarController.showSnackbar(
          message,
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

function MakeDefaultDialog({
  family,
  file,
  selectedId,
  onCancel,
  close,
}: ActionProps & { file: FileData; selectedId: SbMapId }) {
  const label = useFileLabel()
  const [, setDefault] = useMutation(SetDefaultMutation)
  const { run, pending, errorMessage } = useRunAction(close)
  const name = mapName(family)
  const current = family.files.find(f => f.id === family.current.id)
  const otherPick =
    family.defaultMap && family.defaultMap.id !== file.id
      ? family.files.find(f => f.id === family.defaultMap!.id)
      : undefined

  return (
    <ActionFrame
      action='makeDefault'
      confirmLabel='Make default'
      canConfirm={true}
      pending={pending}
      errorMessage={errorMessage}
      onCancel={onCancel}
      onConfirm={() =>
        run(setDefault({ fileId: file.id }), () => ({
          message: `Made ${filterColorCodes(file.name)} the default of ${name}`,
        }))
      }>
      <EffectsHeading>What happens</EffectsHeading>
      <Effects>
        {file.id === family.current.id ? (
          <li>
            Players who pick this map already get <strong>{label(file)}</strong>. Making it the
            default keeps it that way, however much the other files get played.
          </li>
        ) : (
          <>
            <li>
              Players who pick this map will get <strong>{label(file)}</strong>, instead of{' '}
              {label(current)}.
            </li>
            <li>
              It moves to the top of the Files list, and the map&apos;s catalog tile, name and image
              will come from it.
              {selectedId === family.current.id
                ? ' This page shows the default, so it will switch to it.'
                : null}
            </li>
          </>
        )}
        {otherPick ? <li>It replaces the current pick, {label(otherPick)}.</li> : null}
        <li>It stays the default until staff change it.</li>
      </Effects>
    </ActionFrame>
  )
}

function ClearDefaultDialog({
  family,
  selectedId,
  onCancel,
  close,
}: ActionProps & { selectedId: SbMapId }) {
  const label = useFileLabel()
  const [, clearDefault] = useMutation(ClearDefaultMutation)
  const { run, pending, errorMessage } = useRunAction(close)
  const name = mapName(family)
  const picked = family.files.find(f => f.id === family.defaultMap?.id)
  const predicted = predictCurrentFile(family.files.map(factsOf), { keepCurrent: false })

  return (
    <ActionFrame
      action='clearDefault'
      confirmLabel='Clear default'
      canConfirm={true}
      pending={pending}
      errorMessage={errorMessage}
      onCancel={onCancel}
      onConfirm={() =>
        run(clearDefault({ familyId: family.id }), () => ({
          message: `Cleared the default of ${name}`,
        }))
      }>
      <EffectsHeading>What happens</EffectsHeading>
      <Effects>
        <li>
          <strong>{label(picked)}</strong> stops being the picked default of this map. From now on
          the default follows play: the listed file with the most games in the last 28 days (then
          the most games ever, then the newest).
        </li>
        <PlayersGet
          map='this map'
          predicted={predicted}
          currentId={family.current.id}
          files={family.files}
        />
        {predicted !== family.current.id ? (
          <li>
            That file moves to the top of the Files list, and the map&apos;s catalog tile, name and
            image will come from it.
            {selectedId === family.current.id
              ? ' This page shows the default, so it will switch to it.'
              : null}
          </li>
        ) : null}
      </Effects>
    </ActionFrame>
  )
}

/**
 * What happens to the map a file leaves, when other files stay in it: its default pick is cleared
 * if it was that file, and players may get a different file.
 */
function SourceEffects({ family, file }: { family: FamilyData; file: FileData }) {
  const label = useFileLabel()
  const remaining = family.files.filter(f => f.id !== file.id)
  const wasPicked = family.defaultMap?.id === file.id
  const predicted = predictCurrentFile(remaining.map(factsOf), {
    defaultMapId: wasPicked ? undefined : family.defaultMap?.id,
    incumbentId: family.current.id,
    keepCurrent: true,
  })

  return (
    <>
      <li>
        This map keeps{' '}
        {remaining.length === 1 ? 'its other file' : `its other ${remaining.length} files`} and all
        of its favorites.
      </li>
      {wasPicked ? (
        <li>
          {label(file)} was the picked default of this map, so that pick is cleared and the default
          follows play.
        </li>
      ) : null}
      <PlayersGet
        map='this map'
        predicted={predicted}
        currentId={family.current.id}
        files={family.files}
      />
    </>
  )
}

function SplitDialog({
  family,
  file,
  selectedId,
  onCancel,
  close,
}: ActionProps & { file: FileData; selectedId: SbMapId }) {
  const label = useFileLabel()
  const [, splitFile] = useMutation(SplitFileMutation)
  const { run, pending, errorMessage } = useRunAction(close)

  return (
    <ActionFrame
      action='split'
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
              file.id === selectedId
                ? undefined
                : urlForMap(makeMapFamilyId(moved.family.id), moved.family.name),
          }
        })
      }>
      <EffectsHeading>What happens</EffectsHeading>
      <Effects>
        <li>
          <strong>{label(file)}</strong> leaves this map and becomes a map of its own, with its own
          page and no favorites.
          {file.listed ? ' It shows up in the catalog as a separate map.' : null}
        </li>
        <SourceEffects family={family} file={file} />
        <li>
          {file.id === selectedId
            ? 'This page will switch to the new map.'
            : 'It will no longer be listed on this page.'}
        </li>
      </Effects>
    </ActionFrame>
  )
}

/** The map picked in a dialog, loaded with its files so the effects can be spelled out. */
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
  file,
  selectedId,
  onCancel,
  close,
}: ActionProps & { file: FileData; selectedId: SbMapId }) {
  const label = useFileLabel()
  const [picked, setPicked] = useState<MapFamilyCandidate>()
  const { target, loading, error } = usePickedFamily(picked)
  const [{ data: similarData }] = useQuery({
    query: MapFamilyActionSimilarQuery,
    variables: { fileId: file.id },
    context: NO_SUSPENSE_CONTEXT,
  })
  const [, moveFile] = useMutation(MoveFileMutation)
  const { run, pending, errorMessage } = useRunAction(close)
  const emptied = family.files.length === 1

  // One suggestion per map, at the similarity of its most similar file
  const suggestions: MapFamilyCandidate[] = []
  for (const similar of similarData?.similarFiles ?? []) {
    const other = similar.map.family
    if (other.id !== family.id && !suggestions.some(s => s.familyId === other.id)) {
      suggestions.push({
        familyId: other.id,
        family: other,
        note: `${Math.floor(similar.similarity * 100)}% similar terrain to ${filterColorCodes(similar.map.name)}`,
      })
    }
  }

  let effects: React.ReactNode
  if (!picked) {
    effects = (
      <PlainText>
        Pick the map to move {label(file)} to.{' '}
        {suggestions.length
          ? 'The maps with files whose terrain is most like it come first.'
          : 'No other listed map has a file with similar terrain.'}
      </PlainText>
    )
  } else if (!target) {
    effects = loading ? (
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
    effects = (
      <>
        <EffectsHeading>What happens</EffectsHeading>
        <Effects>
          <li>
            <strong>{label(file)}</strong> moves from this map to <strong>{targetName}</strong>,
            which will have {pluralize(targetFiles.length, 'file', 'files')}.
          </li>
          {emptied ? (
            <li>
              This map has no other files, so it&apos;s merged into {targetName}: links to it will
              open {targetName}, and {favoritesMove(family, targetName)}.
            </li>
          ) : (
            <SourceEffects family={family} file={file} />
          )}
          <PlayersGet
            map={<strong>{targetName}</strong>}
            predicted={predictedTarget}
            currentId={target.current.id}
            files={targetFiles}
          />
          <li>
            {emptied || file.id === selectedId
              ? `This page will switch to ${targetName}.`
              : 'It will no longer be listed on this page.'}
          </li>
        </Effects>
      </>
    )
  }

  return (
    <ActionFrame
      action='move'
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
            emptied || file.id === selectedId
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
      {effects}
    </ActionFrame>
  )
}

function MergeDialog({ family, onCancel, close }: ActionProps) {
  const label = useFileLabel()
  const [picked, setPicked] = useState<MapFamilyCandidate>()
  const { target, loading, error } = usePickedFamily(picked)
  const [, merge] = useMutation(MergeMutation)
  const { run, pending, errorMessage } = useRunAction(close)
  const name = mapName(family)
  const picks = family.defaultMap
    ? family.files.find(f => f.id === family.defaultMap!.id)
    : undefined

  let effects: React.ReactNode
  if (!picked) {
    effects = <PlainText>Pick the map to merge this map into.</PlainText>
  } else if (!target) {
    effects = loading ? (
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
    effects = (
      <>
        <EffectsHeading>What happens</EffectsHeading>
        <Effects>
          <li>
            {family.files.length === 1
              ? 'The only file of this map moves'
              : `All ${family.files.length} files of this map move`}{' '}
            to <strong>{targetName}</strong>, which will have{' '}
            {pluralize(merged.length, 'file', 'files')}:
            <FileList>
              {family.files.map(f => (
                <li key={f.id}>{label(f)}</li>
              ))}
            </FileList>
          </li>
          <li>
            This map stops being a map of its own: links to it will open {targetName}, and{' '}
            {favoritesMove(family, targetName)}.
          </li>
          {picks ? <li>Its picked default, {label(picks)}, is dropped.</li> : null}
          <PlayersGet
            map={<strong>{targetName}</strong>}
            predicted={predictedTarget}
            currentId={target.current.id}
            files={merged}
          />
          <li>This page will switch to {targetName}.</li>
        </Effects>
      </>
    )
  }

  return (
    <ActionFrame
      action='merge'
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
        }))
      }}>
      <MapFamilySearch
        picked={picked}
        onPick={setPicked}
        excludeFamilyId={family.id}
        disabled={pending}
      />
      {effects}
    </ActionFrame>
  )
}
