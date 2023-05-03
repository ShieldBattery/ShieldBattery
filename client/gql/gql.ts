/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import * as types from './graphql'

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 */
const documents = {
  '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    email\n    emailVerified\n  }\n':
    types.AccountSettings_CurrentUserFragmentDoc,
  '\n  query AccountSettings {\n    currentUser {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsDocument,
  '\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    updateCurrentUser(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsChangePasswordDocument,
  '\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    updateCurrentUser(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsChangeEmailDocument,
}

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    email\n    emailVerified\n  }\n',
): (typeof documents)['\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    email\n    emailVerified\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AccountSettings {\n    currentUser {\n      ...AccountSettings_CurrentUser\n    }\n  }\n',
): (typeof documents)['\n  query AccountSettings {\n    currentUser {\n      ...AccountSettings_CurrentUser\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    updateCurrentUser(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n',
): (typeof documents)['\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    updateCurrentUser(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    updateCurrentUser(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n',
): (typeof documents)['\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    updateCurrentUser(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n']

export function graphql(source: string) {
  return (documents as any)[source] ?? {}
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never
