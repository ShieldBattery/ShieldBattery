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
  updateCurrentUser: CurrentUser
}

export type MutationUpdateCurrentUserArgs = {
  changes: UpdateCurrentUserChanges
  currentPassword: Scalars['String']['input']
}

export type Query = {
  __typename?: 'Query'
  currentUser?: Maybe<CurrentUser>
  user?: Maybe<User>
  userByDisplayName?: Maybe<User>
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
  manageRallyPointServers: Scalars['Boolean']['output']
  massDeleteMaps: Scalars['Boolean']['output']
  moderateChatChannels: Scalars['Boolean']['output']
}

export type UpdateCurrentUserChanges = {
  email?: InputMaybe<Scalars['String']['input']>
  newPassword?: InputMaybe<Scalars['String']['input']>
}

export type User = {
  __typename?: 'User'
  id: Scalars['Int']['output']
  /** The user's display name (may differ from their login name). */
  name: Scalars['String']['output']
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
