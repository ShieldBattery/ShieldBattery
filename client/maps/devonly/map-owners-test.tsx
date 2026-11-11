import { ReactNode, useState } from 'react'
import styled from 'styled-components'
import {
  cacheExchange,
  Client,
  Exchange,
  getOperationName,
  makeErrorResult,
  makeResult,
  Operation,
  Provider as UrqlProvider,
} from 'urql'
import { filter, map, pipe } from 'wonka'
import { makeSbMapId, MapInfoJson } from '../../../common/maps'
import { DEFAULT_PERMISSIONS } from '../../../common/users/permissions'
import { SbUser, SelfUserJson } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { makeFragmentData } from '../../gql'
import { MapOwnerClaimStatus, MapOwnerKind } from '../../gql/graphql'
import { IsolatedReduxProvider } from '../../lobbies/devonly/isolated-redux'
import { ScenarioPicker } from '../../lobbies/devonly/scenario-picker'
import { bodySmall, titleMedium } from '../../styles/typography'
import { ClaimRow, ClaimRowData, ClaimsTableFrame } from '../admin-map-reports'
import { MapFileImage_FileFragment } from '../map-image'
import {
  AddFileBusy,
  AddFileData,
  AddFileListing,
  MapOwnerAddFileBody,
  MapOwnerAddFileFrame,
  MapOwnerClaimDialog,
  MapOwnerEditDialog,
} from '../map-owner-dialogs'
import { MapByline, MapBylineProps } from '../map-page'
import { BigGameHunters, FightingSpirit } from './maps-for-testing'

// Ids well above the ones a development database hands out, so background user fetches can't
// overwrite these with whoever really holds the low ids.
const VIEWER = makeSbUserId(90040)
const PUBLISHER = makeSbUserId(90041)
const MAKER = makeSbUserId(90042)
const CLAIMANT = makeSbUserId(90043)

const USERS: SbUser[] = [
  { id: VIEWER, name: 'devMapStaff', created: 0 },
  { id: PUBLISHER, name: 'tec27_the_sequel', created: 0 },
  { id: MAKER, name: 'LancerMapper', created: 0 },
  { id: CLAIMANT, name: 'ClaimsItAll', created: 0 },
]

const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000
const FAMILY_ID = 'f0a0f0a0-0000-4000-8000-000000000001'

type ScenarioId =
  | 'bylines'
  | 'claim'
  | 'claimOwned'
  | 'makerVerified'
  | 'makerCredited'
  | 'makerNone'
  | 'claims'
  | 'addFile'
  | 'addFileEmpty'
  | 'addFileUploading'
  | 'addFileError'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'bylines', label: 'Bylines' },
  { id: 'claim', label: 'Claim dialog' },
  { id: 'claimOwned', label: 'Claim dialog, map has a maker' },
  { id: 'makerVerified', label: 'Maker dialog, verified' },
  { id: 'makerCredited', label: 'Maker dialog, credited' },
  { id: 'makerNone', label: 'Maker dialog, no maker' },
  { id: 'claims', label: 'Claims tab rows' },
  { id: 'addFile', label: 'Add a file' },
  { id: 'addFileEmpty', label: 'Add a file, nothing to list' },
  { id: 'addFileUploading', label: 'Add a file, uploading' },
  { id: 'addFileError', label: 'Add a file, failed' },
]

