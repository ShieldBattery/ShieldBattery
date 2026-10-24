import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import { assertUnreachable } from '../../common/assert-unreachable'
import { mapIdFromRouteSegment } from '../../common/map-url'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapFamilyRelation, MapFamilyReportKind } from '../gql/graphql'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { RadioButton, RadioGroup } from '../material/radio'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium, bodySmall, singleLine, titleSmall } from '../styles/typography'
import { MapFileImage } from './map-image'

/** Keep in sync with `MAX_REPORT_NOTE_LENGTH` on the server (maps/families/edit.rs). */
const MAX_NOTE_LENGTH = 500

const MapFamilyLinkCandidateFragment = graphql(/* GraphQL */ `
  fragment MapFamilyLink_CandidateFragment on SbMap {
    id
    name
    listed
    publisher {
      id
      name
    }
    file {
      id
      ...MapFileImage_FileFragment
    }
  }
`)

const MapFamilyLinkDialogQuery = graphql(/* GraphQL */ `
  query MapFamilyLinkDialog($id: SbMapId!) {
    map(id: $id) {
      id
      listed
      publisher {
        id
      }
      similarMaps {
        id
        listed
        ...MapFamilyLink_CandidateFragment
      }
    }
  }
`)

const MapFamilyLinkSearchQuery = graphql(/* GraphQL */ `
  query MapFamilyLinkSearch($search: String!) {
    maps(filter: { search: $search, allVersions: true }, first: 5) {
      nodes {
        id
        listed
        ...MapFamilyLink_CandidateFragment
      }
    }
  }
`)

const MapFamilyLinkByIdQuery = graphql(/* GraphQL */ `
  query MapFamilyLinkById($id: SbMapId!) {
    map(id: $id) {
      id
      listed
      ...MapFamilyLink_CandidateFragment
    }
  }
`)

const PublisherLinkMutation = graphql(/* GraphQL */ `
  mutation MapFamilyPublisherLink(
    $mapId: SbMapId!
    $parentId: SbMapId!
    $relation: MapFamilyRelation!
  ) {
    mapFamilyPublisherLink(mapId: $mapId, parentId: $parentId, relation: $relation) {
      id
      familyMember {
        id
        relation
      }
    }
  }
`)

const ReportMutation = graphql(/* GraphQL */ `
  mutation MapFamilyReport($input: MapFamilyReportInput!) {
    mapFamilyReport(input: $input) {
      id
    }
  }
`)

/** How the dialog's map relates to the map picked in it. */
enum PickedRelation {
  NewerVersion = 'newerVersion',
  OlderVersion = 'olderVersion',
  Variant = 'variant',
  Translation = 'translation',
  Fork = 'fork',
}

const ALL_PICKED_RELATIONS: ReadonlyArray<PickedRelation> = Object.values(PickedRelation)

function pickedRelationLabel(relation: PickedRelation, t: TFunction): string {
  switch (relation) {
    case PickedRelation.NewerVersion:
      return t('maps.familyLink.newerVersion', 'A newer version of it')
    case PickedRelation.OlderVersion:
      return t('maps.familyLink.olderVersion', 'An older version of it')
    case PickedRelation.Variant:
      return t(
        'maps.familyLink.variant',
        'The same version with small changes (e.g. an observer or tournament edit)',
      )
    case PickedRelation.Translation:
      return t('maps.familyLink.translation', 'It in another language')
    case PickedRelation.Fork:
      return t('maps.familyLink.fork', 'Someone else’s map based on it')
    default:
      return assertUnreachable(relation)
  }
}

/** The family relation of the dialog's map to the picked map. */
function toFamilyRelation(
  relation: Exclude<PickedRelation, PickedRelation.OlderVersion>,
): MapFamilyRelation {
  switch (relation) {
    case PickedRelation.NewerVersion:
      return MapFamilyRelation.Version
    case PickedRelation.Variant:
      return MapFamilyRelation.Variant
    case PickedRelation.Translation:
      return MapFamilyRelation.Translation
    case PickedRelation.Fork:
      return MapFamilyRelation.Fork
    default:
      return assertUnreachable(relation)
  }
}

