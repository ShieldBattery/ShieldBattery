/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
export type Maybe<T> = T | null
export type InputMaybe<T> = Maybe<T>
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> }
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> }
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = {
  [_ in K]?: never
}
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string }
  String: { input: string; output: string }
  Boolean: { input: boolean; output: boolean }
  Int: { input: number; output: number }
  Float: { input: number; output: number }
  /**
   * Implement the DateTime<Utc> scalar
   *
   * The input/output is a string in RFC3339 format.
   */
  DateTime: { input: string; output: string }
  /**
   * A UUID is a unique 128-bit number, stored as 16 octets. UUIDs are parsed as
   * Strings within GraphQL. UUIDs are used to assign unique identifiers to
   * entities without requiring a central allocating authority.
   *
   * # References
   *
   * * [Wikipedia: Universally Unique Identifier](http://en.wikipedia.org/wiki/Universally_unique_identifier)
   * * [RFC4122: A Universally Unique IDentifier (UUID) URN Namespace](http://tools.ietf.org/html/rfc4122)
   */
  UUID: { input: string; output: string }
}

export type CurrentUser = {
  __typename?: 'CurrentUser'
  acceptedPrivacyVersion: Scalars['Int']['output']
  acceptedTermsVersion: Scalars['Int']['output']
  acceptedUsePolicyVersion: Scalars['Int']['output']
  email: Scalars['String']['output']
  emailVerified: Scalars['Boolean']['output']
  id: Scalars['Int']['output']
  locale?: Maybe<Scalars['String']['output']>
  /** The name the user logs in with (may differ from their display name). */
  loginName: Scalars['String']['output']
  /** The user's display name (may differ from their login name). */
  name: Scalars['String']['output']
  permissions: SbPermissions
}

export type Mutation = {
  __typename?: 'Mutation'
  newsCreatePost: NewsPost
  /** Sets (or clears, if message is not provided) the urgent message at the top of the home page. */
  newsSetUrgentMessage: Scalars['Boolean']['output']
  userAddRestrictedName: NameRestriction
  userDeleteRestrictedName: Scalars['Int']['output']
  userTestRestrictedName?: Maybe<NameRestriction>
  userUpdateCurrent: CurrentUser
  userUpdatePermissions: SbUser
}

export type MutationNewsCreatePostArgs = {
  post: NewsPostCreation
}

export type MutationNewsSetUrgentMessageArgs = {
  message?: InputMaybe<UrgentMessageInput>
}

export type MutationUserAddRestrictedNameArgs = {
  kind: RestrictedNameKind
  pattern: Scalars['String']['input']
  reason: RestrictedNameReason
}

export type MutationUserDeleteRestrictedNameArgs = {
  id: Scalars['Int']['input']
}

export type MutationUserTestRestrictedNameArgs = {
  name: Scalars['String']['input']
}

export type MutationUserUpdateCurrentArgs = {
  changes: UpdateCurrentUserChanges
  currentPassword: Scalars['String']['input']
}

export type MutationUserUpdatePermissionsArgs = {
  permissions: SbPermissionsInput
  userId: Scalars['Int']['input']
}

export type NameRestriction = {
  __typename?: 'NameRestriction'
  createdAt: Scalars['DateTime']['output']
  createdBy?: Maybe<SbUser>
  id: Scalars['Int']['output']
  kind: RestrictedNameKind
  pattern: Scalars['String']['output']
  reason: RestrictedNameReason
}

export type NewsPost = {
  __typename?: 'NewsPost'
  author?: Maybe<SbUser>
  content: Scalars['String']['output']
  coverImagePath?: Maybe<Scalars['String']['output']>
  id: Scalars['UUID']['output']
  publishedAt?: Maybe<Scalars['DateTime']['output']>
  summary: Scalars['String']['output']
  title: Scalars['String']['output']
  updatedAt: Scalars['DateTime']['output']
}

export type NewsPostConnection = {
  __typename?: 'NewsPostConnection'
  /** A list of edges. */
  edges: Array<NewsPostEdge>
  /** A list of nodes. */
  nodes: Array<NewsPost>
  /** Information to aid in pagination. */
  pageInfo: PageInfo
}

export type NewsPostCreation = {
  authorId?: InputMaybe<Scalars['Int']['input']>
  content: Scalars['String']['input']
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>
  summary: Scalars['String']['input']
  title: Scalars['String']['input']
}

/** An edge in a connection. */
export type NewsPostEdge = {
  __typename?: 'NewsPostEdge'
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output']
  /** The item at the end of the edge */
  node: NewsPost
}

/** Information about pagination in a connection */
export type PageInfo = {
  __typename?: 'PageInfo'
  /** When paginating forwards, the cursor to continue. */
  endCursor?: Maybe<Scalars['String']['output']>
  /** When paginating forwards, are there more items? */
  hasNextPage: Scalars['Boolean']['output']
  /** When paginating backwards, are there more items? */
  hasPreviousPage: Scalars['Boolean']['output']
  /** When paginating backwards, the cursor to continue. */
  startCursor?: Maybe<Scalars['String']['output']>
}