const BYLINES: ReadonlyArray<{ label: string; props: MapBylineProps }> = [
  {
    label: 'Verified maker, someone else published',
    props: {
      owner: { id: MAKER },
      ownerKind: MapOwnerKind.Staff,
      publisher: { id: PUBLISHER },
      publishedAt: new Date(NOW - 40 * DAY).toISOString(),
    },
  },
  {
    label: 'Maker published it (claimed)',
    props: {
      owner: { id: PUBLISHER },
      ownerKind: MapOwnerKind.Claim,
      publisher: { id: PUBLISHER },
      publishedAt: new Date(NOW - 40 * DAY).toISOString(),
    },
  },
  {
    label: 'Verified maker published it',
    props: {
      owner: { id: MAKER },
      ownerKind: MapOwnerKind.Staff,
      publisher: { id: MAKER },
      publishedAt: new Date(NOW - 40 * DAY).toISOString(),
    },
  },
  {
    label: 'Credited maker',
    props: {
      credit: 'Rose.of.Sharon (KeSPA)',
      publisher: { id: PUBLISHER },
      publishedAt: new Date(NOW - 40 * DAY).toISOString(),
    },
  },
  {
    label: 'Maker, unlisted file',
    props: { owner: { id: MAKER }, ownerKind: MapOwnerKind.Staff },
  },
  {
    label: 'No maker',
    props: {
      publisher: { id: PUBLISHER },
      publishedAt: new Date(NOW - 40 * DAY).toISOString(),
    },
  },
]

function claim(
  n: number,
  { note, owner, family = true }: { note: string | null; owner?: SbUserId; family?: boolean },
): ClaimRowData {
  return {
    id: `c1a1c1a1-0000-4000-8000-00000000000${n}`,
    note,
    status: MapOwnerClaimStatus.Open,
    createdAt: new Date(NOW - n * 3 * DAY).toISOString(),
    claimant: { id: CLAIMANT },
    family: family
      ? {
          id: `f0a0f0a0-0000-4000-8000-00000000000${n}`,
          name: ['Eclipse 1.2', 'Sylphid', 'Python 1.3'][n % 3],
          owner: owner ? { id: owner } : null,
        }
      : null,
  }
}

const CLAIMS: ReadonlyArray<ClaimRowData> = [
  claim(3, {
    note:
      'I made this map in 2019 for the iCCup map contest. The original .scx is on my blog, along ' +
      'with the forum thread where I posted every version of it.',
  }),
  claim(2, { note: "It's mine, check the map description.", owner: MAKER }),
  claim(1, { note: 'Renamed after the map was stolen', family: false }),
]

type MakerFixture = {
  owner: { id: SbUserId; name: string } | null
  ownerKind: MapOwnerKind | null
  credit: string | null
}

const MAKERS: Partial<Record<ScenarioId, MakerFixture>> = {
  makerVerified: {
    owner: { id: MAKER, name: 'LancerMapper' },
    ownerKind: MapOwnerKind.Staff,
    credit: null,
  },
  makerCredited: { owner: null, ownerKind: null, credit: 'Rose.of.Sharon (KeSPA)' },
  makerNone: { owner: null, ownerKind: null, credit: null },
}

/**
 * Answers the dialogs' GraphQL operations from fixtures, in place of the server. Mutations succeed
 * with the change applied to the fixture, so the Maker dialog shows its result.
 */
function fixtureExchange(initialMaker: MakerFixture): Exchange {
  let maker = initialMaker
  const familyOf = () => ({
    __typename: 'MapFamily',
    id: FAMILY_ID,
    name: 'Eclipse 1.2',
    ...maker,
    ownerSetAt: maker.owner ? new Date(NOW - 10 * DAY).toISOString() : null,
  })
  const resolve = (operation: Operation): object | undefined => {
    switch (getOperationName(operation.query)) {
      case 'MapOwnerEditFamily':
        return { mapFamily: { id: FAMILY_ID, family: familyOf() } }
      case 'MapFamilySetOwner': {
        const userId = operation.variables?.userId as SbUserId
        const user = USERS.find(u => u.id === userId)
        maker = {
          ...maker,
          owner: { id: userId, name: user?.name ?? 'someone' },
          ownerKind: MapOwnerKind.Staff,
        }
        return { mapFamilySetOwner: familyOf() }
      }
      case 'MapFamilyRemoveOwner':
        maker = { ...maker, owner: null, ownerKind: null }
        return { mapFamilyRemoveOwner: familyOf() }
      case 'MapFamilySetCredit':
        maker = { ...maker, credit: (operation.variables?.credit as string | undefined) ?? null }
        return { mapFamilySetCredit: familyOf() }
      case 'MapOwnerClaim':
        return {
          mapOwnerClaim: {
            id: 'map-owner-claim-result:1',
            granted: false,
            claim: {
              id: 'c1a1c1a1-0000-4000-8000-000000000009',
              status: MapOwnerClaimStatus.Open,
              note: operation.variables?.note,
              createdAt: new Date().toISOString(),
            },
            family: familyOf(),
          },
        }
      default:
        return undefined
    }
  }

  return () => operations$ =>
    pipe(
      operations$,
      filter(operation => operation.kind === 'query' || operation.kind === 'mutation'),
      map(operation => {
        const data = resolve(operation)
        return data
          ? makeResult(operation, { data })
          : makeErrorResult(operation, new Error('This dev page has no fixture for this request'))
      }),
    )
}

