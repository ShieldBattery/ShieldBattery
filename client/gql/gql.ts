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
  '\n  query AdminMatchmakingConfig {\n    matchmakingConfig {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n      }\n      perMode {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n        }\n      }\n      defaults {\n        searchIntervalSeconds\n        maxPlayersExamined\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n      }\n    }\n  }\n': typeof types.AdminMatchmakingConfigDocument
  '\n  mutation AdminUpdateMatchmakingConfig($config: MatchmakerConfigInput!) {\n    updateMatchmakingConfig(config: $config) {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        minQuality\n      }\n    }\n  }\n': typeof types.AdminUpdateMatchmakingConfigDocument
  '\n  query RestrictedNames {\n    restrictedNames {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n': typeof types.RestrictedNamesDocument
  '\n  mutation DeleteRestrictedName($id: Int!) {\n    userDeleteRestrictedName(id: $id)\n  }\n': typeof types.DeleteRestrictedNameDocument
  '\n  mutation AddRestrictedName(\n    $pattern: String!\n    $kind: RestrictedNameKind!\n    $reason: RestrictedNameReason!\n  ) {\n    userAddRestrictedName(pattern: $pattern, kind: $kind, reason: $reason) {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n': typeof types.AddRestrictedNameDocument
  '\n  mutation TestRestrictedName($name: String!) {\n    userTestRestrictedName(name: $name) {\n      id\n      pattern\n      kind\n      reason\n    }\n  }\n': typeof types.TestRestrictedNameDocument
  '\n  query SignupCodes($includeExhausted: Boolean) {\n    signupCodes(includeExhausted: $includeExhausted) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n        name\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n': typeof types.SignupCodesDocument
  '\n  mutation CreateSignupCode($input: CreateSignupCodeInput!) {\n    createSignupCode(input: $input) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n': typeof types.CreateSignupCodeDocument
  '\n  mutation SetUrgentMessage($message: UrgentMessageInput) {\n    newsSetUrgentMessage(message: $message)\n  }\n': typeof types.SetUrgentMessageDocument
  '\n  query AdminGameReportsList($filter: GameReportFilter, $first: Int, $after: String) {\n    gameReports(filter: $filter, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          reason\n          details\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          reportedUser {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n': typeof types.AdminGameReportsListDocument
  '\n  query AdminGameReport($id: UUID!) {\n    gameReport(id: $id) {\n      id\n      reason\n      details\n      createdAt\n      resolvedAt\n      resolution\n      resolutionNotes\n      reporter {\n        id\n        name\n      }\n      reportedUser {\n        id\n        name\n      }\n      resolver {\n        id\n      }\n      game {\n        id\n        config {\n          __typename\n          ... on GameConfigDataLobby {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n          ... on GameConfigDataMatchmaking {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n        }\n      }\n      replay {\n        replayFileId\n        hash\n        url\n      }\n      reporterStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      reportedUserStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      siblingReports {\n        id\n        reason\n        details\n        createdAt\n        resolvedAt\n        resolution\n        reporter {\n          id\n        }\n      }\n    }\n  }\n': typeof types.AdminGameReportDocument
  '\n  mutation ResolveGameReport($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveGameReport(id: $id, resolution: $resolution, notes: $notes) {\n      id\n      resolvedAt\n      resolution\n      resolutionNotes\n      resolver {\n        id\n      }\n    }\n  }\n': typeof types.ResolveGameReportDocument
  '\n  mutation ResolveSiblingReports($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveSiblingReports(id: $id, resolution: $resolution, notes: $notes)\n  }\n': typeof types.ResolveSiblingReportsDocument
  '\n  query GamesPageContent {\n    ...LiveGames_FeedFragment\n  }\n': typeof types.GamesPageContentDocument
  '\n  fragment LiveGames_FeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n': typeof types.LiveGames_FeedFragmentFragmentDoc
  '\n  fragment LiveGames_FeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_FeedEntryPlayersFragment\n        }\n      }\n    }\n\n    ...LiveGames_FeedEntryMapAndTypeFragment\n  }\n': typeof types.LiveGames_FeedEntryFragmentFragmentDoc
  '\n  fragment LiveGames_FeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n': typeof types.LiveGames_FeedEntryPlayersFragmentFragmentDoc
  '\n  fragment LiveGames_FeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n': typeof types.LiveGames_FeedEntryMapAndTypeFragmentFragmentDoc
  '\n  mutation ReportGame($input: ReportGameInput!) {\n    reportGame(input: $input) {\n      id\n    }\n  }\n': typeof types.ReportGameDocument
  '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...LiveGames_FeedFragment\n    ...LiveStreams_FeedFragment\n    ...Leagues_HomeFeedFragment\n  }\n': typeof types.HomePageContentDocument
  '\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n  }\n': typeof types.UrgentMessage_HomeDisplayFragmentFragmentDoc
  '\n  fragment Leagues_LeagueBadgeFragment on League {\n    name\n    badgeUrl\n  }\n': typeof types.Leagues_LeagueBadgeFragmentFragmentDoc
  '\n  fragment Leagues_HomeFeedFragment on Query {\n    activeLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n\n    futureLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n  }\n': typeof types.Leagues_HomeFeedFragmentFragmentDoc
  '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    matchmakingType\n    startAt\n    endAt\n    ...Leagues_LeagueBadgeFragment\n  }\n': typeof types.Leagues_HomeFeedEntryFragmentFragmentDoc
  '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n    lastLoginNameChange\n    lastNameChange\n    nameChangeTokens\n    canChangeDisplayName\n    nextDisplayNameChangeAllowedAt\n  }\n': typeof types.AccountSettings_CurrentUserFragmentDoc
  '\n  query AccountSettings {\n    currentUser {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsDocument
  '\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangePasswordDocument
  '\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangeEmailDocument
  '\n  mutation AccountSettingsChangeDisplayName($currentPassword: String!, $name: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { name: $name }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangeDisplayNameDocument
  '\n  mutation AccountSettingsChangeLoginName($currentPassword: String!, $loginName: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { loginName: $loginName }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangeLoginNameDocument
  '\n  query ConnectionSettings {\n    myTwitchConnection {\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n': typeof types.ConnectionSettingsDocument
  '\n  mutation ConnectionSettingsStartTwitchLink($desktop: Boolean!) {\n    twitchStartLink(desktop: $desktop) {\n      url\n    }\n  }\n': typeof types.ConnectionSettingsStartTwitchLinkDocument
  '\n  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {\n    twitchCompleteLink(code: $code, state: $state) {\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n': typeof types.ConnectionSettingsCompleteTwitchLinkDocument
  '\n  mutation ConnectionSettingsUnlinkTwitch {\n    twitchUnlink\n  }\n': typeof types.ConnectionSettingsUnlinkTwitchDocument
  '\n  query LiveUserIds {\n    liveStreamUserIds\n  }\n': typeof types.LiveUserIdsDocument
  '\n  fragment LiveStreams_FeedFragment on Query {\n    liveStreams {\n      twitchLogin\n      viewerCount\n      ...LiveStreams_FeedEntryFragment\n    }\n  }\n': typeof types.LiveStreams_FeedFragmentFragmentDoc
  '\n  fragment LiveStreams_FeedEntryFragment on LiveStream {\n    twitchLogin\n    twitchDisplayName\n    title\n    viewerCount\n    startedAt\n    thumbnailUrl\n    user {\n      id\n      name\n    }\n  }\n': typeof types.LiveStreams_FeedEntryFragmentFragmentDoc
  '\n  query UserNameAuditHistory(\n    $userId: SbUserId!\n    $displayNameLimit: Int\n    $displayNameOffset: Int\n    $loginNameLimit: Int\n    $loginNameOffset: Int\n  ) {\n    userDisplayNameAuditHistory(\n      userId: $userId\n      limit: $displayNameLimit\n      offset: $displayNameOffset\n    ) {\n      id\n      oldName\n      newName\n      changedAt\n      changedByUser {\n        id\n      }\n      changeReason\n      ipAddress\n      userAgent\n      usedToken\n    }\n    userLoginNameAuditHistory(userId: $userId, limit: $loginNameLimit, offset: $loginNameOffset) {\n      id\n      oldLoginName\n      newLoginName\n      changedAt\n      changeReason\n      ipAddress\n      userAgent\n    }\n  }\n': typeof types.UserNameAuditHistoryDocument
  '\n  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {\n    user(id: $userId) {\n      id\n      ...AdminUserProfile_Permissions @include(if: $includePermissions)\n    }\n  }\n': typeof types.AdminUserProfileDocument
  '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmaking\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      manageRallyPointServers\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageGameReports\n      manageRestrictedNames\n      manageSignupCodes\n    }\n  }\n': typeof types.AdminUserProfile_PermissionsFragmentDoc
  '\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n': typeof types.AdminUpdateUserPermissionsDocument
  '\n  query UserProfileOverlayLive($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      liveStream {\n        twitchLogin\n        title\n        viewerCount\n      }\n    }\n  }\n': typeof types.UserProfileOverlayLiveDocument
  '\n  query UserProfileTwitch($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      twitchChannel {\n        twitchLogin\n        twitchDisplayName\n      }\n      liveStream {\n        twitchLogin\n        title\n        gameName\n        viewerCount\n        startedAt\n        thumbnailUrl\n      }\n    }\n  }\n': typeof types.UserProfileTwitchDocument
}
const documents: Documents = {
  '\n  query AdminMatchmakingConfig {\n    matchmakingConfig {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n      }\n      perMode {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n        }\n      }\n      defaults {\n        searchIntervalSeconds\n        maxPlayersExamined\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n      }\n    }\n  }\n':
    types.AdminMatchmakingConfigDocument,
  '\n  mutation AdminUpdateMatchmakingConfig($config: MatchmakerConfigInput!) {\n    updateMatchmakingConfig(config: $config) {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        minQuality\n      }\n    }\n  }\n':
    types.AdminUpdateMatchmakingConfigDocument,
  '\n  query RestrictedNames {\n    restrictedNames {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n':
    types.RestrictedNamesDocument,
  '\n  mutation DeleteRestrictedName($id: Int!) {\n    userDeleteRestrictedName(id: $id)\n  }\n':
    types.DeleteRestrictedNameDocument,
  '\n  mutation AddRestrictedName(\n    $pattern: String!\n    $kind: RestrictedNameKind!\n    $reason: RestrictedNameReason!\n  ) {\n    userAddRestrictedName(pattern: $pattern, kind: $kind, reason: $reason) {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n':
    types.AddRestrictedNameDocument,
  '\n  mutation TestRestrictedName($name: String!) {\n    userTestRestrictedName(name: $name) {\n      id\n      pattern\n      kind\n      reason\n    }\n  }\n':
    types.TestRestrictedNameDocument,
  '\n  query SignupCodes($includeExhausted: Boolean) {\n    signupCodes(includeExhausted: $includeExhausted) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n        name\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n':
    types.SignupCodesDocument,
  '\n  mutation CreateSignupCode($input: CreateSignupCodeInput!) {\n    createSignupCode(input: $input) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n':
    types.CreateSignupCodeDocument,
  '\n  mutation SetUrgentMessage($message: UrgentMessageInput) {\n    newsSetUrgentMessage(message: $message)\n  }\n':
    types.SetUrgentMessageDocument,
  '\n  query AdminGameReportsList($filter: GameReportFilter, $first: Int, $after: String) {\n    gameReports(filter: $filter, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          reason\n          details\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          reportedUser {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n':
    types.AdminGameReportsListDocument,
  '\n  query AdminGameReport($id: UUID!) {\n    gameReport(id: $id) {\n      id\n      reason\n      details\n      createdAt\n      resolvedAt\n      resolution\n      resolutionNotes\n      reporter {\n        id\n        name\n      }\n      reportedUser {\n        id\n        name\n      }\n      resolver {\n        id\n      }\n      game {\n        id\n        config {\n          __typename\n          ... on GameConfigDataLobby {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n          ... on GameConfigDataMatchmaking {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n        }\n      }\n      replay {\n        replayFileId\n        hash\n        url\n      }\n      reporterStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      reportedUserStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      siblingReports {\n        id\n        reason\n        details\n        createdAt\n        resolvedAt\n        resolution\n        reporter {\n          id\n        }\n      }\n    }\n  }\n':
    types.AdminGameReportDocument,
  '\n  mutation ResolveGameReport($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveGameReport(id: $id, resolution: $resolution, notes: $notes) {\n      id\n      resolvedAt\n      resolution\n      resolutionNotes\n      resolver {\n        id\n      }\n    }\n  }\n':
    types.ResolveGameReportDocument,
  '\n  mutation ResolveSiblingReports($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveSiblingReports(id: $id, resolution: $resolution, notes: $notes)\n  }\n':
    types.ResolveSiblingReportsDocument,
  '\n  query GamesPageContent {\n    ...LiveGames_FeedFragment\n  }\n':
    types.GamesPageContentDocument,
  '\n  fragment LiveGames_FeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n':
    types.LiveGames_FeedFragmentFragmentDoc,
  '\n  fragment LiveGames_FeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_FeedEntryPlayersFragment\n        }\n      }\n    }\n\n    ...LiveGames_FeedEntryMapAndTypeFragment\n  }\n':
    types.LiveGames_FeedEntryFragmentFragmentDoc,
  '\n  fragment LiveGames_FeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n':
    types.LiveGames_FeedEntryPlayersFragmentFragmentDoc,
  '\n  fragment LiveGames_FeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n':
    types.LiveGames_FeedEntryMapAndTypeFragmentFragmentDoc,
  '\n  mutation ReportGame($input: ReportGameInput!) {\n    reportGame(input: $input) {\n      id\n    }\n  }\n':
    types.ReportGameDocument,
  '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...LiveGames_FeedFragment\n    ...LiveStreams_FeedFragment\n    ...Leagues_HomeFeedFragment\n  }\n':
    types.HomePageContentDocument,
  '\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n  }\n':
    types.UrgentMessage_HomeDisplayFragmentFragmentDoc,
  '\n  fragment Leagues_LeagueBadgeFragment on League {\n    name\n    badgeUrl\n  }\n':
    types.Leagues_LeagueBadgeFragmentFragmentDoc,
  '\n  fragment Leagues_HomeFeedFragment on Query {\n    activeLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n\n    futureLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n  }\n':
    types.Leagues_HomeFeedFragmentFragmentDoc,
  '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    matchmakingType\n    startAt\n    endAt\n    ...Leagues_LeagueBadgeFragment\n  }\n':
    types.Leagues_HomeFeedEntryFragmentFragmentDoc,
  '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n    lastLoginNameChange\n    lastNameChange\n    nameChangeTokens\n    canChangeDisplayName\n    nextDisplayNameChangeAllowedAt\n  }\n':
    types.AccountSettings_CurrentUserFragmentDoc,
  '\n  query AccountSettings {\n    currentUser {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsDocument,
  '\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsChangePasswordDocument,
  '\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsChangeEmailDocument,
  '\n  mutation AccountSettingsChangeDisplayName($currentPassword: String!, $name: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { name: $name }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsChangeDisplayNameDocument,
  '\n  mutation AccountSettingsChangeLoginName($currentPassword: String!, $loginName: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { loginName: $loginName }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n':
    types.AccountSettingsChangeLoginNameDocument,
  '\n  query ConnectionSettings {\n    myTwitchConnection {\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n':
    types.ConnectionSettingsDocument,
  '\n  mutation ConnectionSettingsStartTwitchLink($desktop: Boolean!) {\n    twitchStartLink(desktop: $desktop) {\n      url\n    }\n  }\n':
    types.ConnectionSettingsStartTwitchLinkDocument,
  '\n  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {\n    twitchCompleteLink(code: $code, state: $state) {\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n':
    types.ConnectionSettingsCompleteTwitchLinkDocument,
  '\n  mutation ConnectionSettingsUnlinkTwitch {\n    twitchUnlink\n  }\n':
    types.ConnectionSettingsUnlinkTwitchDocument,
  '\n  query LiveUserIds {\n    liveStreamUserIds\n  }\n': types.LiveUserIdsDocument,
  '\n  fragment LiveStreams_FeedFragment on Query {\n    liveStreams {\n      twitchLogin\n      viewerCount\n      ...LiveStreams_FeedEntryFragment\n    }\n  }\n':
    types.LiveStreams_FeedFragmentFragmentDoc,
  '\n  fragment LiveStreams_FeedEntryFragment on LiveStream {\n    twitchLogin\n    twitchDisplayName\n    title\n    viewerCount\n    startedAt\n    thumbnailUrl\n    user {\n      id\n      name\n    }\n  }\n':
    types.LiveStreams_FeedEntryFragmentFragmentDoc,
  '\n  query UserNameAuditHistory(\n    $userId: SbUserId!\n    $displayNameLimit: Int\n    $displayNameOffset: Int\n    $loginNameLimit: Int\n    $loginNameOffset: Int\n  ) {\n    userDisplayNameAuditHistory(\n      userId: $userId\n      limit: $displayNameLimit\n      offset: $displayNameOffset\n    ) {\n      id\n      oldName\n      newName\n      changedAt\n      changedByUser {\n        id\n      }\n      changeReason\n      ipAddress\n      userAgent\n      usedToken\n    }\n    userLoginNameAuditHistory(userId: $userId, limit: $loginNameLimit, offset: $loginNameOffset) {\n      id\n      oldLoginName\n      newLoginName\n      changedAt\n      changeReason\n      ipAddress\n      userAgent\n    }\n  }\n':
    types.UserNameAuditHistoryDocument,
  '\n  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {\n    user(id: $userId) {\n      id\n      ...AdminUserProfile_Permissions @include(if: $includePermissions)\n    }\n  }\n':
    types.AdminUserProfileDocument,
  '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmaking\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      manageRallyPointServers\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageGameReports\n      manageRestrictedNames\n      manageSignupCodes\n    }\n  }\n':
    types.AdminUserProfile_PermissionsFragmentDoc,
  '\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n':
    types.AdminUpdateUserPermissionsDocument,
  '\n  query UserProfileOverlayLive($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      liveStream {\n        twitchLogin\n        title\n        viewerCount\n      }\n    }\n  }\n':
    types.UserProfileOverlayLiveDocument,
  '\n  query UserProfileTwitch($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      twitchChannel {\n        twitchLogin\n        twitchDisplayName\n      }\n      liveStream {\n        twitchLogin\n        title\n        gameName\n        viewerCount\n        startedAt\n        thumbnailUrl\n      }\n    }\n  }\n':
    types.UserProfileTwitchDocument,
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
  source: '\n  query AdminMatchmakingConfig {\n    matchmakingConfig {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n      }\n      perMode {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n        }\n      }\n      defaults {\n        searchIntervalSeconds\n        maxPlayersExamined\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminMatchmakingConfig {\n    matchmakingConfig {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n      }\n      perMode {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n        }\n      }\n      defaults {\n        searchIntervalSeconds\n        maxPlayersExamined\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AdminUpdateMatchmakingConfig($config: MatchmakerConfigInput!) {\n    updateMatchmakingConfig(config: $config) {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        minQuality\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation AdminUpdateMatchmakingConfig($config: MatchmakerConfigInput!) {\n    updateMatchmakingConfig(config: $config) {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        minQuality\n      }\n    }\n  }\n']
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
  source: '\n  query SignupCodes($includeExhausted: Boolean) {\n    signupCodes(includeExhausted: $includeExhausted) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n        name\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n',
): (typeof documents)['\n  query SignupCodes($includeExhausted: Boolean) {\n    signupCodes(includeExhausted: $includeExhausted) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n        name\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateSignupCode($input: CreateSignupCodeInput!) {\n    createSignupCode(input: $input) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n',
): (typeof documents)['\n  mutation CreateSignupCode($input: CreateSignupCodeInput!) {\n    createSignupCode(input: $input) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n']
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
  source: '\n  query AdminGameReportsList($filter: GameReportFilter, $first: Int, $after: String) {\n    gameReports(filter: $filter, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          reason\n          details\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          reportedUser {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminGameReportsList($filter: GameReportFilter, $first: Int, $after: String) {\n    gameReports(filter: $filter, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          reason\n          details\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          reportedUser {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminGameReport($id: UUID!) {\n    gameReport(id: $id) {\n      id\n      reason\n      details\n      createdAt\n      resolvedAt\n      resolution\n      resolutionNotes\n      reporter {\n        id\n        name\n      }\n      reportedUser {\n        id\n        name\n      }\n      resolver {\n        id\n      }\n      game {\n        id\n        config {\n          __typename\n          ... on GameConfigDataLobby {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n          ... on GameConfigDataMatchmaking {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n        }\n      }\n      replay {\n        replayFileId\n        hash\n        url\n      }\n      reporterStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      reportedUserStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      siblingReports {\n        id\n        reason\n        details\n        createdAt\n        resolvedAt\n        resolution\n        reporter {\n          id\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminGameReport($id: UUID!) {\n    gameReport(id: $id) {\n      id\n      reason\n      details\n      createdAt\n      resolvedAt\n      resolution\n      resolutionNotes\n      reporter {\n        id\n        name\n      }\n      reportedUser {\n        id\n        name\n      }\n      resolver {\n        id\n      }\n      game {\n        id\n        config {\n          __typename\n          ... on GameConfigDataLobby {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n          ... on GameConfigDataMatchmaking {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n        }\n      }\n      replay {\n        replayFileId\n        hash\n        url\n      }\n      reporterStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      reportedUserStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      siblingReports {\n        id\n        reason\n        details\n        createdAt\n        resolvedAt\n        resolution\n        reporter {\n          id\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ResolveGameReport($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveGameReport(id: $id, resolution: $resolution, notes: $notes) {\n      id\n      resolvedAt\n      resolution\n      resolutionNotes\n      resolver {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation ResolveGameReport($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveGameReport(id: $id, resolution: $resolution, notes: $notes) {\n      id\n      resolvedAt\n      resolution\n      resolutionNotes\n      resolver {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ResolveSiblingReports($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveSiblingReports(id: $id, resolution: $resolution, notes: $notes)\n  }\n',
): (typeof documents)['\n  mutation ResolveSiblingReports($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveSiblingReports(id: $id, resolution: $resolution, notes: $notes)\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query GamesPageContent {\n    ...LiveGames_FeedFragment\n  }\n',
): (typeof documents)['\n  query GamesPageContent {\n    ...LiveGames_FeedFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveGames_FeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n',
): (typeof documents)['\n  fragment LiveGames_FeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveGames_FeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_FeedEntryPlayersFragment\n        }\n      }\n    }\n\n    ...LiveGames_FeedEntryMapAndTypeFragment\n  }\n',
): (typeof documents)['\n  fragment LiveGames_FeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_FeedEntryPlayersFragment\n        }\n      }\n    }\n\n    ...LiveGames_FeedEntryMapAndTypeFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveGames_FeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n',
): (typeof documents)['\n  fragment LiveGames_FeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveGames_FeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment LiveGames_FeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ReportGame($input: ReportGameInput!) {\n    reportGame(input: $input) {\n      id\n    }\n  }\n',
): (typeof documents)['\n  mutation ReportGame($input: ReportGameInput!) {\n    reportGame(input: $input) {\n      id\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...LiveGames_FeedFragment\n    ...LiveStreams_FeedFragment\n    ...Leagues_HomeFeedFragment\n  }\n',
): (typeof documents)['\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...LiveGames_FeedFragment\n    ...LiveStreams_FeedFragment\n    ...Leagues_HomeFeedFragment\n  }\n']
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
  source: '\n  fragment Leagues_LeagueBadgeFragment on League {\n    name\n    badgeUrl\n  }\n',
): (typeof documents)['\n  fragment Leagues_LeagueBadgeFragment on League {\n    name\n    badgeUrl\n  }\n']
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
  source: '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    matchmakingType\n    startAt\n    endAt\n    ...Leagues_LeagueBadgeFragment\n  }\n',
): (typeof documents)['\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    matchmakingType\n    startAt\n    endAt\n    ...Leagues_LeagueBadgeFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n    lastLoginNameChange\n    lastNameChange\n    nameChangeTokens\n    canChangeDisplayName\n    nextDisplayNameChangeAllowedAt\n  }\n',
): (typeof documents)['\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n    lastLoginNameChange\n    lastNameChange\n    nameChangeTokens\n    canChangeDisplayName\n    nextDisplayNameChangeAllowedAt\n  }\n']
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
  source: '\n  mutation AccountSettingsChangeDisplayName($currentPassword: String!, $name: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { name: $name }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n',
): (typeof documents)['\n  mutation AccountSettingsChangeDisplayName($currentPassword: String!, $name: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { name: $name }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AccountSettingsChangeLoginName($currentPassword: String!, $loginName: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { loginName: $loginName }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n',
): (typeof documents)['\n  mutation AccountSettingsChangeLoginName($currentPassword: String!, $loginName: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { loginName: $loginName }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ConnectionSettings {\n    myTwitchConnection {\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n',
): (typeof documents)['\n  query ConnectionSettings {\n    myTwitchConnection {\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ConnectionSettingsStartTwitchLink($desktop: Boolean!) {\n    twitchStartLink(desktop: $desktop) {\n      url\n    }\n  }\n',
): (typeof documents)['\n  mutation ConnectionSettingsStartTwitchLink($desktop: Boolean!) {\n    twitchStartLink(desktop: $desktop) {\n      url\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {\n    twitchCompleteLink(code: $code, state: $state) {\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n',
): (typeof documents)['\n  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {\n    twitchCompleteLink(code: $code, state: $state) {\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ConnectionSettingsUnlinkTwitch {\n    twitchUnlink\n  }\n',
): (typeof documents)['\n  mutation ConnectionSettingsUnlinkTwitch {\n    twitchUnlink\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query LiveUserIds {\n    liveStreamUserIds\n  }\n',
): (typeof documents)['\n  query LiveUserIds {\n    liveStreamUserIds\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveStreams_FeedFragment on Query {\n    liveStreams {\n      twitchLogin\n      viewerCount\n      ...LiveStreams_FeedEntryFragment\n    }\n  }\n',
): (typeof documents)['\n  fragment LiveStreams_FeedFragment on Query {\n    liveStreams {\n      twitchLogin\n      viewerCount\n      ...LiveStreams_FeedEntryFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment LiveStreams_FeedEntryFragment on LiveStream {\n    twitchLogin\n    twitchDisplayName\n    title\n    viewerCount\n    startedAt\n    thumbnailUrl\n    user {\n      id\n      name\n    }\n  }\n',
): (typeof documents)['\n  fragment LiveStreams_FeedEntryFragment on LiveStream {\n    twitchLogin\n    twitchDisplayName\n    title\n    viewerCount\n    startedAt\n    thumbnailUrl\n    user {\n      id\n      name\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UserNameAuditHistory(\n    $userId: SbUserId!\n    $displayNameLimit: Int\n    $displayNameOffset: Int\n    $loginNameLimit: Int\n    $loginNameOffset: Int\n  ) {\n    userDisplayNameAuditHistory(\n      userId: $userId\n      limit: $displayNameLimit\n      offset: $displayNameOffset\n    ) {\n      id\n      oldName\n      newName\n      changedAt\n      changedByUser {\n        id\n      }\n      changeReason\n      ipAddress\n      userAgent\n      usedToken\n    }\n    userLoginNameAuditHistory(userId: $userId, limit: $loginNameLimit, offset: $loginNameOffset) {\n      id\n      oldLoginName\n      newLoginName\n      changedAt\n      changeReason\n      ipAddress\n      userAgent\n    }\n  }\n',
): (typeof documents)['\n  query UserNameAuditHistory(\n    $userId: SbUserId!\n    $displayNameLimit: Int\n    $displayNameOffset: Int\n    $loginNameLimit: Int\n    $loginNameOffset: Int\n  ) {\n    userDisplayNameAuditHistory(\n      userId: $userId\n      limit: $displayNameLimit\n      offset: $displayNameOffset\n    ) {\n      id\n      oldName\n      newName\n      changedAt\n      changedByUser {\n        id\n      }\n      changeReason\n      ipAddress\n      userAgent\n      usedToken\n    }\n    userLoginNameAuditHistory(userId: $userId, limit: $loginNameLimit, offset: $loginNameOffset) {\n      id\n      oldLoginName\n      newLoginName\n      changedAt\n      changeReason\n      ipAddress\n      userAgent\n    }\n  }\n']
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
  source: '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmaking\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      manageRallyPointServers\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageGameReports\n      manageRestrictedNames\n      manageSignupCodes\n    }\n  }\n',
): (typeof documents)['\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmaking\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      manageRallyPointServers\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageGameReports\n      manageRestrictedNames\n      manageSignupCodes\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n',
): (typeof documents)['\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UserProfileOverlayLive($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      liveStream {\n        twitchLogin\n        title\n        viewerCount\n      }\n    }\n  }\n',
): (typeof documents)['\n  query UserProfileOverlayLive($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      liveStream {\n        twitchLogin\n        title\n        viewerCount\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UserProfileTwitch($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      twitchChannel {\n        twitchLogin\n        twitchDisplayName\n      }\n      liveStream {\n        twitchLogin\n        title\n        gameName\n        viewerCount\n        startedAt\n        thumbnailUrl\n      }\n    }\n  }\n',
): (typeof documents)['\n  query UserProfileTwitch($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      twitchChannel {\n        twitchLogin\n        twitchDisplayName\n      }\n      liveStream {\n        twitchLogin\n        title\n        gameName\n        viewerCount\n        startedAt\n        thumbnailUrl\n      }\n    }\n  }\n']

export function graphql(source: string) {
  return (documents as any)[source] ?? {}
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never