export type Query = {
  __typename?: 'Query'
  currentUser?: Maybe<CurrentUser>
  newsPosts: NewsPostConnection
  restrictedNames: Array<NameRestriction>
  urgentMessage?: Maybe<UrgentMessage>
  user?: Maybe<SbUser>
  userByDisplayName?: Maybe<SbUser>
}

export type QueryNewsPostsArgs = {
  after?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  first?: InputMaybe<Scalars['Int']['input']>
  includeUnpublished?: InputMaybe<Scalars['Boolean']['input']>
  last?: InputMaybe<Scalars['Int']['input']>
}

export type QueryUserArgs = {
  id: Scalars['Int']['input']
}

export type QueryUserByDisplayNameArgs = {
  name: Scalars['String']['input']
}

export enum RestrictedNameKind {
  Exact = 'EXACT',
  Regex = 'REGEX',
}

export enum RestrictedNameReason {
  Profanity = 'PROFANITY',
  Reserved = 'RESERVED',
}

export type SbPermissions = {
  __typename?: 'SbPermissions'
  banUsers: Scalars['Boolean']['output']
  debug: Scalars['Boolean']['output']
  editPermissions: Scalars['Boolean']['output']
  /**
   * The user ID these permissions are for. This is mainly so the client has a key for caching
   * purposes, and is not generally used elsewhere.
   */
  id: Scalars['Int']['output']
  manageBugReports: Scalars['Boolean']['output']
  manageLeagues: Scalars['Boolean']['output']
  manageMapPools: Scalars['Boolean']['output']
  manageMaps: Scalars['Boolean']['output']
  manageMatchmakingSeasons: Scalars['Boolean']['output']
  manageMatchmakingTimes: Scalars['Boolean']['output']
  manageNews: Scalars['Boolean']['output']
  manageRallyPointServers: Scalars['Boolean']['output']
  manageRestrictedNames: Scalars['Boolean']['output']
  massDeleteMaps: Scalars['Boolean']['output']
  moderateChatChannels: Scalars['Boolean']['output']
}

export type SbPermissionsInput = {
  banUsers: Scalars['Boolean']['input']
  debug: Scalars['Boolean']['input']
  editPermissions: Scalars['Boolean']['input']
  /**
   * The user ID these permissions are for. This is mainly so the client has a key for caching
   * purposes, and is not generally used elsewhere.
   */
  id: Scalars['Int']['input']
  manageBugReports: Scalars['Boolean']['input']
  manageLeagues: Scalars['Boolean']['input']
  manageMapPools: Scalars['Boolean']['input']
  manageMaps: Scalars['Boolean']['input']
  manageMatchmakingSeasons: Scalars['Boolean']['input']
  manageMatchmakingTimes: Scalars['Boolean']['input']
  manageNews: Scalars['Boolean']['input']
  manageRallyPointServers: Scalars['Boolean']['input']
  manageRestrictedNames: Scalars['Boolean']['input']
  massDeleteMaps: Scalars['Boolean']['input']
  moderateChatChannels: Scalars['Boolean']['input']
}

export type SbUser = {
  __typename?: 'SbUser'
  id: Scalars['Int']['output']
  /** The user's display name (may differ from their login name). */
  name: Scalars['String']['output']
  permissions: SbPermissions
}

export type UpdateCurrentUserChanges = {
  email?: InputMaybe<Scalars['String']['input']>
  newPassword?: InputMaybe<Scalars['String']['input']>
}

export type UrgentMessage = {
  __typename?: 'UrgentMessage'
  id: Scalars['UUID']['output']
  message: Scalars['String']['output']
  /** The time the message was published (in UTC). This will serialize as an RFC 3339 string. */
  publishedAt: Scalars['DateTime']['output']
  title: Scalars['String']['output']
}

export type UrgentMessageInput = {
  message: Scalars['String']['input']
  title: Scalars['String']['input']
}

export type RestrictedNamesQueryVariables = Exact<{ [key: string]: never }>

export type RestrictedNamesQuery = {
  __typename?: 'Query'
  restrictedNames: Array<{
    __typename?: 'NameRestriction'
    id: number
    pattern: string
    kind: RestrictedNameKind
    reason: RestrictedNameReason
    createdAt: string
    createdBy?: { __typename?: 'SbUser'; id: number } | null
  }>
}

export type DeleteRestrictedNameMutationVariables = Exact<{
  id: Scalars['Int']['input']
}>

export type DeleteRestrictedNameMutation = {
  __typename?: 'Mutation'
  userDeleteRestrictedName: number
}

export type AddRestrictedNameMutationVariables = Exact<{
  pattern: Scalars['String']['input']
  kind: RestrictedNameKind
  reason: RestrictedNameReason
}>

