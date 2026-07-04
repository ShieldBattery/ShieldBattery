/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import * as Types from './types'
export type CreateSignupCodeInput = {
  expiresAt: string
  maxUses?: number | null | undefined
  notes?: string | null | undefined
}

export type GameReportFilter = {
  /** Include already-resolved reports. Defaults to false (unresolved queue only). */
  includeResolved?: boolean | null | undefined
  /** Restrict to reports filed against this user (the "reports against" moderation view). */
  reportedUserId?: Types.SbUserId | null | undefined
}

/**
 * Why a player was reported. Stored in the `reason` TEXT column (not a PG enum) so the vocabulary
 * stays a code-only change; the DB string form is defined by [`GameReportReason::to_db`].
 */
export enum GameReportReason {
  /**
   * Left the game mid-match (mostly relevant for allies in team games). Note this is distinct
   * from queue dodging, which is handled automatically by matchmaking bans.
   */
  Abandoning = 'ABANDONING',
  /** Harassment, hate speech, or toxicity in game chat. */
  AbusiveChat = 'ABUSIVE_CHAT',
  /** Any mechanism of unfair advantage: hacks, third-party tools, or game/map exploit abuse. */
  Cheating = 'CHEATING',
  /** Stayed in the game but sabotaged it: feeding, intentional losing, AFK, refusing to play. */
  Griefing = 'GRIEFING',
  /** Anything else; the details field is required for this reason. */
  Other = 'OTHER',
}

/**
 * The outcome of resolving a report. `Dismissed` (unfounded / insufficient evidence) is kept
 * distinct from `Abusive` (the report itself was bad-faith) so the two never get conflated in the
 * reporter-credibility stats. Stored in the `resolution` TEXT column.
 */
export enum GameReportResolution {
  /** The report itself was bad-faith (false reporting, harassment-by-report). */
  Abusive = 'ABUSIVE',
  /** The report was valid and action was taken. */
  Actioned = 'ACTIONED',
  /** Unfounded or insufficient evidence. */
  Dismissed = 'DISMISSED',
  /** A valid duplicate of another report for the same target/game. */
  Duplicate = 'DUPLICATE',
}

export type MatchmakerConfigInput = {
  global: MatchmakerModeConfigOverridesInput
  maxPlayersExamined?: number | null | undefined
  perMode: Array<MatchmakerPerModeOverrideInput>
  searchIntervalSeconds?: number | null | undefined
}

/**
 * Stored (JSON) form of [`ModeConfig`]: a sparse set of knob overrides. Doubles as the GraphQL
 * `MatchmakerModeConfigOverrides` (output) / `MatchmakerModeConfigOverridesInput` (input) type, so
 * the admin form sends and receives exactly the shape that is persisted.
 */
export type MatchmakerModeConfigOverridesInput = {
  adaptiveComfortableMultiplier?: number | null | undefined
  adaptiveDecayPerMissing?: number | null | undefined
  minQuality?: number | null | undefined
  populationHalfLifeSeconds?: number | null | undefined
  uncertaintyK?: number | null | undefined
  weightLatency?: number | null | undefined
  weightRatingVariance?: number | null | undefined
  weightWinProb?: number | null | undefined
}

export type MatchmakerPerModeOverrideInput = {
  config: MatchmakerModeConfigOverridesInput
  matchmakingType: Types.MatchmakingType
}

export type ReportGameInput = {
  details?: string | null | undefined
  gameId: string
  reason: GameReportReason
  reportedUserId: Types.SbUserId
}

export enum RestrictedNameKind {
  Exact = 'EXACT',
  Regex = 'REGEX',
}

export enum RestrictedNameReason {
  Profanity = 'PROFANITY',
  Reserved = 'RESERVED',
}

export type SbPermissionsInput = {
  banUsers: boolean
  debug: boolean
  editPermissions: boolean
  /**
   * The user ID these permissions are for. This is mainly so the client has a key for caching
   * purposes, and is not generally used elsewhere.
   */
  id: Types.SbUserId
  manageBugReports: boolean
  manageGameReports: boolean
  manageLeagues: boolean
  manageMapPools: boolean
  manageMaps: boolean
  manageMatchmaking: boolean
  manageMatchmakingSeasons: boolean
  manageMatchmakingTimes: boolean
  manageNews: boolean
  manageRallyPointServers: boolean
  manageRestrictedNames: boolean
  manageSignupCodes: boolean
  massDeleteMaps: boolean
  moderateChatChannels: boolean
}