function errorMessage(error: CombinedError, t: TFunction): string {
  switch (error.graphQLErrors[0]?.extensions?.code) {
    case 'RATE_LIMITED':
      return t(
        'maps.familyLink.rateLimited',
        "You've sent too many reports recently. Please try again later.",
      )
    case 'RESTRICTED':
      return t('maps.familyLink.restricted', 'You are currently restricted from reporting.')
    case 'FORBIDDEN':
      return t(
        'maps.familyLink.locked',
        "Staff placed this map in its family, so it can't be changed here. Send them a report " +
          'instead.',
      )
    default:
      return t('maps.familyLink.error', 'Something went wrong. Please try again later.')
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

const MutedText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const CandidateRow = styled.div`
  min-width: 0;
  padding-block: 4px;

  display: flex;
  align-items: center;
  gap: 12px;
`

const CandidateImage = styled.div`
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 4px;
`

const CandidateText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
`

const CandidateName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const CandidateMeta = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

type CandidateMap = { id: SbMapId; listed: boolean } & FragmentType<
  typeof MapFamilyLinkCandidateFragment
>

function Candidate({ map: mapRef }: { map: FragmentType<typeof MapFamilyLinkCandidateFragment> }) {
  const { t } = useTranslation()
  const map = useFragment(MapFamilyLinkCandidateFragment, mapRef)
  const name = filterColorCodes(map.name)
  return (
    <CandidateRow>
      <CandidateImage>
        <MapFileImage file={map.file} name={name} size={64} forceAspectRatio={1} />
      </CandidateImage>
      <CandidateText>
        <CandidateName title={name}>{name}</CandidateName>
        <CandidateMeta>
          {map.listed && map.publisher
            ? t('maps.familyLink.publishedBy', {
                defaultValue: 'Published by {{name}}',
                name: map.publisher.name,
              })
            : t('maps.page.unlisted', 'Unlisted')}
        </CandidateMeta>
      </CandidateText>
    </CandidateRow>
  )
}

/**
 * Requests results without suspending: the dialog renders its own loading state instead.
 * Module-level so the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/** The maps found by a search, or by a pasted map link or id (which also finds unlisted maps). */
function useCandidateSearch(value: string): { results: CandidateMap[]; fetching: boolean } {
  const trimmed = value.trim()
  const urlSegment = /\/maps\/([^/?#]+)/.exec(trimmed)?.[1] ?? trimmed
  const pastedId = trimmed ? mapIdFromRouteSegment(urlSegment) : undefined

  const [{ data: byId }] = useQuery({
    query: MapFamilyLinkByIdQuery,
    variables: { id: pastedId ?? ('' as SbMapId) },
    pause: !pastedId,
    context: NO_SUSPENSE_CONTEXT,
  })
  const [{ data: bySearch, fetching }] = useQuery({
    query: MapFamilyLinkSearchQuery,
    variables: { search: trimmed },
    pause: !trimmed || !!pastedId,
    context: NO_SUSPENSE_CONTEXT,
  })

  if (pastedId) {
    return { results: byId?.map ? [byId.map] : [], fetching: false }
  }
  return { results: trimmed ? (bySearch?.maps.nodes ?? []) : [], fetching }
}

function NoteField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <TextField
      label={label}
      multiline={true}
      rows={2}
      maxRows={6}
      value={value}
      disabled={disabled}
      errorText={
        noteTooLong(value)
          ? t('maps.familyLink.noteTooLong', {
              defaultValue: 'Keep it under {{max}} characters.',
              max: MAX_NOTE_LENGTH,
            })
          : undefined
      }
      onChange={e => onChange(e.target.value)}
    />
  )
}

export interface MapFamilyLinkDialogProps extends CommonDialogProps {
  mapId: SbMapId
  /**
   * `related` says how the map relates to another map: its publisher links them, anyone else tells
   * staff. `wrongFamily` tells staff the map is in a family it doesn't belong to.
   */
  kind: 'related' | 'wrongFamily'
}

export function MapFamilyLinkDialog({ mapId, kind, onCancel, close }: MapFamilyLinkDialogProps) {
  const { t } = useTranslation()
  const [{ data, error }, reexecuteQuery] = useQuery({
    query: MapFamilyLinkDialogQuery,
    variables: { id: mapId },
    context: NO_SUSPENSE_CONTEXT,
    pause: kind !== 'related',
  })

  if (kind === 'wrongFamily') {
    return <WrongFamilyDialog mapId={mapId} onCancel={onCancel} close={close} />
  }
  if (data?.map) {
    return <RelatedDialog map={data.map} onCancel={onCancel} close={close} />
  }

  return (
    <StyledDialog
      title={t('maps.familyLink.relatedTitle', 'Related maps')}
      onCancel={onCancel}
      showCloseButton={true}>
      {error || data ? (
        <LoadErrorRow
          message={t('maps.page.loadError', "Couldn't load this map")}
          onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
        />
      ) : (
        <LoadingDotsArea />
      )}
    </StyledDialog>
  )
}

interface FormDialogProps {
  onCancel: () => void
  close: () => void
}

function RelatedDialog({
  map,
  onCancel,
  close,
}: FormDialogProps & {
  map: {
    id: SbMapId
    listed: boolean
    publisher?: { id: SbUserId } | null
    similarMaps: ReadonlyArray<CandidateMap>
  }
}) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const [search, setSearch] = useState('')
  const { results, fetching: searching } = useCandidateSearch(search)
  // The picked map stays in the list while the search changes
  const [picked, setPicked] = useState<CandidateMap | undefined>(() =>
    map.similarMaps.length === 1 ? map.similarMaps[0] : undefined,
  )
  const [relation, setRelation] = useState<PickedRelation>()
  const [note, setNote] = useState('')
  const [errorText, setErrorText] = useState<string>()
  const [{ fetching: linking }, publisherLink] = useMutation(PublisherLinkMutation)
  const [{ fetching: reporting }, report] = useMutation(ReportMutation)
  const pending = linking || reporting

  const candidates: CandidateMap[] = [...map.similarMaps]
  const shown = new Set(candidates.map(c => c.id))
  for (const c of [...(picked ? [picked] : []), ...results]) {
    if (!shown.has(c.id) && c.id !== map.id) {
      shown.add(c.id)
      candidates.push(c)
    }
  }

  // A publisher links their own listed map under another listed map directly (the server decides
  // whether a newer version takes over its line). An older version would mean linking the picked
  // map, which isn't theirs to link, so that goes to staff like anyone else's.
  const isPublisher = !!selfUser && map.listed && map.publisher?.id === selfUser.id
  const links = isPublisher && relation !== PickedRelation.OlderVersion && picked?.listed !== false

  const onFailure = () =>
    setErrorText(t('maps.familyLink.error', 'Something went wrong. Please try again later.'))

  const onSubmit = () => {
    if (!picked || !relation) {
      setErrorText(
        t('maps.familyLink.pickRequired', 'Pick the related map and how they’re related.'),
      )
      return
    }
    setErrorText(undefined)

    if (links) {
      const requested = toFamilyRelation(relation)
      publisherLink({ mapId: map.id, parentId: picked.id, relation: requested })
        .then(result => {
          if (result.error) {
            setErrorText(errorMessage(result.error, t))
            return
          }
          const stored = result.data?.mapFamilyPublisherLink.familyMember?.relation
          snackbarController.showSnackbar(
            stored && stored !== requested
              ? t(
                  'maps.familyLink.linkedAsFork',
                  'Linked as a fork. Staff will check whether it’s a newer version.',
                )
              : t('maps.familyLink.linked', 'Maps linked'),
          )
          close()
        })
        .catch(onFailure)
      return
    }

    // An older version is reported the other way around, as the picked map being the newer one
    const older = relation === PickedRelation.OlderVersion
    report({
      input: {
        mapId: older ? picked.id : map.id,
        kind: MapFamilyReportKind.Related,
        otherMapId: older ? map.id : picked.id,
        suggestedRelation: older ? MapFamilyRelation.Version : toFamilyRelation(relation),
        note: note.trim() || undefined,
      },
    })
      .then(result => {
        if (result.error) {
          setErrorText(errorMessage(result.error, t))
          return
        }
        snackbarController.showSnackbar(
          t('maps.familyLink.reported', 'Thanks! Staff will take a look.'),
        )
        close()
      })
      .catch(onFailure)
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={pending}
      onClick={onCancel}
    />,
    <TextButton
      key='submit'
      label={
        links ? t('maps.familyLink.link', 'Link maps') : t('maps.familyLink.send', 'Send to staff')
      }
      disabled={pending || (!links && noteTooLong(note))}
      onClick={onSubmit}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.familyLink.relatedTitle', 'Related maps')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorText ? <ErrorText>{errorText}</ErrorText> : null}
        <Intro>
          {links
            ? t(
                'maps.familyLink.publisherIntro',
                'You published this map, so you can link it to the map it’s related to. The ' +
                  'link applies right away.',
              )
            : t(
                'maps.familyLink.reportIntro',
                'Tell staff how this map is related to another map. They’ll check it and link ' +
                  'them.',
              )}
        </Intro>
        <TextField
          label={t('maps.familyLink.search', 'Search maps, or paste a map link')}
          dense={true}
          allowErrors={false}
          hasClearButton={true}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {candidates.length ? (
          <RadioGroup
            value={picked?.id}
            dense={true}
            label={t('maps.familyLink.relatedTo', 'Related to')}
            onChange={e => setPicked(candidates.find(c => c.id === e.target.value))}>
            {candidates.map(c => (
              <RadioButton
                key={c.id}
                value={c.id}
                label={<Candidate map={c} />}
                disabled={pending}
              />
            ))}
          </RadioGroup>
        ) : (
          <MutedText>
            {search.trim() && !searching
              ? t('maps.familyLink.noResults', 'No maps found.')
              : t('maps.familyLink.searchHint', 'Search for the map this one is related to.')}
          </MutedText>
        )}
        <Select
          label={t('maps.familyLink.relation', 'This map is')}
          value={relation}
          disabled={pending}
          onChange={value => setRelation(value)}>
          {ALL_PICKED_RELATIONS.map(r => (
            <SelectOption key={r} value={r} text={pickedRelationLabel(r, t)} />
          ))}
        </Select>
        {links ? null : (
          <NoteField
            label={t('maps.familyLink.note', 'Anything staff should know? (optional)')}
            value={note}
            disabled={pending}
            onChange={setNote}
          />
        )}
      </Layout>
    </StyledDialog>
  )
}

function WrongFamilyDialog({ mapId, onCancel, close }: FormDialogProps & { mapId: SbMapId }) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [note, setNote] = useState('')
  const [errorText, setErrorText] = useState<string>()
  const [{ fetching }, report] = useMutation(ReportMutation)

  const onSubmit = () => {
    setErrorText(undefined)
    report({
      input: { mapId, kind: MapFamilyReportKind.WrongFamily, note: note.trim() || undefined },
    })
      .then(result => {
        if (result.error) {
          setErrorText(errorMessage(result.error, t))
          return
        }
        snackbarController.showSnackbar(
          t('maps.familyLink.reported', 'Thanks! Staff will take a look.'),
        )
        close()
      })
      .catch(() =>
        setErrorText(t('maps.familyLink.error', 'Something went wrong. Please try again later.')),
      )
  }

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      disabled={fetching}
      onClick={onCancel}
    />,
    <TextButton
      key='submit'
      label={t('maps.familyLink.send', 'Send to staff')}
      disabled={fetching || noteTooLong(note)}
      onClick={onSubmit}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.familyLink.wrongFamilyTitle', 'Report a wrong family')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      <Layout>
        {errorText ? <ErrorText>{errorText}</ErrorText> : null}
        <Intro>
          {t(
            'maps.familyLink.wrongFamilyIntro',
            'Tell staff this map is shown with the versions of a different map. They’ll check it.',
          )}
        </Intro>
        <NoteField
          label={t('maps.familyLink.wrongFamilyNote', 'What’s wrong? (optional)')}
          value={note}
          disabled={fetching}
          onChange={setNote}
        />
      </Layout>
    </StyledDialog>
  )
}