export type AddRestrictedNameMutation = {
  __typename?: 'Mutation'
  userAddRestrictedName: {
    __typename?: 'NameRestriction'
    id: number
    pattern: string
    kind: RestrictedNameKind
    reason: RestrictedNameReason
    createdAt: string
    createdBy?: { __typename?: 'SbUser'; id: number } | null
  }
}

export type TestRestrictedNameMutationVariables = Exact<{
  name: Scalars['String']['input']
}>

export type TestRestrictedNameMutation = {
  __typename?: 'Mutation'
  userTestRestrictedName?: {
    __typename?: 'NameRestriction'
    id: number
    pattern: string
    kind: RestrictedNameKind
    reason: RestrictedNameReason
  } | null
}

export type SetUrgentMessageMutationVariables = Exact<{
  message?: InputMaybe<UrgentMessageInput>
}>

export type SetUrgentMessageMutation = { __typename?: 'Mutation'; newsSetUrgentMessage: boolean }

export type HomePageContentQueryVariables = Exact<{ [key: string]: never }>

export type HomePageContentQuery = {
  __typename?: 'Query'
  urgentMessage?:
    | ({ __typename?: 'UrgentMessage' } & {
        ' $fragmentRefs'?: {
          UrgentMessage_HomeDisplayFragmentFragment: UrgentMessage_HomeDisplayFragmentFragment
        }
      })
    | null
}

export type UrgentMessage_HomeDisplayFragmentFragment = {
  __typename?: 'UrgentMessage'
  id: string
  title: string
  message: string
} & { ' $fragmentName'?: 'UrgentMessage_HomeDisplayFragmentFragment' }

export type AccountSettings_CurrentUserFragment = {
  __typename?: 'CurrentUser'
  id: number
  name: string
  loginName: string
  email: string
  emailVerified: boolean
} & { ' $fragmentName'?: 'AccountSettings_CurrentUserFragment' }

export type AccountSettingsQueryVariables = Exact<{ [key: string]: never }>

export type AccountSettingsQuery = {
  __typename?: 'Query'
  currentUser?:
    | ({ __typename?: 'CurrentUser' } & {
        ' $fragmentRefs'?: {
          AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment
        }
      })
    | null
}

export type AccountSettingsChangePasswordMutationVariables = Exact<{
  currentPassword: Scalars['String']['input']
  newPassword: Scalars['String']['input']
}>

export type AccountSettingsChangePasswordMutation = {
  __typename?: 'Mutation'
  userUpdateCurrent: { __typename?: 'CurrentUser' } & {
    ' $fragmentRefs'?: { AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment }
  }
}

export type AccountSettingsChangeEmailMutationVariables = Exact<{
  currentPassword: Scalars['String']['input']
  email: Scalars['String']['input']
}>

export type AccountSettingsChangeEmailMutation = {
  __typename?: 'Mutation'
  userUpdateCurrent: { __typename?: 'CurrentUser' } & {
    ' $fragmentRefs'?: { AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment }
  }
}

export type AdminUserProfileQueryVariables = Exact<{
  userId: Scalars['Int']['input']
  includePermissions: Scalars['Boolean']['input']
}>

export type AdminUserProfileQuery = {
  __typename?: 'Query'
  user?:
    | ({ __typename?: 'SbUser'; id: number } & {
        ' $fragmentRefs'?: {
          AdminUserProfile_PermissionsFragment: AdminUserProfile_PermissionsFragment
        }
      })
    | null
}

export type AdminUserProfile_PermissionsFragment = {
  __typename?: 'SbUser'
  id: number
  permissions: {
    __typename?: 'SbPermissions'
    id: number
    editPermissions: boolean
    debug: boolean
    banUsers: boolean
    manageLeagues: boolean
    manageMaps: boolean
    manageMapPools: boolean
    manageMatchmakingTimes: boolean
    manageMatchmakingSeasons: boolean
    manageRallyPointServers: boolean
    massDeleteMaps: boolean
    moderateChatChannels: boolean
    manageNews: boolean
    manageBugReports: boolean
    manageRestrictedNames: boolean
  }
} & { ' $fragmentName'?: 'AdminUserProfile_PermissionsFragment' }

export type AdminUpdateUserPermissionsMutationVariables = Exact<{
  userId: Scalars['Int']['input']
  permissions: SbPermissionsInput
}>

export type AdminUpdateUserPermissionsMutation = {
  __typename?: 'Mutation'
  userUpdatePermissions: { __typename?: 'SbUser' } & {
    ' $fragmentRefs'?: {
      AdminUserProfile_PermissionsFragment: AdminUserProfile_PermissionsFragment
    }
  }
}

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
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRallyPointServers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminUserProfile_PermissionsFragment, unknown>
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
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AccountSettingsChangeEmailMutation,
  AccountSettingsChangeEmailMutationVariables
>
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
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
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
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRallyPointServers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
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
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
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
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRallyPointServers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
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