export type UrgentMessageInput = {
  message: string
  title: string
}

export type AdminMatchmakingConfigQueryVariables = Exact<{ [key: string]: never }>

export type AdminMatchmakingConfigQuery = {
  matchmakingConfig: {
    searchIntervalSeconds: number | null
    maxPlayersExamined: number | null
    global: {
      weightRatingVariance: number | null
      weightWinProb: number | null
      weightLatency: number | null
      uncertaintyK: number | null
      minQuality: number | null
      adaptiveComfortableMultiplier: number | null
      adaptiveDecayPerMissing: number | null
      populationHalfLifeSeconds: number | null
    }
    perMode: Array<{
      matchmakingType: Types.MatchmakingType
      config: {
        weightRatingVariance: number | null
        weightWinProb: number | null
        weightLatency: number | null
        uncertaintyK: number | null
        minQuality: number | null
        adaptiveComfortableMultiplier: number | null
        adaptiveDecayPerMissing: number | null
        populationHalfLifeSeconds: number | null
      }
    }>
    defaults: {
      searchIntervalSeconds: number
      maxPlayersExamined: number
      weightRatingVariance: number
      weightWinProb: number
      weightLatency: number
      uncertaintyK: number
      minQuality: number
      adaptiveComfortableMultiplier: number
      adaptiveDecayPerMissing: number
      populationHalfLifeSeconds: number
    }
  }
}

export type AdminUpdateMatchmakingConfigMutationVariables = Exact<{
  config: MatchmakerConfigInput
}>

export type AdminUpdateMatchmakingConfigMutation = {
  updateMatchmakingConfig: {
    searchIntervalSeconds: number | null
    maxPlayersExamined: number | null
    global: { minQuality: number | null }
  }
}

export type RestrictedNamesQueryVariables = Exact<{ [key: string]: never }>

export type RestrictedNamesQuery = {
  restrictedNames: Array<{
    id: number
    pattern: string
    kind: RestrictedNameKind
    reason: RestrictedNameReason
    createdAt: string
    createdBy: { id: Types.SbUserId } | null
  }>
}

export type DeleteRestrictedNameMutationVariables = Exact<{
  id: number
}>

export type DeleteRestrictedNameMutation = { userDeleteRestrictedName: number }

export type AddRestrictedNameMutationVariables = Exact<{
  pattern: string
  kind: RestrictedNameKind
  reason: RestrictedNameReason
}>

export type AddRestrictedNameMutation = {
  userAddRestrictedName: {
    id: number
    pattern: string
    kind: RestrictedNameKind
    reason: RestrictedNameReason
    createdAt: string
    createdBy: { id: Types.SbUserId } | null
  }
}

export type TestRestrictedNameMutationVariables = Exact<{
  name: string
}>

export type TestRestrictedNameMutation = {
  userTestRestrictedName: {
    id: number
    pattern: string
    kind: RestrictedNameKind
    reason: RestrictedNameReason
  } | null
}

export type SignupCodesQueryVariables = Exact<{
  includeExhausted?: boolean | null | undefined
}>

export type SignupCodesQuery = {
  signupCodes: Array<{
    id: string
    code: string
    createdAt: string
    expiresAt: string
    maxUses: number | null
    uses: number
    exhausted: boolean
    notes: string | null
    createdByUser: { id: Types.SbUserId; name: string } | null
  }>
}

export type CreateSignupCodeMutationVariables = Exact<{
  input: CreateSignupCodeInput
}>

export type CreateSignupCodeMutation = {
  createSignupCode: {
    id: string
    code: string
    createdAt: string
    expiresAt: string
    maxUses: number | null
    uses: number
    exhausted: boolean
    notes: string | null
    createdByUser: { id: Types.SbUserId } | null
  }
}

export type SetUrgentMessageMutationVariables = Exact<{
  message?: UrgentMessageInput | null | undefined
}>

export type SetUrgentMessageMutation = { newsSetUrgentMessage: boolean }

export type AdminGameReportsListQueryVariables = Exact<{
  filter?: GameReportFilter | null | undefined
  first?: number | null | undefined
  after?: string | null | undefined
}>

