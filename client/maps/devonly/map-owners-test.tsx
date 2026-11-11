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
import { DEFAULT_PERMISSIONS } from '../../../common/users/permissions'
import { SbUser, SelfUserJson } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { MapOwnerClaimStatus, MapOwnerKind } from '../../gql/graphql'
import { IsolatedReduxProvider } from '../../lobbies/devonly/isolated-redux'
import { ScenarioPicker } from '../../lobbies/devonly/scenario-picker'
import { bodySmall, titleMedium } from '../../styles/typography'
import { ClaimRow, ClaimRowData, ClaimsTableFrame } from '../admin-map-reports'
import { MapOwnerClaimDialog, MapOwnerEditDialog } from '../map-owner-dialogs'
import { MapByline, MapBylineProps } from '../map-page'

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

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'bylines', label: 'Bylines' },
  { id: 'claim', label: 'Claim dialog' },
  { id: 'claimOwned', label: 'Claim dialog, map has a maker' },
  { id: 'makerVerified', label: 'Maker dialog, verified' },
  { id: 'makerCredited', label: 'Maker dialog, credited' },
  { id: 'makerNone', label: 'Maker dialog, no maker' },
  { id: 'claims', label: 'Claims tab rows' },
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

/**
 * Renders the real map maker components against injected state: the page's byline in each of its
 * forms, the claim dialog, the staff Maker dialog (whose changes apply to the fixture), and the
 * rows of the admin Claims tab.
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