function seedActions(): ReduxAction[] {
  const user: SelfUserJson = {
    id: VIEWER,
    name: 'devMapStaff',
    created: 0,
    loginName: 'devMapStaff',
    email: 'devmapstaff@example.com',
    emailVerified: true,
    acceptedPrivacyVersion: 0,
    acceptedTermsVersion: 0,
    acceptedUsePolicyVersion: 0,
    nameChangeTokens: 0,
  }
  return [
    { type: '@users/loadUsers', payload: USERS },
    {
      type: '@auth/loadCurrentSession',
      payload: { user, permissions: { ...DEFAULT_PERMISSIONS, manageMaps: true }, jwt: '' },
    },
  ]
}

const Container = styled.div`
  height: 100%;
  overflow: auto;

  display: flex;
  flex-direction: column;
`

const Controls = styled.div`
  flex-shrink: 0;
  padding: 16px 0;
`

const ControlsTitle = styled.div`
  ${titleMedium};
  margin: 0 16px 8px;
`

const Area = styled.div`
  position: relative;
  flex-grow: 1;
  min-height: 0;
  padding: 0 16px 16px;
`

const BylineList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const BylineLabel = styled.div`
  ${bodySmall};
  margin-bottom: 4px;
  color: var(--theme-on-surface-variant);
  opacity: 0.7;
`

const noop = () => {}

/** The viewer's library files the add file dialog lists in its scenarios. */
function libraryFile(
  n: number,
  map: MapInfoJson,
  {
    name,
    listed,
    playerCount = 2,
    publishedDaysAgo = 30,
  }: { name: string; listed: boolean; playerCount?: number; publishedDaysAgo?: number },
): AddFileData {
  const id = makeSbMapId(`ad0f11e0-0000-4000-8000-00000000000${n}`)
  return {
    id,
    name,
    listed,
    official: false,
    playerCount,
    publishedAt: listed ? new Date(NOW - publishedDaysAgo * DAY).toISOString() : null,
    publisher: listed ? { id: VIEWER } : null,
    moderation: { id, delistedKind: null },
    family: { id: `ad0f-family-${n}`, name, credit: null, owner: null, files: [{ id }] },
    file: {
      id: `${id}-file`,
      width: map.mapData.width,
      height: map.mapData.height,
      ...makeFragmentData(
        {
          id: `${id}-file`,
          image256Url: map.image256Url ?? '',
          image512Url: map.image512Url ?? '',
          image1024Url: map.image1024Url ?? '',
          image2048Url: map.image2048Url ?? '',
          imageSpawnsBaked: map.imageSpawnsBaked,
          width: map.mapData.width,
          height: map.mapData.height,
          umsContent: false,
          startLocations: [],
        },
        MapFileImage_FileFragment,
      ),
    },
  }
}

const LIBRARY_FILES: ReadonlyArray<AddFileData> = [
  libraryFile(1, FightingSpirit, { name: 'Eclipse 1.3', listed: false, playerCount: 2 }),
  libraryFile(2, FightingSpirit, { name: 'Eclipse 1.2 (fixed ramps)', listed: true }),
  libraryFile(3, BigGameHunters, {
    name: 'Eclipse 1.1',
    listed: true,
    playerCount: 8,
    publishedDaysAgo: 400,
  }),
  libraryFile(4, BigGameHunters, { name: 'eclipse test', listed: false, playerCount: 8 }),
]