export type AdminGameReportsListQuery = {
  gameReports: {
    edges: Array<{
      node: {
        id: string
        reason: GameReportReason
        details: string | null
        createdAt: string
        resolvedAt: string | null
        resolution: GameReportResolution | null
        reporter: { id: Types.SbUserId } | null
        reportedUser: { id: Types.SbUserId } | null
      }
    }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

export type AdminGameReportQueryVariables = Exact<{
  id: string
}>

export type AdminGameReportQuery = {
  gameReport: {
    id: string
    reason: GameReportReason
    details: string | null
    createdAt: string
    resolvedAt: string | null
    resolution: GameReportResolution | null
    resolutionNotes: string | null
    reporter: { id: Types.SbUserId; name: string } | null
    reportedUser: { id: Types.SbUserId; name: string } | null
    resolver: { id: Types.SbUserId } | null
    game: { id: string } | null
    replay: { replayFileId: string; hash: string; url: string } | null
    reporterStats: {
      total: number
      actioned: number
      dismissed: number
      abusive: number
      duplicate: number
      pending: number
    }
    reportedUserStats: {
      total: number
      actioned: number
      dismissed: number
      abusive: number
      duplicate: number
      pending: number
    }
  } | null
}

export type ResolveGameReportMutationVariables = Exact<{
  id: string
  resolution: GameReportResolution
  notes?: string | null | undefined
}>

export type ResolveGameReportMutation = {
  resolveGameReport: {
    id: string
    resolvedAt: string | null
    resolution: GameReportResolution | null
    resolutionNotes: string | null
    resolver: { id: Types.SbUserId } | null
  }
}

export type GamesPageContentQueryVariables = Exact<{ [key: string]: never }>

export type GamesPageContentQuery = {
  ' $fragmentRefs'?: { LiveGames_FeedFragmentFragment: LiveGames_FeedFragmentFragment }
}

export type LiveGames_FeedFragmentFragment = {
  liveGames: Array<
    { id: string } & {
      ' $fragmentRefs'?: {
        LiveGames_FeedEntryFragmentFragment: LiveGames_FeedEntryFragmentFragment
      }
    }
  >
} & { ' $fragmentName'?: 'LiveGames_FeedFragmentFragment' }

export type LiveGames_FeedEntryFragmentFragment = ({
  id: string
  startTime: string
  map: {
    id: Types.SbMapId
    name: string
    mapFile: {
      id: string
      image256Url: string
      image512Url: string
      image1024Url: string
      image2048Url: string
      width: number
      height: number
    }
  }
  config:
    | { __typename: 'GameConfigDataLobby' }
    | {
        __typename: 'GameConfigDataMatchmaking'
        gameSourceExtra:
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
        teams: Array<
          Array<
            { user: { id: Types.SbUserId } | null } & {
              ' $fragmentRefs'?: {
                LiveGames_FeedEntryPlayersFragmentFragment: LiveGames_FeedEntryPlayersFragmentFragment
              }
            }
          >
        >
      }
} & {
  ' $fragmentRefs'?: {
    LiveGames_FeedEntryMapAndTypeFragmentFragment: LiveGames_FeedEntryMapAndTypeFragmentFragment
  }
}) & { ' $fragmentName'?: 'LiveGames_FeedEntryFragmentFragment' }

export type LiveGames_FeedEntryPlayersFragmentFragment = {
  race: Types.RaceChar
  user: { id: Types.SbUserId; name: string } | null
} & { ' $fragmentName'?: 'LiveGames_FeedEntryPlayersFragmentFragment' }

export type LiveGames_FeedEntryMapAndTypeFragmentFragment = {
  id: string
  map: {
    id: Types.SbMapId
    name: string
    mapFile: {
      id: string
      image256Url: string
      image512Url: string
      image1024Url: string
      image2048Url: string
      width: number
      height: number
    }
  }
  config:
    | { __typename: 'GameConfigDataLobby' }
    | {
        __typename: 'GameConfigDataMatchmaking'
        gameSourceExtra:
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
          | { matchmakingType: Types.MatchmakingType }
      }
} & { ' $fragmentName'?: 'LiveGames_FeedEntryMapAndTypeFragmentFragment' }

export type ReportGameMutationVariables = Exact<{
  input: ReportGameInput
}>

export type ReportGameMutation = { reportGame: { id: string } }

export type HomePageContentQueryVariables = Exact<{ [key: string]: never }>

export type HomePageContentQuery = {
  urgentMessage: {
    ' $fragmentRefs'?: {
      UrgentMessage_HomeDisplayFragmentFragment: UrgentMessage_HomeDisplayFragmentFragment
    }
  } | null
} & {
  ' $fragmentRefs'?: {
    LiveGames_FeedFragmentFragment: LiveGames_FeedFragmentFragment
    Leagues_HomeFeedFragmentFragment: Leagues_HomeFeedFragmentFragment
  }
}

export type UrgentMessage_HomeDisplayFragmentFragment = {
  id: string
  title: string
  message: string
} & { ' $fragmentName'?: 'UrgentMessage_HomeDisplayFragmentFragment' }

export type Leagues_LeagueBadgeFragmentFragment = { name: string; badgeUrl: string | null } & {
  ' $fragmentName'?: 'Leagues_LeagueBadgeFragmentFragment'
}

export type Leagues_HomeFeedFragmentFragment = {
  activeLeagues: Array<
    { id: string } & {
      ' $fragmentRefs'?: {
        Leagues_HomeFeedEntryFragmentFragment: Leagues_HomeFeedEntryFragmentFragment
      }
    }
  >
  futureLeagues: Array<
    { id: string } & {
      ' $fragmentRefs'?: {
        Leagues_HomeFeedEntryFragmentFragment: Leagues_HomeFeedEntryFragmentFragment
      }
    }
  >
} & { ' $fragmentName'?: 'Leagues_HomeFeedFragmentFragment' }

export type Leagues_HomeFeedEntryFragmentFragment = ({
  id: string
  name: string
  matchmakingType: Types.MatchmakingType
  startAt: string
  endAt: string
} & {
  ' $fragmentRefs'?: { Leagues_LeagueBadgeFragmentFragment: Leagues_LeagueBadgeFragmentFragment }
}) & { ' $fragmentName'?: 'Leagues_HomeFeedEntryFragmentFragment' }

export type AccountSettings_CurrentUserFragment = {
  id: Types.SbUserId
  name: string
  loginName: string
  email: string
  emailVerified: boolean
  lastLoginNameChange: string | null
  lastNameChange: string | null
  nameChangeTokens: number
  canChangeDisplayName: boolean
  nextDisplayNameChangeAllowedAt: string | null
} & { ' $fragmentName'?: 'AccountSettings_CurrentUserFragment' }

export type AccountSettingsQueryVariables = Exact<{ [key: string]: never }>

export type AccountSettingsQuery = {
  currentUser: {
    ' $fragmentRefs'?: { AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment }
  } | null
}

export type AccountSettingsChangePasswordMutationVariables = Exact<{
  currentPassword: string
  newPassword: string
}>

export type AccountSettingsChangePasswordMutation = {
  userUpdateCurrent: {
    ' $fragmentRefs'?: { AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment }
  }
}

export type AccountSettingsChangeEmailMutationVariables = Exact<{
  currentPassword: string
  email: string
}>

export type AccountSettingsChangeEmailMutation = {
  userUpdateCurrent: {
    ' $fragmentRefs'?: { AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment }
  }
}

export type AccountSettingsChangeDisplayNameMutationVariables = Exact<{
  currentPassword: string
  name: string
}>

export type AccountSettingsChangeDisplayNameMutation = {
  userUpdateCurrent: {
    ' $fragmentRefs'?: { AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment }
  }
}

export type AccountSettingsChangeLoginNameMutationVariables = Exact<{
  currentPassword: string
  loginName: string
}>

export type AccountSettingsChangeLoginNameMutation = {
  userUpdateCurrent: {
    ' $fragmentRefs'?: { AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment }
  }
}

export type UserNameAuditHistoryQueryVariables = Exact<{
  userId: Types.SbUserId
  displayNameLimit?: number | null | undefined
  displayNameOffset?: number | null | undefined
  loginNameLimit?: number | null | undefined
  loginNameOffset?: number | null | undefined
}>

export type UserNameAuditHistoryQuery = {
  userDisplayNameAuditHistory: Array<{
    id: string
    oldName: string
    newName: string
    changedAt: string
    changeReason: string | null
    ipAddress: string | null
    userAgent: string | null
    usedToken: boolean
    changedByUser: { id: Types.SbUserId } | null
  }>
  userLoginNameAuditHistory: Array<{
    id: string
    oldLoginName: string
    newLoginName: string
    changedAt: string
    changeReason: string | null
    ipAddress: string | null
    userAgent: string | null
  }>
}

export type AdminUserProfileQueryVariables = Exact<{
  userId: Types.SbUserId
  includePermissions: boolean
}>

export type AdminUserProfileQuery = {
  user:
    | ({ id: Types.SbUserId } & {
        id?: Types.SbUserId
        permissions?: {
          id: Types.SbUserId
          editPermissions: boolean
          debug: boolean
          banUsers: boolean
          manageLeagues: boolean
          manageMaps: boolean
          manageMapPools: boolean
          manageMatchmaking: boolean
          manageMatchmakingTimes: boolean
          manageMatchmakingSeasons: boolean
          manageRallyPointServers: boolean
          massDeleteMaps: boolean
          moderateChatChannels: boolean
          manageNews: boolean
          manageBugReports: boolean
          manageGameReports: boolean
          manageRestrictedNames: boolean
          manageSignupCodes: boolean
        }
      })
    | null
}

export type AdminUserProfile_PermissionsFragment = {
  id: Types.SbUserId
  permissions: {
    id: Types.SbUserId
    editPermissions: boolean
    debug: boolean
    banUsers: boolean
    manageLeagues: boolean
    manageMaps: boolean
    manageMapPools: boolean
    manageMatchmaking: boolean
    manageMatchmakingTimes: boolean
    manageMatchmakingSeasons: boolean
    manageRallyPointServers: boolean
    massDeleteMaps: boolean
    moderateChatChannels: boolean
    manageNews: boolean
    manageBugReports: boolean
    manageGameReports: boolean
    manageRestrictedNames: boolean
    manageSignupCodes: boolean
  }
} & { ' $fragmentName'?: 'AdminUserProfile_PermissionsFragment' }

export type AdminUpdateUserPermissionsMutationVariables = Exact<{
  userId: Types.SbUserId
  permissions: SbPermissionsInput
}>

export type AdminUpdateUserPermissionsMutation = {
  userUpdatePermissions: {
    ' $fragmentRefs'?: {
      AdminUserProfile_PermissionsFragment: AdminUserProfile_PermissionsFragment
    }
  }
}

export const LiveGames_FeedEntryPlayersFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'GamePlayer' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'user' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'race' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<LiveGames_FeedEntryPlayersFragmentFragment, unknown>
export const LiveGames_FeedEntryMapAndTypeFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<LiveGames_FeedEntryMapAndTypeFragmentFragment, unknown>
export const LiveGames_FeedEntryFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startTime' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'teams' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'user' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                ],
                              },
                            },
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'FragmentSpread',
            name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'GamePlayer' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'user' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'race' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<LiveGames_FeedEntryFragmentFragment, unknown>
