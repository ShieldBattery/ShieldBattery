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
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
  '\n  query RestrictedNames {\n    restrictedNames {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n': typeof types.RestrictedNamesDocument
  '\n  mutation DeleteRestrictedName($id: Int!) {\n    userDeleteRestrictedName(id: $id)\n  }\n': typeof types.DeleteRestrictedNameDocument
  '\n  mutation AddRestrictedName(\n    $pattern: String!\n    $kind: RestrictedNameKind!\n    $reason: RestrictedNameReason!\n  ) {\n    userAddRestrictedName(pattern: $pattern, kind: $kind, reason: $reason) {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n': typeof types.AddRestrictedNameDocument
  '\n  mutation TestRestrictedName($name: String!) {\n    userTestRestrictedName(name: $name) {\n      id\n      pattern\n      kind\n      reason\n    }\n  }\n': typeof types.TestRestrictedNameDocument
  '\n  mutation SetUrgentMessage($message: UrgentMessageInput) {\n    newsSetUrgentMessage(message: $message)\n  }\n': typeof types.SetUrgentMessageDocument
  '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...LiveGames_HomeFeedFragment\n    ...Leagues_HomeFeedFragment\n  }\n': typeof types.HomePageContentDocument
  '\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n  }\n': typeof types.UrgentMessage_HomeDisplayFragmentFragmentDoc
  '\n  fragment Leagues_HomeFeedFragment on Query {\n    activeLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n\n    futureLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n  }\n': typeof types.Leagues_HomeFeedFragmentFragmentDoc
  '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    matchmakingType\n    startAt\n    endAt\n  }\n': typeof types.Leagues_HomeFeedEntryFragmentFragmentDoc
  '\n  fragment LiveGames_HomeFeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_HomeFeedEntryFragment\n    }\n  }\n': typeof types.LiveGames_HomeFeedFragmentFragmentDoc
  '\n  fragment LiveGames_HomeFeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_HomeFeedEntryPlayersFragment\n        }\n      }\n    }\n\n    ...LiveGames_HomeFeedEntryMapAndTypeFragment\n  }\n': typeof types.LiveGames_HomeFeedEntryFragmentFragmentDoc
  '\n  fragment LiveGames_HomeFeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n': typeof types.LiveGames_HomeFeedEntryPlayersFragmentFragmentDoc
  '\n  fragment LiveGames_HomeFeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n': typeof types.LiveGames_HomeFeedEntryMapAndTypeFragmentFragmentDoc
  '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n  }\n': typeof types.AccountSettings_CurrentUserFragmentDoc
  '\n  query AccountSettings {\n    currentUser {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsDocument
  '\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangePasswordDocument
  '\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangeEmailDocument
  '\n  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {\n    user(id: $userId) {\n      id\n      ...AdminUserProfile_Permissions @include(if: $includePermissions)\n    }\n  }\n': typeof types.AdminUserProfileDocument
  '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      manageRallyPointServers\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageRestrictedNames\n    }\n  }\n': typeof types.AdminUserProfile_PermissionsFragmentDoc
  '\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n': typeof types.AdminUpdateUserPermissionsDocument
}
const documents: Documents = {
  '\n  query RestrictedNames {\n    restrictedNames {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n':
    types.RestrictedNamesDocument,
  '\n  mutation DeleteRestrictedName($id: Int!) {\n    userDeleteRestrictedName(id: $id)\n  }\n':
    types.DeleteRestrictedNameDocument,
  '\n  mutation AddRestrictedName(\n    $pattern: String!\n    $kind: RestrictedNameKind!\n    $reason: RestrictedNameReason!\n  ) {\n    userAddRestrictedName(pattern: $pattern, kind: $kind, reason: $reason) {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n':
    types.AddRestrictedNameDocument,
  '\n  mutation TestRestrictedName($name: String!) {\n    userTestRestrictedName(name: $name) {\n      id\n      pattern\n      kind\n      reason\n    }\n  }\n':
    types.TestRestrictedNameDocument,
  '\n  mutation SetUrgentMessage($message: UrgentMessageInput) {\n    newsSetUrgentMessage(message: $message)\n  }\n':
    types.SetUrgentMessageDocument,
  '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...LiveGames_HomeFeedFragment\n    ...Leagues_HomeFeedFragment\n  }\n':
    types.HomePageContentDocument,
  '\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n  }\n':
    types.UrgentMessage_HomeDisplayFragmentFragmentDoc,
  '\n  fragment Leagues_HomeFeedFragment on Query {\n    activeLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n\n    futureLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n  }\n':
    types.Leagues_HomeFeedFragmentFragmentDoc,
  '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    matchmakingType\n    startAt\n    endAt\n  }\n':
    types.Leagues_HomeFeedEntryFragmentFragmentDoc,
  '\n  fragment LiveGames_HomeFeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_HomeFeedEntryFragment\n    }\n  }\n':
    types.LiveGames_HomeFeedFragmentFragmentDoc,
  '\n  fragment LiveGames_HomeFeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_HomeFeedEntryPlayersFragment\n        }\n      }\n    }\n\n    ...LiveGames_HomeFeedEntryMapAndTypeFragment\n  }\n':
    types.LiveGames_HomeFeedEntryFragmentFragmentDoc,
  '\n  fragment LiveGames_HomeFeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n':
    types.LiveGames_HomeFeedEntryPlayersFragmentFragmentDoc,
  '\n  fragment LiveGames_HomeFeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n':
    types.LiveGames_HomeFeedEntryMapAndTypeFragmentFragmentDoc,
  '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n  }\n':
    types.AccountSettings_CurrentUserFragmentDoc,
  '\n  query AccountSettings {\n    currentUser {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsDocument,
  '\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsChangePasswordDocument,
  '\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsChangeEmailDocument,
  '\n  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {\n    user(id: $userId) {\n      id\n      ...AdminUserProfile_Permissions @include(if: $includePermissions)\n    }\n  }\n':
    types.AdminUserProfileDocument,
  '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      manageRallyPointServers\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageRestrictedNames\n    }\n  }\n':
    types.AdminUserProfile_PermissionsFragmentDoc,
  '\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n':
    types.AdminUpdateUserPermissionsDocument,
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
  source: '\n  query RestrictedNames {\n    restrictedNames {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  query RestrictedNames {\n    restrictedNames {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteRestrictedName($id: Int!) {\n    userDeleteRestrictedName(id: $id)\n  }\n',
): (typeof documents)['\n  mutation DeleteRestrictedName($id: Int!) {\n    userDeleteRestrictedName(id: $id)\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AddRestrictedName(\n    $pattern: String!\n    $kind: RestrictedNameKind!\n    $reason: RestrictedNameReason!\n  ) {\n    userAddRestrictedName(pattern: $pattern, kind: $kind, reason: $reason) {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation AddRestrictedName(\n    $pattern: String!\n    $kind: RestrictedNameKind!\n    $reason: RestrictedNameReason!\n  ) {\n    userAddRestrictedName(pattern: $pattern, kind: $kind, reason: $reason) {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation TestRestrictedName($name: String!) {\n    userTestRestrictedName(name: $name) {\n      id\n      pattern\n      kind\n      reason\n    }\n  }\n',
): (typeof documents)['\n  mutation TestRestrictedName($name: String!) {\n    userTestRestrictedName(name: $name) {\n      id\n      pattern\n      kind\n      reason\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation SetUrgentMessage($message: UrgentMessageInput) {\n    newsSetUrgentMessage(message: $message)\n  }\n',
): (typeof documents)['\n  mutation SetUrgentMessage($message: UrgentMessageInput) {\n    newsSetUrgentMessage(message: $message)\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...LiveGames_HomeFeedFragment\n    ...Leagues_HomeFeedFragment\n  }\n',
): (typeof documents)['\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...LiveGames_HomeFeedFragment\n    ...Leagues_HomeFeedFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n  }\n',
): (typeof documents)['\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment Leagues_HomeFeedFragment on Query {\n    activeLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n\n    futureLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n  }\n',
): (typeof documents)['\n  fragment Leagues_HomeFeedFragment on Query {\n    activeLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n\n    futureLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    matchmakingType\n    startAt\n    endAt\n  }\n',
): (typeof documents)['\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    matchmakingType\n    startAt\n    endAt\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveGames_HomeFeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_HomeFeedEntryFragment\n    }\n  }\n',
): (typeof documents)['\n  fragment LiveGames_HomeFeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_HomeFeedEntryFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveGames_HomeFeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_HomeFeedEntryPlayersFragment\n        }\n      }\n    }\n\n    ...LiveGames_HomeFeedEntryMapAndTypeFragment\n  }\n',
): (typeof documents)['\n  fragment LiveGames_HomeFeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_HomeFeedEntryPlayersFragment\n        }\n      }\n    }\n\n    ...LiveGames_HomeFeedEntryMapAndTypeFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveGames_HomeFeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n',
): (typeof documents)['\n  fragment LiveGames_HomeFeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveGames_HomeFeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment LiveGames_HomeFeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n  }\n',
): (typeof documents)['\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n  }\n']
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
  source: '\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n',
): (typeof documents)['\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n',
): (typeof documents)['\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {\n    user(id: $userId) {\n      id\n      ...AdminUserProfile_Permissions @include(if: $includePermissions)\n    }\n  }\n',
): (typeof documents)['\n  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {\n    user(id: $userId) {\n      id\n      ...AdminUserProfile_Permissions @include(if: $includePermissions)\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      manageRallyPointServers\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageRestrictedNames\n    }\n  }\n',
): (typeof documents)['\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      manageRallyPointServers\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageRestrictedNames\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n',
): (typeof documents)['\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n']

export function graphql(source: string) {
  return (documents as any)[source] ?? {}
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never