const ADD_FILE_STATES: Partial<
  Record<ScenarioId, { files: ReadonlyArray<AddFileData>; busy?: AddFileBusy; error?: string }>
> = {
  addFile: { files: LIBRARY_FILES },
  addFileEmpty: { files: [] },
  addFileUploading: { files: LIBRARY_FILES, busy: { kind: 'uploading', progress: 0.42 } },
  addFileError: {
    files: LIBRARY_FILES,
    error: "You've published a lot of maps today. Try again tomorrow.",
  },
}

/** The add file dialog with an injected library and state, which stays as it's set. */
function AddFileScenario({ scenarioId }: { scenarioId: ScenarioId }) {
  const [makeRecommended, setMakeRecommended] = useState(true)
  const state = ADD_FILE_STATES[scenarioId] ?? { files: [] }
  const listing: AddFileListing = { files: state.files, status: 'loaded', onRetry: noop }
  return (
    <MapOwnerAddFileFrame mapName='Eclipse' busy={state.busy} onCancel={noop}>
      <MapOwnerAddFileBody
        familyId={FAMILY_ID}
        viewerId={VIEWER}
        listing={listing}
        busy={state.busy}
        errorMessage={state.error}
        makeRecommended={makeRecommended}
        onMakeRecommendedChange={setMakeRecommended}
        onUpload={noop}
        onAdd={noop}
      />
    </MapOwnerAddFileFrame>
  )
}

/**
 * Renders the real map maker components against injected state: the page's byline in each of its
 * forms, the claim dialog, the staff Maker dialog (whose changes apply to the fixture), the rows of
 * the admin Claims tab, and the maker's add file dialog with its library and progress injected.
 */
export function MapOwnersTest() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('bylines')

  return (
    <Container>
      <Controls>
        <ControlsTitle>Map makers</ControlsTitle>
        <ScenarioPicker scenarios={SCENARIOS} active={scenarioId} onChange={setScenarioId} />
      </Controls>
      <ScenarioView key={scenarioId} scenarioId={scenarioId} />
    </Container>
  )
}

/** One scenario, with its own fixture client and page-local store, both fresh for each scenario. */
function ScenarioView({ scenarioId }: { scenarioId: ScenarioId }) {
  const [client] = useState(
    () =>
      new Client({
        url: 'http://localhost/devonly-map-owners',
        exchanges: [
          cacheExchange,
          fixtureExchange(MAKERS[scenarioId] ?? { owner: null, ownerKind: null, credit: null }),
        ],
      }),
  )

  let content: ReactNode
  switch (scenarioId) {
    case 'bylines':
      content = (
        <BylineList>
          {BYLINES.map(b => (
            <div key={b.label}>
              <BylineLabel>{b.label}</BylineLabel>
              <MapByline {...b.props} />
            </div>
          ))}
        </BylineList>
      )
      break
    case 'claim':
    case 'claimOwned':
      content = (
        <MapOwnerClaimDialog
          familyId={FAMILY_ID}
          ownerName={scenarioId === 'claimOwned' ? 'Maker' : undefined}
          onCancel={noop}
          close={noop}
        />
      )
      break
    case 'makerVerified':
    case 'makerCredited':
    case 'makerNone':
      content = <MapOwnerEditDialog familyId={FAMILY_ID} onCancel={noop} close={noop} />
      break
    case 'claims':
      content = (
        <ClaimsTableFrame>
          {CLAIMS.map(c => (
            <ClaimRow key={c.id} claim={c} disabled={false} onGrant={noop} onReject={noop} />
          ))}
        </ClaimsTableFrame>
      )
      break
    case 'addFile':
    case 'addFileEmpty':
    case 'addFileUploading':
    case 'addFileError':
      content = <AddFileScenario scenarioId={scenarioId} />
      break
    default:
      content = scenarioId satisfies never
  }

  return (
    <UrqlProvider value={client}>
      <IsolatedReduxProvider seedActions={seedActions()}>
        <Area>{content}</Area>
      </IsolatedReduxProvider>
    </UrqlProvider>
  )
}