export const LiveGames_FeedFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'liveGames' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'LiveGames_FeedEntryFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'GamePlayer' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'user' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'race' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startTime' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'teams' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'user' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                ],
                              },
                            },
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'FragmentSpread',
            name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<LiveGames_FeedFragmentFragment, unknown>
export const UrgentMessage_HomeDisplayFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'UrgentMessage_HomeDisplayFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'UrgentMessage' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'title' } },
          { kind: 'Field', name: { kind: 'Name', value: 'message' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<UrgentMessage_HomeDisplayFragmentFragment, unknown>
export const Leagues_LeagueBadgeFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_LeagueBadgeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'League' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'badgeUrl' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<Leagues_LeagueBadgeFragmentFragment, unknown>
export const Leagues_HomeFeedEntryFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_HomeFeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'League' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'endAt' } },
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'Leagues_LeagueBadgeFragment' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_LeagueBadgeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'League' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'badgeUrl' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<Leagues_HomeFeedEntryFragmentFragment, unknown>
export const Leagues_HomeFeedFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_HomeFeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'activeLeagues' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'Leagues_HomeFeedEntryFragment' },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'futureLeagues' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'Leagues_HomeFeedEntryFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_LeagueBadgeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'League' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'badgeUrl' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_HomeFeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'League' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'endAt' } },
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'Leagues_LeagueBadgeFragment' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<Leagues_HomeFeedFragmentFragment, unknown>
export const AccountSettings_CurrentUserFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'loginName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'email' } },
          { kind: 'Field', name: { kind: 'Name', value: 'emailVerified' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastLoginNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nameChangeTokens' } },
          { kind: 'Field', name: { kind: 'Name', value: 'canChangeDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nextDisplayNameChangeAllowedAt' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AccountSettings_CurrentUserFragment, unknown>
export const AdminUserProfile_PermissionsFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AdminUserProfile_Permissions' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'permissions' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'editPermissions' } },
                { kind: 'Field', name: { kind: 'Name', value: 'debug' } },
                { kind: 'Field', name: { kind: 'Name', value: 'banUsers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLeagues' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMapPools' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmaking' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRallyPointServers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageGameReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageSignupCodes' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminUserProfile_PermissionsFragment, unknown>
export const AdminMatchmakingConfigDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminMatchmakingConfig' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'matchmakingConfig' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'searchIntervalSeconds' } },
                { kind: 'Field', name: { kind: 'Name', value: 'maxPlayersExamined' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'global' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'weightRatingVariance' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'weightWinProb' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'weightLatency' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'uncertaintyK' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'minQuality' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'adaptiveComfortableMultiplier' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'adaptiveDecayPerMissing' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'populationHalfLifeSeconds' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'perMode' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'config' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'weightRatingVariance' },
                            },
                            { kind: 'Field', name: { kind: 'Name', value: 'weightWinProb' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'weightLatency' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'uncertaintyK' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'minQuality' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'adaptiveComfortableMultiplier' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'adaptiveDecayPerMissing' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'populationHalfLifeSeconds' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'defaults' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'searchIntervalSeconds' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'maxPlayersExamined' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'weightRatingVariance' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'weightWinProb' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'weightLatency' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'uncertaintyK' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'minQuality' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'adaptiveComfortableMultiplier' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'adaptiveDecayPerMissing' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'populationHalfLifeSeconds' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminMatchmakingConfigQuery, AdminMatchmakingConfigQueryVariables>
export const AdminUpdateMatchmakingConfigDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AdminUpdateMatchmakingConfig' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'config' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'MatchmakerConfigInput' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'updateMatchmakingConfig' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'config' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'config' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'searchIntervalSeconds' } },
                { kind: 'Field', name: { kind: 'Name', value: 'maxPlayersExamined' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'global' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'minQuality' } }],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AdminUpdateMatchmakingConfigMutation,
  AdminUpdateMatchmakingConfigMutationVariables
>
export const RestrictedNamesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'RestrictedNames' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'restrictedNames' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'pattern' } },
                { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                { kind: 'Field', name: { kind: 'Name', value: 'reason' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'createdBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<RestrictedNamesQuery, RestrictedNamesQueryVariables>
export const DeleteRestrictedNameDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'DeleteRestrictedName' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userDeleteRestrictedName' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<DeleteRestrictedNameMutation, DeleteRestrictedNameMutationVariables>
export const AddRestrictedNameDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AddRestrictedName' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'pattern' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'kind' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'RestrictedNameKind' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'reason' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'RestrictedNameReason' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userAddRestrictedName' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'pattern' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'pattern' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'kind' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'kind' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'reason' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'reason' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'pattern' } },
                { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                { kind: 'Field', name: { kind: 'Name', value: 'reason' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'createdBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AddRestrictedNameMutation, AddRestrictedNameMutationVariables>
export const TestRestrictedNameDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'TestRestrictedName' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'name' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userTestRestrictedName' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'name' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'name' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'pattern' } },
                { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                { kind: 'Field', name: { kind: 'Name', value: 'reason' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<TestRestrictedNameMutation, TestRestrictedNameMutationVariables>
export const SignupCodesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'SignupCodes' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'includeExhausted' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Boolean' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'signupCodes' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'includeExhausted' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'includeExhausted' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'createdByUser' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                    ],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'expiresAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'maxUses' } },
                { kind: 'Field', name: { kind: 'Name', value: 'uses' } },
                { kind: 'Field', name: { kind: 'Name', value: 'exhausted' } },
                { kind: 'Field', name: { kind: 'Name', value: 'notes' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<SignupCodesQuery, SignupCodesQueryVariables>
export const CreateSignupCodeDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'CreateSignupCode' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'CreateSignupCodeInput' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'createSignupCode' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'input' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'createdByUser' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'expiresAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'maxUses' } },
                { kind: 'Field', name: { kind: 'Name', value: 'uses' } },
                { kind: 'Field', name: { kind: 'Name', value: 'exhausted' } },
                { kind: 'Field', name: { kind: 'Name', value: 'notes' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<CreateSignupCodeMutation, CreateSignupCodeMutationVariables>
export const SetUrgentMessageDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'SetUrgentMessage' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'message' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'UrgentMessageInput' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'newsSetUrgentMessage' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'message' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'message' } },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<SetUrgentMessageMutation, SetUrgentMessageMutationVariables>
export const AdminGameReportsListDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminGameReportsList' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'GameReportFilter' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'gameReports' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'after' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'edges' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'node' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'reason' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'details' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'resolution' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'reporter' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                ],
                              },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'reportedUser' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'pageInfo' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'hasNextPage' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'endCursor' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminGameReportsListQuery, AdminGameReportsListQueryVariables>
export const AdminGameReportDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminGameReport' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'UUID' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'gameReport' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'reason' } },
                { kind: 'Field', name: { kind: 'Name', value: 'details' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolution' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolutionNotes' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'reporter' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'reportedUser' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'resolver' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'game' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'replay' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'replayFileId' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'hash' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'url' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'reporterStats' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'actioned' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'dismissed' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'abusive' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'duplicate' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'pending' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'reportedUserStats' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'actioned' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'dismissed' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'abusive' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'duplicate' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'pending' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminGameReportQuery, AdminGameReportQueryVariables>
export const ResolveGameReportDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'ResolveGameReport' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'UUID' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'resolution' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'GameReportResolution' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'notes' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'resolveGameReport' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'resolution' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'resolution' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'notes' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'notes' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolution' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolutionNotes' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'resolver' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ResolveGameReportMutation, ResolveGameReportMutationVariables>
export const GamesPageContentDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GamesPageContent' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'LiveGames_FeedFragment' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'GamePlayer' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'user' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'race' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startTime' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'teams' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'user' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                ],
                              },
                            },
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'FragmentSpread',
            name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'liveGames' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'LiveGames_FeedEntryFragment' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GamesPageContentQuery, GamesPageContentQueryVariables>
export const ReportGameDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'ReportGame' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'ReportGameInput' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'reportGame' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'input' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ReportGameMutation, ReportGameMutationVariables>
export const HomePageContentDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'HomePageContent' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'urgentMessage' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'UrgentMessage_HomeDisplayFragment' },
                },
              ],
            },
          },
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'LiveGames_FeedFragment' } },
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'Leagues_HomeFeedFragment' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'GamePlayer' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'user' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'race' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Game' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startTime' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapFile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'config' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                {
                  kind: 'InlineFragment',
                  typeCondition: {
                    kind: 'NamedType',
                    name: { kind: 'Name', value: 'GameConfigDataMatchmaking' },
                  },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'gameSourceExtra' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'teams' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'user' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                ],
                              },
                            },
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'LiveGames_FeedEntryPlayersFragment' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'FragmentSpread',
            name: { kind: 'Name', value: 'LiveGames_FeedEntryMapAndTypeFragment' },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_LeagueBadgeFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'League' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'badgeUrl' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_HomeFeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'League' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'endAt' } },
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'Leagues_LeagueBadgeFragment' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'UrgentMessage_HomeDisplayFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'UrgentMessage' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'title' } },
          { kind: 'Field', name: { kind: 'Name', value: 'message' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveGames_FeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'liveGames' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'LiveGames_FeedEntryFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'Leagues_HomeFeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'activeLeagues' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'Leagues_HomeFeedEntryFragment' },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'futureLeagues' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'Leagues_HomeFeedEntryFragment' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<HomePageContentQuery, HomePageContentQueryVariables>
export const AccountSettingsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AccountSettings' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'currentUser' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'loginName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'email' } },
          { kind: 'Field', name: { kind: 'Name', value: 'emailVerified' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastLoginNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nameChangeTokens' } },
          { kind: 'Field', name: { kind: 'Name', value: 'canChangeDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nextDisplayNameChangeAllowedAt' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AccountSettingsQuery, AccountSettingsQueryVariables>
export const AccountSettingsChangePasswordDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AccountSettingsChangePassword' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'currentPassword' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'newPassword' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userUpdateCurrent' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'currentPassword' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'currentPassword' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'changes' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'newPassword' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'newPassword' } },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'loginName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'email' } },
          { kind: 'Field', name: { kind: 'Name', value: 'emailVerified' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastLoginNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nameChangeTokens' } },
          { kind: 'Field', name: { kind: 'Name', value: 'canChangeDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nextDisplayNameChangeAllowedAt' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AccountSettingsChangePasswordMutation,
  AccountSettingsChangePasswordMutationVariables
>
export const AccountSettingsChangeEmailDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AccountSettingsChangeEmail' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'currentPassword' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'email' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userUpdateCurrent' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'currentPassword' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'currentPassword' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'changes' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'email' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'email' } },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'loginName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'email' } },
          { kind: 'Field', name: { kind: 'Name', value: 'emailVerified' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastLoginNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nameChangeTokens' } },
          { kind: 'Field', name: { kind: 'Name', value: 'canChangeDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nextDisplayNameChangeAllowedAt' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AccountSettingsChangeEmailMutation,
  AccountSettingsChangeEmailMutationVariables
>
export const AccountSettingsChangeDisplayNameDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AccountSettingsChangeDisplayName' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'currentPassword' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'name' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userUpdateCurrent' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'currentPassword' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'currentPassword' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'changes' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'name' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'name' } },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'loginName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'email' } },
          { kind: 'Field', name: { kind: 'Name', value: 'emailVerified' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastLoginNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nameChangeTokens' } },
          { kind: 'Field', name: { kind: 'Name', value: 'canChangeDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nextDisplayNameChangeAllowedAt' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AccountSettingsChangeDisplayNameMutation,
  AccountSettingsChangeDisplayNameMutationVariables
>
export const AccountSettingsChangeLoginNameDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AccountSettingsChangeLoginName' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'currentPassword' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'loginName' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userUpdateCurrent' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'currentPassword' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'currentPassword' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'changes' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'loginName' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'loginName' } },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AccountSettings_CurrentUser' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'loginName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'email' } },
          { kind: 'Field', name: { kind: 'Name', value: 'emailVerified' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastLoginNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'lastNameChange' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nameChangeTokens' } },
          { kind: 'Field', name: { kind: 'Name', value: 'canChangeDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'nextDisplayNameChangeAllowedAt' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AccountSettingsChangeLoginNameMutation,
  AccountSettingsChangeLoginNameMutationVariables
>
export const UserNameAuditHistoryDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'UserNameAuditHistory' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'displayNameLimit' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'displayNameOffset' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'loginNameLimit' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'loginNameOffset' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userDisplayNameAuditHistory' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'limit' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'displayNameLimit' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'offset' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'displayNameOffset' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'oldName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'newName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'changedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'changedByUser' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'changeReason' } },
                { kind: 'Field', name: { kind: 'Name', value: 'ipAddress' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userAgent' } },
                { kind: 'Field', name: { kind: 'Name', value: 'usedToken' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userLoginNameAuditHistory' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'limit' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'loginNameLimit' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'offset' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'loginNameOffset' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'oldLoginName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'newLoginName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'changedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'changeReason' } },
                { kind: 'Field', name: { kind: 'Name', value: 'ipAddress' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userAgent' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<UserNameAuditHistoryQuery, UserNameAuditHistoryQueryVariables>
export const AdminUserProfileDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminUserProfile' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'includePermissions' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Boolean' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'user' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'AdminUserProfile_Permissions' },
                  directives: [
                    {
                      kind: 'Directive',
                      name: { kind: 'Name', value: 'include' },
                      arguments: [
                        {
                          kind: 'Argument',
                          name: { kind: 'Name', value: 'if' },
                          value: {
                            kind: 'Variable',
                            name: { kind: 'Name', value: 'includePermissions' },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AdminUserProfile_Permissions' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'permissions' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'editPermissions' } },
                { kind: 'Field', name: { kind: 'Name', value: 'debug' } },
                { kind: 'Field', name: { kind: 'Name', value: 'banUsers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLeagues' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMapPools' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmaking' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRallyPointServers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageGameReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageSignupCodes' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminUserProfileQuery, AdminUserProfileQueryVariables>
export const AdminUpdateUserPermissionsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AdminUpdateUserPermissions' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'permissions' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbPermissionsInput' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userUpdatePermissions' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'permissions' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'permissions' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'AdminUserProfile_Permissions' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'AdminUserProfile_Permissions' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUser' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'permissions' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'editPermissions' } },
                { kind: 'Field', name: { kind: 'Name', value: 'debug' } },
                { kind: 'Field', name: { kind: 'Name', value: 'banUsers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLeagues' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMapPools' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmaking' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRallyPointServers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageGameReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageSignupCodes' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AdminUpdateUserPermissionsMutation,
  AdminUpdateUserPermissionsMutationVariables
>
