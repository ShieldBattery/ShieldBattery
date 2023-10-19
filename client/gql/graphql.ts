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
  DateTime: { input: any; output: any }
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
  UUID: { input: any; output: any }
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
  createNewsPost: NewsPost
  updateCurrentUser: CurrentUser
  updateUserPermissions: SbUser
}

export type MutationCreateNewsPostArgs = {
  post: NewsPostCreation
}

export type MutationUpdateCurrentUserArgs = {
  changes: UpdateCurrentUserChanges
  currentPassword: Scalars['String']['input']
}

export type MutationUpdateUserPermissionsArgs = {
  permissions: SbPermissionsInput
  userId: Scalars['Int']['input']
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

export type SbPermissions = {
  __typename?: 'SbPermissions'
  banUsers: Scalars['Boolean']['output']
  debug: Scalars['Boolean']['output']
  editPermissions: Scalars['Boolean']['output']
  manageLeagues: Scalars['Boolean']['output']
  manageMapPools: Scalars['Boolean']['output']
  manageMaps: Scalars['Boolean']['output']
  manageMatchmakingSeasons: Scalars['Boolean']['output']
  manageMatchmakingTimes: Scalars['Boolean']['output']
  manageNews: Scalars['Boolean']['output']
  manageRallyPointServers: Scalars['Boolean']['output']
  massDeleteMaps: Scalars['Boolean']['output']
  moderateChatChannels: Scalars['Boolean']['output']
}

export type SbPermissionsInput = {
  banUsers: Scalars['Boolean']['input']
  debug: Scalars['Boolean']['input']
  editPermissions: Scalars['Boolean']['input']
  manageLeagues: Scalars['Boolean']['input']
  manageMapPools: Scalars['Boolean']['input']
  manageMaps: Scalars['Boolean']['input']
  manageMatchmakingSeasons: Scalars['Boolean']['input']
  manageMatchmakingTimes: Scalars['Boolean']['input']
  manageNews: Scalars['Boolean']['input']
  manageRallyPointServers: Scalars['Boolean']['input']
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
  updateCurrentUser: { __typename?: 'CurrentUser' } & {
    ' $fragmentRefs'?: { AccountSettings_CurrentUserFragment: AccountSettings_CurrentUserFragment }
  }
}

export type AccountSettingsChangeEmailMutationVariables = Exact<{
  currentPassword: Scalars['String']['input']
  email: Scalars['String']['input']
}>

export type AccountSettingsChangeEmailMutation = {
  __typename?: 'Mutation'
  updateCurrentUser: { __typename?: 'CurrentUser' } & {
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
  }
} & { ' $fragmentName'?: 'AdminUserProfile_PermissionsFragment' }

export type AdminUpdateUserPermissionsMutationVariables = Exact<{
  userId: Scalars['Int']['input']
  permissions: SbPermissionsInput
}>

export type AdminUpdateUserPermissionsMutation = {
  __typename?: 'Mutation'
  updateUserPermissions: { __typename?: 'SbUser' } & {
    ' $fragmentRefs'?: {
      AdminUserProfile_PermissionsFragment: AdminUserProfile_PermissionsFragment
    }
  }
}

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
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminUserProfile_PermissionsFragment, unknown>
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
            name: { kind: 'Name', value: 'updateCurrentUser' },
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
            name: { kind: 'Name', value: 'updateCurrentUser' },
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
            name: { kind: 'Name', value: 'updateUserPermissions' },
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
