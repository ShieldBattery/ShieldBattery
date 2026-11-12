import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
/* eslint-disable */
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
  '\n  query AdminNewsList($first: Int, $after: String) {\n    newsPosts(includeUnpublished: true, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          title\n          summary\n          publishedAt\n          updatedAt\n          author {\n            id\n            name\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n': typeof types.AdminNewsListDocument
  '\n  query AdminNewsPost($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      summary\n      content\n      translations {\n        language\n        title\n        summary\n        content\n      }\n      publishedAt\n      coverImagePath\n      coverImageUrl\n      author {\n        id\n        name\n      }\n    }\n  }\n': typeof types.AdminNewsPostDocument
  '\n  query AdminNewsHistory($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      edits {\n        title\n        summary\n        content\n        translations {\n          language\n          title\n          summary\n          content\n        }\n        publishedAt\n        coverImagePath\n        editedAt\n        editor {\n          id\n          name\n        }\n      }\n    }\n  }\n': typeof types.AdminNewsHistoryDocument
  '\n  mutation NewsCreatePost($post: NewsPostCreation!) {\n    newsCreatePost(post: $post) {\n      id\n    }\n  }\n': typeof types.NewsCreatePostDocument
  '\n  query AdminBlockedStreams {\n    blockedStreams {\n      id\n      createdAt\n      twitchLogin\n      twitchDisplayName\n      user {\n        id\n        name\n      }\n      blockedBy {\n        id\n        name\n      }\n    }\n  }\n': typeof types.AdminBlockedStreamsDocument
  '\n  mutation AdminUnblockStream($userId: SbUserId!) {\n    unblockStream(userId: $userId)\n  }\n': typeof types.AdminUnblockStreamDocument
  '\n  query AdminMatchmakingConfig {\n    matchmakingConfig {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        winProbScale\n        maxRatingSpread\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n        weightRematch\n        rematchHalfLifeSeconds\n        rematchDensityRadius\n        rematchDensityReference\n        rematchDensityFloor\n      }\n      perMode {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          winProbScale\n          maxRatingSpread\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n          weightRematch\n          rematchHalfLifeSeconds\n          rematchDensityRadius\n          rematchDensityReference\n          rematchDensityFloor\n        }\n      }\n      defaults {\n        searchIntervalSeconds\n        maxPlayersExamined\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        winProbScale\n        maxRatingSpread\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n        weightRematch\n        rematchHalfLifeSeconds\n        rematchDensityRadius\n        rematchDensityReference\n        rematchDensityFloor\n      }\n      modeDefaults {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          winProbScale\n          maxRatingSpread\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n          weightRematch\n          rematchHalfLifeSeconds\n          rematchDensityRadius\n          rematchDensityReference\n          rematchDensityFloor\n        }\n      }\n    }\n  }\n': typeof types.AdminMatchmakingConfigDocument
  '\n  mutation AdminUpdateMatchmakingConfig($config: MatchmakerConfigInput!) {\n    updateMatchmakingConfig(config: $config) {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        minQuality\n      }\n    }\n  }\n': typeof types.AdminUpdateMatchmakingConfigDocument
  '\n  query RestrictedNames {\n    restrictedNames {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n': typeof types.RestrictedNamesDocument
  '\n  mutation DeleteRestrictedName($id: Int!) {\n    userDeleteRestrictedName(id: $id)\n  }\n': typeof types.DeleteRestrictedNameDocument
  '\n  mutation AddRestrictedName(\n    $pattern: String!\n    $kind: RestrictedNameKind!\n    $reason: RestrictedNameReason!\n  ) {\n    userAddRestrictedName(pattern: $pattern, kind: $kind, reason: $reason) {\n      id\n      pattern\n      kind\n      reason\n      createdAt\n      createdBy {\n        id\n      }\n    }\n  }\n': typeof types.AddRestrictedNameDocument
  '\n  mutation TestRestrictedName($name: String!) {\n    userTestRestrictedName(name: $name) {\n      id\n      pattern\n      kind\n      reason\n    }\n  }\n': typeof types.TestRestrictedNameDocument
  '\n  query SignupCodes($includeExhausted: Boolean) {\n    signupCodes(includeExhausted: $includeExhausted) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n        name\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n': typeof types.SignupCodesDocument
  '\n  mutation CreateSignupCode($input: CreateSignupCodeInput!) {\n    createSignupCode(input: $input) {\n      id\n      code\n      createdAt\n      createdByUser {\n        id\n      }\n      expiresAt\n      maxUses\n      uses\n      exhausted\n      notes\n    }\n  }\n': typeof types.CreateSignupCodeDocument
  '\n  query CurrentUrgentMessage {\n    urgentMessage {\n      id\n      title\n      message\n      translations {\n        language\n        title\n        message\n      }\n    }\n  }\n': typeof types.CurrentUrgentMessageDocument
  '\n  mutation SetUrgentMessage($message: UrgentMessageInput) {\n    newsSetUrgentMessage(message: $message)\n  }\n': typeof types.SetUrgentMessageDocument
  '\n  query ChannelActivity {\n    liveStreams {\n      id\n      twitchLogin\n      viewerCount\n      user {\n        id\n        name\n      }\n      ...LiveStreams_FeedEntryFragment\n    }\n    liveGames {\n      id\n      startTime\n      map {\n        id\n        name\n        mapFile {\n          id\n          image256Url\n          image512Url\n          image1024Url\n          image2048Url\n          width\n          height\n        }\n      }\n      config {\n        __typename\n        ... on GameConfigDataMatchmaking {\n          gameSourceExtra {\n            matchmakingType\n          }\n          teams {\n            race\n            user {\n              id\n              name\n            }\n          }\n        }\n      }\n    }\n  }\n': typeof types.ChannelActivityDocument
  '\n  query AdminGameReportsList($filter: GameReportFilter, $first: Int, $after: String) {\n    gameReports(filter: $filter, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          reason\n          details\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          reportedUser {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n': typeof types.AdminGameReportsListDocument
  '\n  query AdminGameReport($id: UUID!) {\n    gameReport(id: $id) {\n      id\n      reason\n      details\n      gameTimeSeconds\n      createdAt\n      resolvedAt\n      resolution\n      resolutionNotes\n      reporter {\n        id\n        name\n      }\n      reportedUser {\n        id\n        name\n      }\n      resolver {\n        id\n      }\n      game {\n        id\n        config {\n          __typename\n          ... on GameConfigDataLobby {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n          ... on GameConfigDataMatchmaking {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n        }\n      }\n      replay {\n        replayFileId\n        hash\n        url\n      }\n      reporterStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      reportedUserStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      siblingReports {\n        id\n        reason\n        details\n        gameTimeSeconds\n        createdAt\n        resolvedAt\n        resolution\n        reporter {\n          id\n        }\n      }\n    }\n  }\n': typeof types.AdminGameReportDocument
  '\n  mutation ResolveGameReport($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveGameReport(id: $id, resolution: $resolution, notes: $notes) {\n      id\n      resolvedAt\n      resolution\n      resolutionNotes\n      resolver {\n        id\n      }\n    }\n  }\n': typeof types.ResolveGameReportDocument
  '\n  mutation ResolveSiblingReports($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveSiblingReports(id: $id, resolution: $resolution, notes: $notes)\n  }\n': typeof types.ResolveSiblingReportsDocument
  '\n  query GameFeedback($gameId: UUID!) {\n    gameFeedback(gameId: $gameId) {\n      id\n      closesAt\n      given {\n        userId\n        kind\n      }\n      commendsRemaining\n      commendsAvailableAt\n      recentCommends {\n        userId\n        availableAt\n      }\n    }\n  }\n': typeof types.GameFeedbackDocument
  '\n  mutation CommendPlayer($gameId: UUID!, $userId: SbUserId!) {\n    commendPlayer(gameId: $gameId, userId: $userId) {\n      feedback {\n        id\n        closesAt\n        given {\n          userId\n          kind\n        }\n        commendsRemaining\n        commendsAvailableAt\n        recentCommends {\n          userId\n          availableAt\n        }\n      }\n      commendedUser {\n        id\n        commendCount\n      }\n    }\n  }\n': typeof types.CommendPlayerDocument
  '\n  query GamesPageContent {\n    ...LiveGames_FeedFragment\n  }\n': typeof types.GamesPageContentDocument
  '\n  fragment LiveGames_FeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n': typeof types.LiveGames_FeedFragmentFragmentDoc
  '\n  fragment LiveGames_FeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_FeedEntryPlayersFragment\n        }\n      }\n    }\n\n    currentRanks {\n      id\n      userId\n      matchmakingType\n      seasonId\n      points\n      lifetimeGames\n    }\n\n    ...LiveGames_FeedEntryMapAndTypeFragment\n  }\n': typeof types.LiveGames_FeedEntryFragmentFragmentDoc
  '\n  fragment LiveGames_FeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n': typeof types.LiveGames_FeedEntryPlayersFragmentFragmentDoc
  '\n  fragment LiveGames_FeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n': typeof types.LiveGames_FeedEntryMapAndTypeFragmentFragmentDoc
  '\n  mutation ReportGame($input: ReportGameInput!) {\n    reportGame(input: $input) {\n      id\n    }\n  }\n': typeof types.ReportGameDocument
  '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...Leagues_HomeFeedFragment\n    ...News_HomeFeedFragment\n  }\n': typeof types.HomePageContentDocument
  '\n  query HomePageLiveContent {\n    ...LiveGames_FeedFragment\n    ...LiveStreams_FeedFragment\n  }\n': typeof types.HomePageLiveContentDocument
  '\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n    translations {\n      language\n      title\n      message\n    }\n  }\n': typeof types.UrgentMessage_HomeDisplayFragmentFragmentDoc
  '\n  fragment Leagues_LeagueBadgeFragment on League {\n    name\n    translations {\n      language\n      name\n    }\n    badgeUrl\n  }\n': typeof types.Leagues_LeagueBadgeFragmentFragmentDoc
  '\n  fragment Leagues_HomeFeedFragment on Query {\n    activeLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n\n    futureLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n  }\n': typeof types.Leagues_HomeFeedFragmentFragmentDoc
  '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    translations {\n      language\n      name\n    }\n    matchmakingType\n    startAt\n    endAt\n    ...Leagues_LeagueBadgeFragment\n  }\n': typeof types.Leagues_HomeFeedEntryFragmentFragmentDoc
  '\n  query AdminMapFamilyReports($status: MapFamilyReportStatus!, $limit: Int!, $offset: Int!) {\n    mapFamilyReports(status: $status, limit: $limit, offset: $offset) {\n      id\n      kind\n      note\n      fromPublish\n      publishAnswer\n      reportedAt\n      status\n      resolvedAt\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n      }\n      map {\n        id\n        name\n      }\n      otherFamily {\n        id\n        name\n        current {\n          id\n        }\n      }\n      reportedBy {\n        id\n      }\n      resolvedBy {\n        id\n      }\n    }\n  }\n': typeof types.AdminMapFamilyReportsDocument
  '\n  query AdminMapFamilyReportCounts {\n    open: mapFamilyReportCount(status: OPEN)\n    resolved: mapFamilyReportCount(status: RESOLVED)\n    dismissed: mapFamilyReportCount(status: DISMISSED)\n    openClaims: mapOwnerClaimCount(status: OPEN)\n    openCollectionReports: mapCollectionReportCount\n  }\n': typeof types.AdminMapFamilyReportCountsDocument
  '\n  query AdminMapOwnerClaims($limit: Int!, $offset: Int!) {\n    mapOwnerClaims(status: OPEN, limit: $limit, offset: $offset) {\n      id\n      note\n      status\n      createdAt\n      claimant {\n        id\n      }\n      family {\n        id\n        name\n        owner {\n          id\n        }\n      }\n    }\n  }\n': typeof types.AdminMapOwnerClaimsDocument
  '\n  mutation AdminMapOwnerClaimGrant($claimId: UUID!) {\n    mapOwnerClaimGrant(claimId: $claimId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n      family {\n        id\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n': typeof types.AdminMapOwnerClaimGrantDocument
  '\n  mutation AdminMapOwnerClaimReject($claimId: UUID!) {\n    mapOwnerClaimReject(claimId: $claimId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n    }\n  }\n': typeof types.AdminMapOwnerClaimRejectDocument
  '\n  query AdminMapCollectionReports($after: String, $first: Int!) {\n    mapCollectionReports(open: true, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        node {\n          id\n          note\n          createdAt\n          reporter {\n            id\n          }\n          collection {\n            id\n            title\n            owner {\n              id\n            }\n          }\n        }\n      }\n    }\n  }\n': typeof types.AdminMapCollectionReportsDocument
  '\n  fragment MapSearchTest_Map on SbMap {\n    id\n    name\n    kind\n    playerCount\n    listed\n    staffPick\n    publishedAt\n    favoriteCount\n    isFavorited\n    inLibrary\n    publisher {\n      id\n      name\n    }\n    stats {\n      id\n      games7d\n      games28d\n      games90d\n      gamesTotal\n      players90d\n      medianLength90d\n      lastPlayedAt\n    }\n    file {\n      id\n      tileset\n      width\n      height\n      isEud\n      image256Url\n    }\n  }\n': typeof types.MapSearchTest_MapFragmentDoc
  '\n  query MapSearchTestMaps($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    maps(filter: $filter, sort: $sort, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          ...MapSearchTest_Map\n        }\n      }\n    }\n  }\n': typeof types.MapSearchTestMapsDocument
  '\n  query MapSearchTestLibrary($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    currentUser {\n      id\n      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            ...MapSearchTest_Map\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapSearchTestLibraryDocument
  '\n  query MapSearchTestFavorites($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    currentUser {\n      id\n      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            ...MapSearchTest_Map\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapSearchTestFavoritesDocument
  '\n  query MapSearchTestMap($id: SbMapId!) {\n    map(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n': typeof types.MapSearchTestMapDocument
  '\n  mutation MapSearchTestAddFavorite($id: SbMapId!) {\n    mapAddFavorite(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n': typeof types.MapSearchTestAddFavoriteDocument
  '\n  mutation MapSearchTestRemoveFavorite($id: SbMapId!) {\n    mapRemoveFavorite(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n': typeof types.MapSearchTestRemoveFavoriteDocument
  '\n  query MapSpawnsTestMaps {\n    maps(first: 100) {\n      edges {\n        node {\n          id\n          name\n          file {\n            id\n            image256Url\n            image512Url\n            image1024Url\n            image2048Url\n            imageSpawnsBaked\n            width\n            height\n            startLocations {\n              id\n              slot\n              x\n              y\n            }\n            umsContent\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapSpawnsTestMapsDocument
  '\n  query MapSpawnsTestMap($id: SbMapId!) {\n    map(id: $id) {\n      id\n      name\n      file {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        imageSpawnsBaked\n        width\n        height\n        startLocations {\n          id\n          slot\n          x\n          y\n        }\n        umsContent\n      }\n    }\n  }\n': typeof types.MapSpawnsTestMapDocument
  '\n  query LocalKnownMap($hashes: [String!]!) {\n    mapsByHash(hashes: $hashes) {\n      id\n      name\n    }\n  }\n': typeof types.LocalKnownMapDocument
  '\n  query MapCatalogAll(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    maps(filter: $filter, sort: $sort, after: $after, first: $first) {\n      totalCount @include(if: $withCount)\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          id\n          family {\n            id\n          }\n          ...MapTile_SbMapFragment\n        }\n      }\n    }\n  }\n': typeof types.MapCatalogAllDocument
  '\n  query MapCatalogLibrary(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    currentUser {\n      id\n      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            id\n            family {\n              id\n            }\n            ...MapTile_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapCatalogLibraryDocument
  '\n  query MapCatalogFavorites(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    currentUser {\n      id\n      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            family {\n              id\n            }\n            ...MapTile_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapCatalogFavoritesDocument
  '\n  mutation MapCollectionUpdate($id: UUID!, $title: String, $description: String, $public: Boolean) {\n    mapCollectionUpdate(id: $id, title: $title, description: $description, public: $public) {\n      id\n      title\n      description\n      public\n      updatedAt\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n': typeof types.MapCollectionUpdateDocument
  '\n  mutation MapCollectionAddMap($collectionId: UUID!, $mapId: SbMapId!) {\n    mapCollectionAddMap(collectionId: $collectionId, mapId: $mapId) {\n      id\n      mapCount\n      updatedAt\n      ...MapCollectionMosaic_CollectionFragment\n    }\n  }\n': typeof types.MapCollectionAddMapDocument
  '\n  mutation MapCollectionSave($id: UUID!) {\n    mapCollectionSave(id: $id) {\n      id\n      isSaved\n      saveCount\n    }\n  }\n': typeof types.MapCollectionSaveDocument
  '\n  mutation MapCollectionUnsave($id: UUID!) {\n    mapCollectionUnsave(id: $id) {\n      id\n      isSaved\n      saveCount\n    }\n  }\n': typeof types.MapCollectionUnsaveDocument
  '\n  mutation MapCollectionUnhide($id: UUID!) {\n    mapCollectionUnhide(id: $id) {\n      id\n      public\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n': typeof types.MapCollectionUnhideDocument
  '\n  fragment MapCollectionMosaic_CollectionFragment on MapCollection {\n    id\n    cover {\n      id\n      name\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n': typeof types.MapCollectionMosaic_CollectionFragmentFragmentDoc
  '\n  fragment MapCollectionCard_CollectionFragment on MapCollection {\n    id\n    kind\n    title\n    public\n    mapCount\n    owner {\n      id\n      name\n    }\n    hidden {\n      id\n    }\n    pool {\n      id\n      matchmakingType\n      startDate\n      endDate\n    }\n    ...MapCollectionMosaic_CollectionFragment\n  }\n': typeof types.MapCollectionCard_CollectionFragmentFragmentDoc
  '\n  mutation MapCollectionCreate($title: String!, $staff: Boolean!) {\n    mapCollectionCreate(title: $title, staff: $staff) {\n      id\n      kind\n      title\n    }\n  }\n': typeof types.MapCollectionCreateDocument
  '\n  mutation MapCollectionDelete($id: UUID!) {\n    mapCollectionDelete(id: $id)\n  }\n': typeof types.MapCollectionDeleteDocument
  '\n  mutation MapCollectionReport($id: UUID!, $note: String!) {\n    mapCollectionReport(id: $id, note: $note) {\n      id\n    }\n  }\n': typeof types.MapCollectionReportDocument
  '\n  mutation MapCollectionHide($id: UUID!, $note: String!) {\n    mapCollectionHide(id: $id, note: $note) {\n      id\n      public\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n': typeof types.MapCollectionHideDocument
  '\n  query MapCollectionPage($id: UUID!) {\n    mapCollection(id: $id) {\n      id\n      kind\n      title\n      description\n      public\n      grantsStaffPick\n      canEdit\n      isSaved\n      mapCount\n      owner {\n        id\n        name\n      }\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n      pool {\n        id\n        matchmakingType\n        startDate\n        endDate\n        isCurrent\n        maxVetoCount\n        previous {\n          id\n        }\n        next {\n          id\n        }\n      }\n      ...MapCollectionMosaic_CollectionFragment\n    }\n  }\n': typeof types.MapCollectionPageDocument
  '\n  fragment MapCollectionRow_SbMapFragment on SbMap {\n    id\n    family {\n      id\n      listed\n    }\n    ...MapTile_SbMapFragment\n  }\n': typeof types.MapCollectionRow_SbMapFragmentFragmentDoc
  '\n  query MapCollectionPageMaps($id: UUID!, $after: String, $first: Int!, $withCount: Boolean!) {\n    mapCollection(id: $id) {\n      id\n      maps(after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            ...MapCollectionRow_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapCollectionPageMapsDocument
  '\n  query MapCollectionEntries($id: UUID!, $after: String, $first: Int!) {\n    mapCollection(id: $id) {\n      id\n      maps(after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          node {\n            id\n            family {\n              id\n              listed\n            }\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapCollectionEntriesDocument
  '\n  query MapCollectionReportBar($open: Boolean!, $first: Int!) {\n    mapCollectionReports(open: $open, first: $first) {\n      edges {\n        node {\n          id\n          note\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          resolvedBy {\n            id\n          }\n          collection {\n            id\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapCollectionReportBarDocument
  '\n  mutation MapCollectionReportDismiss($reportId: UUID!) {\n    mapCollectionReportDismiss(reportId: $reportId) {\n      id\n      resolvedAt\n      resolution\n      resolvedBy {\n        id\n      }\n    }\n  }\n': typeof types.MapCollectionReportDismissDocument
  '\n  query MapCollectionsTab($search: String, $loggedIn: Boolean!, $first: Int!) {\n    currentUser @include(if: $loggedIn) {\n      id\n      mapCollections {\n        id\n        kind\n        title\n        ...MapCollectionCard_CollectionFragment\n      }\n    }\n    ladder: mapCollections(section: LADDER, search: $search, first: $first) {\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n    staff: mapCollections(section: STAFF, search: $search, first: $first) {\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n  }\n': typeof types.MapCollectionsTabDocument
  '\n  query MapCollectionsPlayers($search: String, $after: String, $first: Int!, $withCount: Boolean!) {\n    mapCollections(section: PLAYERS, search: $search, after: $after, first: $first) {\n      totalCount @include(if: $withCount)\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n  }\n': typeof types.MapCollectionsPlayersDocument
  '\n  query MapCompare($a: SbMapId!, $b: SbMapId!) {\n    mapComparison(a: $a, b: $b) {\n      id\n      changes\n      terrainSimilarity\n      terrainChanges\n      startLocations {\n        id\n        slot\n        kind\n      }\n      bases {\n        id\n        beforeIndex\n        afterIndex\n        changed\n      }\n      a {\n        id\n        ...MapCompare_Side\n      }\n      b {\n        id\n        ...MapCompare_Side\n      }\n    }\n  }\n': typeof types.MapCompareDocument
  '\n  fragment MapCompare_Side on SbMap {\n    id\n    name\n    playerCount\n    file {\n      id\n      tileset\n      width\n      height\n      isEud\n      image2048Url\n      imageSpawnsBaked\n      umsContent\n      startLocations {\n        id\n        slot\n        x\n        y\n      }\n      analysis {\n        id\n        triggerCount\n        umsActionKinds\n      }\n    }\n  }\n': typeof types.MapCompare_SideFragmentDoc
  '\n  query MapDefaultNudge($id: SbMapId!) {\n    map(id: $id) {\n      id\n      family {\n        id\n        current {\n          id\n          name\n          listed\n        }\n      }\n    }\n  }\n': typeof types.MapDefaultNudgeDocument
  '\n  mutation MapDelist($fileId: SbMapId!, $note: String) {\n    mapDelist(fileId: $fileId, note: $note) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n      moderation {\n        id\n        publishedAt\n        delistedAt\n        delistedKind\n        delistedNote\n        delistedBy {\n          id\n          name\n        }\n      }\n    }\n  }\n': typeof types.MapDelistDocument
  '\n  fragment MapFamilyAction_FamilyFragment on MapFamily {\n    id\n    name\n    listed\n    current {\n      id\n    }\n    defaultMap {\n      id\n    }\n    files {\n      id\n      name\n      listed\n      firstSeenAt\n      favoriteCount\n      stats {\n        id\n        games28d\n        gamesTotal\n      }\n    }\n  }\n': typeof types.MapFamilyAction_FamilyFragmentFragmentDoc
  '\n  query MapFamilyActionFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        ...MapFamilyAction_FamilyFragment\n      }\n    }\n  }\n': typeof types.MapFamilyActionFamilyDocument
  '\n  query MapFamilyActionSimilar($fileId: SbMapId!) {\n    similarFiles(fileId: $fileId) {\n      id\n      similarity\n      map {\n        id\n        family {\n          id\n          name\n          ...MapFamilySearch_FamilyFragment\n        }\n      }\n    }\n  }\n': typeof types.MapFamilyActionSimilarDocument
  '\n  mutation MapFamilySplitFile($fileId: SbMapId!) {\n    mapFamilySplitFile(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n': typeof types.MapFamilySplitFileDocument
  '\n  mutation MapFamilyMoveFile($fileId: SbMapId!, $familyId: UUID!) {\n    mapFamilyMoveFile(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n': typeof types.MapFamilyMoveFileDocument
  '\n  mutation MapFamilyMerge($familyId: UUID!, $intoFamilyId: UUID!) {\n    mapFamilyMerge(familyId: $familyId, intoFamilyId: $intoFamilyId) {\n      id\n      name\n    }\n  }\n': typeof types.MapFamilyMergeDocument
  '\n  query MapFamilyReportFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        current {\n          id\n        }\n        owner {\n          id\n          name\n        }\n        files {\n          id\n          name\n          listed\n          firstSeenAt\n        }\n      }\n    }\n  }\n': typeof types.MapFamilyReportFamilyDocument
  '\n  mutation MapFamilyReport($input: MapFamilyReportInput!) {\n    mapFamilyReport(input: $input) {\n      id\n      status\n    }\n  }\n': typeof types.MapFamilyReportDocument
  '\n  fragment MapFamilySearch_FamilyFragment on MapFamily {\n    id\n    name\n    stats {\n      id\n      gamesTotal\n    }\n    files {\n      id\n    }\n    current {\n      id\n      listed\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n': typeof types.MapFamilySearch_FamilyFragmentFragmentDoc
  '\n  query MapFamilySearch($search: String!) {\n    maps(filter: { search: $search }, first: 6) {\n      nodes {\n        id\n        family {\n          id\n          ...MapFamilySearch_FamilyFragment\n        }\n      }\n    }\n  }\n': typeof types.MapFamilySearchDocument
  '\n  query MapFamilySearchById($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        ...MapFamilySearch_FamilyFragment\n      }\n    }\n  }\n': typeof types.MapFamilySearchByIdDocument
  '\n  mutation MapAddFavorite($id: SbMapId!) {\n    mapAddFavorite(id: $id) {\n      id\n      isFavorited\n      favoriteCount\n      family {\n        id\n        files {\n          id\n          isFavorited\n          favoriteCount\n        }\n      }\n    }\n  }\n': typeof types.MapAddFavoriteDocument
  '\n  mutation MapRemoveFavorite($id: SbMapId!) {\n    mapRemoveFavorite(id: $id) {\n      id\n      isFavorited\n      favoriteCount\n      family {\n        id\n        files {\n          id\n          isFavorited\n          favoriteCount\n        }\n      }\n    }\n  }\n': typeof types.MapRemoveFavoriteDocument
  '\n  fragment MapFileImage_FileFragment on MapFile {\n    id\n    image256Url\n    image512Url\n    image1024Url\n    image2048Url\n    imageSpawnsBaked\n    width\n    height\n    startLocations {\n      id\n      slot\n      x\n      y\n    }\n    umsContent\n  }\n': typeof types.MapFileImage_FileFragmentFragmentDoc
  '\n  mutation LocalAddToLibrary($id: SbMapId!) {\n    mapAddToLibrary(id: $id) {\n      id\n      inLibrary\n    }\n  }\n': typeof types.LocalAddToLibraryDocument
  '\n  mutation MapFamilySetDefault($fileId: SbMapId!) {\n    mapFamilySetDefault(fileId: $fileId) {\n      id\n      name\n      current {\n        id\n        name\n      }\n      defaultMap {\n        id\n      }\n      defaultSetAt\n      defaultSetBy {\n        id\n        name\n      }\n    }\n  }\n': typeof types.MapFamilySetDefaultDocument
  '\n  fragment MapOwner_FamilyOwnerFragment on MapFamily {\n    id\n    owner {\n      id\n      name\n    }\n    ownerKind\n    ownerSetAt\n    credit\n  }\n': typeof types.MapOwner_FamilyOwnerFragmentFragmentDoc
  '\n  mutation MapOwnerClaim($familyId: UUID!, $note: String) {\n    mapOwnerClaim(familyId: $familyId, note: $note) {\n      id\n      granted\n      claim {\n        id\n        status\n        note\n        createdAt\n      }\n      family {\n        id\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n': typeof types.MapOwnerClaimDocument
  '\n  mutation MapOwnerRelinquish($familyId: UUID!) {\n    mapOwnerRelinquish(familyId: $familyId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n': typeof types.MapOwnerRelinquishDocument
  '\n  mutation MapFamilyRemoveOwner($familyId: UUID!) {\n    mapFamilyRemoveOwner(familyId: $familyId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n': typeof types.MapFamilyRemoveOwnerDocument
  '\n  query MapOwnerEditFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        name\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n': typeof types.MapOwnerEditFamilyDocument
  '\n  mutation MapFamilySetOwner($familyId: UUID!, $userId: SbUserId!) {\n    mapFamilySetOwner(familyId: $familyId, userId: $userId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n': typeof types.MapFamilySetOwnerDocument
  '\n  mutation MapFamilySetCredit($familyId: UUID!, $credit: String) {\n    mapFamilySetCredit(familyId: $familyId, credit: $credit) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n': typeof types.MapFamilySetCreditDocument
  '\n  query MapOwnerAddFileLibrary($after: String, $first: Int, $canManageMaps: Boolean!) {\n    currentUser {\n      id\n      mapLibrary(sort: NEWEST, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            name\n            listed\n            playerCount\n            publishedAt\n            publisher {\n              id\n            }\n            moderation @include(if: $canManageMaps) {\n              id\n              delistedKind\n            }\n            family {\n              id\n              name\n              listed\n              credit\n              owner {\n                id\n              }\n              files {\n                id\n              }\n            }\n            file {\n              id\n              width\n              height\n              ...MapFileImage_FileFragment\n            }\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapOwnerAddFileLibraryDocument
  '\n  query MapOwnerAddFileUploaded($id: SbMapId!, $canManageMaps: Boolean!) {\n    map(id: $id) {\n      id\n      name\n      listed\n      playerCount\n      publishedAt\n      publisher {\n        id\n      }\n      moderation @include(if: $canManageMaps) {\n        id\n        delistedKind\n      }\n      family {\n        id\n        name\n        listed\n        credit\n        owner {\n          id\n        }\n        files {\n          id\n        }\n      }\n      file {\n        id\n        width\n        height\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n': typeof types.MapOwnerAddFileUploadedDocument
  '\n  mutation MapOwnerAddFileLink($fileId: SbMapId!, $familyId: UUID!) {\n    mapFileLink(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n': typeof types.MapOwnerAddFileLinkDocument
  '\n  mutation MapOwnerAddFilePublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {\n    mapPublish(fileId: $fileId, answer: $answer) {\n      id\n      heldForReview\n      file {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n': typeof types.MapOwnerAddFilePublishDocument
  '\n  query MapLiveGames {\n    liveGames {\n      id\n      map {\n        id\n      }\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n': typeof types.MapLiveGamesDocument
  '\n  fragment MapPageFiles_FileFragment on SbMap {\n    id\n    name\n    listed\n    firstSeenAt\n    stats {\n      id\n      games28d\n      gamesTotal\n    }\n  }\n': typeof types.MapPageFiles_FileFragmentFragmentDoc
  '\n  fragment MapPageFiles_FamilyFragment on MapFamily {\n    id\n    name\n    listed\n    current {\n      id\n      name\n    }\n    defaultMap {\n      id\n    }\n    defaultSetBy @include(if: $canManageMaps) {\n      id\n      name\n    }\n    owner {\n      id\n    }\n    files {\n      id\n      ...MapPageFiles_FileFragment\n    }\n  }\n': typeof types.MapPageFiles_FamilyFragmentFragmentDoc
  '\n  mutation MapPageFilesUnlink($fileId: SbMapId!) {\n    mapFileUnlink(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n': typeof types.MapPageFilesUnlinkDocument
  '\n  fragment MapPageStats_FamilyFragment on MapFamily {\n    id\n    stats {\n      id\n      gamesTotal\n      games28d\n      players90d\n      medianLength90d\n      lastPlayedAt\n    }\n    weeklyActivity(weeks: 26) {\n      id\n      weekStart\n      lobbyGames\n      matchmakingGames\n    }\n  }\n': typeof types.MapPageStats_FamilyFragmentFragmentDoc
  '\n  fragment MapPageMatchups_MapFragment on SbMap {\n    id\n    kind\n    matchupSeasons {\n      id\n      seasonId\n      matchmakingType\n      games\n    }\n  }\n': typeof types.MapPageMatchups_MapFragmentFragmentDoc
  '\n  query MapMatchups($id: SbMapId!, $matchmakingType: MatchmakingType!, $seasonId: Int) {\n    map(id: $id) {\n      id\n      matchups(matchmakingType: $matchmakingType, seasonId: $seasonId) {\n        id\n        matchup\n        games\n        leftWins\n        rightWins\n        medianLength\n      }\n    }\n  }\n': typeof types.MapMatchupsDocument
  '\n  query MapPageFamily($id: UUID!, $canManageMaps: Boolean!) {\n    mapFamily(id: $id) {\n      id\n      file {\n        id\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n        owner {\n          id\n          name\n        }\n        ownerKind\n        credit\n        ...MapPageStats_FamilyFragment\n        ...MapPageFiles_FamilyFragment\n      }\n    }\n  }\n': typeof types.MapPageFamilyDocument
  '\n  query MapPageFile($id: SbMapId!, $canManageMaps: Boolean!) {\n    map(id: $id) {\n      id\n      name\n      kind\n      family {\n        id\n        name\n      }\n      stats {\n        id\n      }\n      file {\n        id\n        image256Url\n        ...MapFileImage_FileFragment\n      }\n      ...MapPage_HeaderFragment\n      ...MapPage_ActionsFragment\n      ...MapPage_FactsFragment\n      ...MapPage_HowToPlayFragment\n      ...MapPageMatchups_MapFragment\n      ...MapPageFiles_FileFragment\n    }\n  }\n': typeof types.MapPageFileDocument
  '\n  fragment MapPage_FactsFragment on SbMap {\n    id\n    kind\n    playerCount\n    file {\n      id\n      width\n      height\n      tileset\n      isEud\n      umsForces {\n        name\n        teamId\n        players {\n          playerId\n          isComputer\n        }\n      }\n      analysis {\n        id\n        baseCount\n      }\n    }\n  }\n': typeof types.MapPage_FactsFragmentFragmentDoc
  '\n  fragment MapPage_HeaderFragment on SbMap {\n    id\n    name\n    description\n    kind\n    listed\n    staffPick\n    publishedAt\n    publisher {\n      id\n      name\n    }\n    file {\n      id\n      originalName\n      originalDescription\n    }\n    moderation @include(if: $canManageMaps) {\n      id\n      delistedAt\n      delistedKind\n      delistedNote\n      delistedBy {\n        id\n        name\n      }\n    }\n  }\n': typeof types.MapPage_HeaderFragmentFragmentDoc
  '\n  fragment MapPage_ActionsFragment on SbMap {\n    id\n    name\n    listed\n    isFavorited\n    inLibrary\n    publisher {\n      id\n    }\n    moderation @include(if: $canManageMaps) {\n      id\n      publishedAt\n      delistedKind\n    }\n  }\n': typeof types.MapPage_ActionsFragmentFragmentDoc
  '\n  mutation MapPageRelist($fileId: SbMapId!) {\n    mapRelist(fileId: $fileId) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n      moderation {\n        id\n        publishedAt\n        delistedAt\n        delistedKind\n        delistedNote\n        delistedBy {\n          id\n          name\n        }\n      }\n    }\n  }\n': typeof types.MapPageRelistDocument
  '\n  mutation MapPageFileUnlink($fileId: SbMapId!) {\n    mapFileUnlink(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n': typeof types.MapPageFileUnlinkDocument
  '\n  query MapPageClaimPreview($familyId: UUID!) {\n    mapOwnerClaimPreview(familyId: $familyId) {\n      id\n      blockedReason\n      instant\n      openClaim {\n        id\n        status\n      }\n    }\n  }\n': typeof types.MapPageClaimPreviewDocument
  '\n  fragment MapPage_HowToPlayFragment on SbMap {\n    id\n    kind\n    file {\n      id\n      originalDescription\n    }\n  }\n': typeof types.MapPage_HowToPlayFragmentFragmentDoc
  '\n  fragment MapPublish_SuggestionFragment on MapPublishSuggestion {\n    id\n    similarity\n    sameKind\n    triggerSimilarity\n    sameResources\n    family {\n      id\n      name\n    }\n    file {\n      id\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n': typeof types.MapPublish_SuggestionFragmentFragmentDoc
  '\n  fragment MapPublish_FileFragment on SbMap {\n    id\n    name\n    family {\n      id\n      name\n      current {\n        id\n      }\n    }\n    file {\n      id\n      ...MapFileImage_FileFragment\n    }\n  }\n': typeof types.MapPublish_FileFragmentFragmentDoc
  '\n  fragment MapPublish_PreviewFragment on MapPublishPreview {\n    id\n    blockedReason\n    needsReview\n    existingMap {\n      id\n      name\n    }\n    suggestions {\n      id\n      ...MapPublish_SuggestionFragment\n    }\n  }\n': typeof types.MapPublish_PreviewFragmentFragmentDoc
  '\n  query MapPublishPreview($fileId: SbMapId!) {\n    mapPublishPreview(fileId: $fileId) {\n      id\n      ...MapPublish_PreviewFragment\n    }\n    # What the views of the file show about its listing, so they all catch up to it once the\n    # preview loads\n    map(id: $fileId) {\n      id\n      listed\n      publishedAt\n      staffPick\n      publisher {\n        id\n        name\n      }\n      ...MapPublish_FileFragment\n    }\n  }\n': typeof types.MapPublishPreviewDocument
  '\n  query MapLinkSuggestions($fileId: SbMapId!) {\n    mapLinkSuggestions(fileId: $fileId) {\n      id\n      ...MapPublish_SuggestionFragment\n    }\n    map(id: $fileId) {\n      id\n      ...MapPublish_FileFragment\n    }\n  }\n': typeof types.MapLinkSuggestionsDocument
  '\n  mutation MapPublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {\n    mapPublish(fileId: $fileId, answer: $answer) {\n      id\n      heldForReview\n      file {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n': typeof types.MapPublishDocument
  '\n  mutation MapFileLink($fileId: SbMapId!, $familyId: UUID!) {\n    mapFileLink(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n': typeof types.MapFileLinkDocument
  '\n  query MapPublishOwnedMaps($owner: SbUserId!) {\n    maps(filter: { owner: $owner }, sort: NAME, first: 100) {\n      edges {\n        node {\n          id\n          family {\n            id\n            name\n          }\n        }\n      }\n    }\n  }\n': typeof types.MapPublishOwnedMapsDocument
  '\n  mutation MapPublishReviewApprove($reportId: UUID!) {\n    mapPublishReviewApprove(reportId: $reportId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n      map {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n      }\n    }\n  }\n': typeof types.MapPublishReviewApproveDocument
  '\n  mutation MapReportBarSetDefault($fileId: SbMapId!) {\n    mapFamilySetDefault(fileId: $fileId) {\n      id\n      name\n      current {\n        id\n        name\n      }\n      defaultMap {\n        id\n      }\n      defaultSetAt\n      defaultSetBy {\n        id\n        name\n      }\n    }\n  }\n': typeof types.MapReportBarSetDefaultDocument
  '\n  query MapReportBar($id: UUID!) {\n    mapFamilyReportById(id: $id) {\n      id\n      kind\n      note\n      fromPublish\n      publishAnswer\n      reportedAt\n      status\n      resolvedAt\n      reportedBy {\n        id\n      }\n      resolvedBy {\n        id\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n        owner {\n          id\n        }\n      }\n      map {\n        id\n        name\n        listed\n        firstSeenAt\n        family {\n          id\n        }\n        stats {\n          id\n          gamesTotal\n        }\n      }\n      otherFamily {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n': typeof types.MapReportBarDocument
  '\n  mutation MapFamilyReportSetStatus($id: UUID!, $status: MapFamilyReportStatus!) {\n    mapFamilyReportSetStatus(id: $id, status: $status) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n    }\n  }\n': typeof types.MapFamilyReportSetStatusDocument
  '\n  fragment MapTile_SbMapFragment on SbMap {\n    id\n    name\n    kind\n    playerCount\n    staffPick\n    listed\n    publishedAt\n    isFavorited\n    publisher {\n      id\n    }\n    family {\n      id\n      name\n      current {\n        id\n      }\n    }\n    stats {\n      id\n      games7d\n      games28d\n      gamesTotal\n      trendingScore\n    }\n    file {\n      id\n      ...MapFileImage_FileFragment\n      width\n      height\n      tileset\n      isEud\n      umsForces {\n        name\n        teamId\n        players {\n          playerId\n          isComputer\n        }\n      }\n    }\n  }\n': typeof types.MapTile_SbMapFragmentFragmentDoc
  '\n  mutation MapUnpublish($fileId: SbMapId!) {\n    mapUnpublish(fileId: $fileId) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n    }\n  }\n': typeof types.MapUnpublishDocument
  '\n  query MapUploadKnownMap($hashes: [String!]!) {\n    mapsByHash(hashes: $hashes) {\n      id\n    }\n  }\n': typeof types.MapUploadKnownMapDocument
  '\n  mutation MapUploadAddToLibrary($id: SbMapId!) {\n    mapAddToLibrary(id: $id) {\n      id\n      inLibrary\n    }\n  }\n': typeof types.MapUploadAddToLibraryDocument
  '\n  query NewsArchive($first: Int, $after: String) {\n    newsPosts(first: $first, after: $after) {\n      edges {\n        node {\n          id\n          title\n          summary\n          translations {\n            language\n            title\n            summary\n          }\n          publishedAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n': typeof types.NewsArchiveDocument
  '\n  fragment News_HomeFeedFragment on Query {\n    newsPosts(first: 10) {\n      edges {\n        node {\n          id\n          title\n          summary\n          translations {\n            language\n            title\n            summary\n          }\n          publishedAt\n          coverImageUrl\n          coverImageSmallUrl\n        }\n      }\n    }\n  }\n': typeof types.News_HomeFeedFragmentFragmentDoc
  '\n  mutation NewsUpdatePost($id: UUID!, $updates: NewsPostUpdates!) {\n    newsUpdatePost(id: $id, updates: $updates) {\n      id\n      title\n      summary\n      content\n      translations {\n        language\n        title\n        summary\n        content\n      }\n      publishedAt\n      updatedAt\n      coverImagePath\n      coverImageUrl\n      coverImageSmallUrl\n    }\n  }\n': typeof types.NewsUpdatePostDocument
  '\n  mutation NewsDeletePost($id: UUID!) {\n    newsDeletePost(id: $id)\n  }\n': typeof types.NewsDeletePostDocument
  '\n  query NewsPost($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      content\n      translations {\n        language\n        title\n        content\n      }\n      publishedAt\n      coverImageUrl\n      coverImageSmallUrl\n      author {\n        id\n        name\n      }\n    }\n  }\n': typeof types.NewsPostDocument
  '\n  fragment AccountSettings_CurrentUser on CurrentUser {\n    id\n    name\n    loginName\n    email\n    emailVerified\n    lastLoginNameChange\n    lastNameChange\n    nameChangeTokens\n    canChangeDisplayName\n    nextDisplayNameChangeAllowedAt\n  }\n': typeof types.AccountSettings_CurrentUserFragmentDoc
  '\n  query AccountSettings {\n    currentUser {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsDocument
  '\n  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangePasswordDocument
  '\n  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { email: $email }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangeEmailDocument
  '\n  mutation AccountSettingsChangeDisplayName($currentPassword: String!, $name: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { name: $name }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangeDisplayNameDocument
  '\n  mutation AccountSettingsChangeLoginName($currentPassword: String!, $loginName: String!) {\n    userUpdateCurrent(currentPassword: $currentPassword, changes: { loginName: $loginName }) {\n      ...AccountSettings_CurrentUser\n    }\n  }\n': typeof types.AccountSettingsChangeLoginNameDocument
  '\n  query ConnectionSettings {\n    myTwitchConnection {\n      id\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n': typeof types.ConnectionSettingsDocument
  '\n  mutation ConnectionSettingsStartTwitchLink($desktop: Boolean!) {\n    twitchStartLink(desktop: $desktop) {\n      url\n    }\n  }\n': typeof types.ConnectionSettingsStartTwitchLinkDocument
  '\n  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {\n    twitchCompleteLink(code: $code, state: $state) {\n      id\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n': typeof types.ConnectionSettingsCompleteTwitchLinkDocument
  '\n  mutation ConnectionSettingsUnlinkTwitch {\n    twitchUnlink\n  }\n': typeof types.ConnectionSettingsUnlinkTwitchDocument
  '\n  query LiveUserIds {\n    liveStreamUserIds\n  }\n': typeof types.LiveUserIdsDocument
  '\n  fragment LiveStreams_FeedFragment on Query {\n    liveStreams {\n      twitchLogin\n      viewerCount\n      ...LiveStreams_FeedEntryFragment\n    }\n  }\n': typeof types.LiveStreams_FeedFragmentFragmentDoc
  '\n  fragment LiveStreams_FeedEntryFragment on LiveStream {\n    id\n    twitchLogin\n    twitchDisplayName\n    title\n    viewerCount\n    startedAt\n    thumbnailUrl\n    user {\n      id\n      name\n    }\n  }\n': typeof types.LiveStreams_FeedEntryFragmentFragmentDoc
  '\n  mutation BlockStream($userId: SbUserId!) {\n    blockStream(userId: $userId)\n  }\n': typeof types.BlockStreamDocument
  '\n  mutation UnblockStream($userId: SbUserId!) {\n    unblockStream(userId: $userId)\n  }\n': typeof types.UnblockStreamDocument
  '\n  query LiveStreamsPage {\n    ...LiveStreams_FeedFragment\n  }\n': typeof types.LiveStreamsPageDocument
  '\n  query UserNameAuditHistory(\n    $userId: SbUserId!\n    $displayNameLimit: Int\n    $displayNameOffset: Int\n    $loginNameLimit: Int\n    $loginNameOffset: Int\n  ) {\n    userDisplayNameAuditHistory(\n      userId: $userId\n      limit: $displayNameLimit\n      offset: $displayNameOffset\n    ) {\n      id\n      oldName\n      newName\n      changedAt\n      changedByUser {\n        id\n      }\n      changeReason\n      ipAddress\n      userAgent\n      usedToken\n    }\n    userLoginNameAuditHistory(userId: $userId, limit: $loginNameLimit, offset: $loginNameOffset) {\n      id\n      oldLoginName\n      newLoginName\n      changedAt\n      changeReason\n      ipAddress\n      userAgent\n    }\n  }\n': typeof types.UserNameAuditHistoryDocument
  '\n  mutation AdminChangeUserDisplayName(\n    $userId: SbUserId!\n    $newName: String!\n    $grantToken: Boolean!\n    $reason: String\n  ) {\n    userAdminChangeDisplayName(\n      userId: $userId\n      newName: $newName\n      grantToken: $grantToken\n      reason: $reason\n    ) {\n      id\n      name\n    }\n  }\n': typeof types.AdminChangeUserDisplayNameDocument
  '\n  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {\n    user(id: $userId) {\n      id\n      ...AdminUserProfile_Permissions @include(if: $includePermissions)\n    }\n  }\n': typeof types.AdminUserProfileDocument
  '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      useDevelopmentClient\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmaking\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageGameReports\n      manageRestrictedNames\n      manageSignupCodes\n      manageLiveStreams\n    }\n  }\n': typeof types.AdminUserProfile_PermissionsFragmentDoc
  '\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n': typeof types.AdminUpdateUserPermissionsDocument
  '\n  query UserProfileOwnedMaps($owner: SbUserId!, $after: String, $first: Int) {\n    maps(filter: { owner: $owner }, sort: NEWEST, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          id\n          ...MapTile_SbMapFragment\n        }\n      }\n    }\n  }\n': typeof types.UserProfileOwnedMapsDocument
  '\n  query UserProfileOwnsMaps($owner: SbUserId!) {\n    maps(filter: { owner: $owner }, first: 1) {\n      edges {\n        cursor\n      }\n    }\n  }\n': typeof types.UserProfileOwnsMapsDocument
  '\n  query UserProfileOverlayLive($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      commendCount\n      liveStream {\n        id\n        twitchLogin\n        title\n        viewerCount\n      }\n    }\n  }\n': typeof types.UserProfileOverlayLiveDocument
  '\n  query UserRankedModes($userId: SbUserId!) {\n    userRankedModes(userId: $userId) {\n      matchmakingType\n      totalGames\n      wins\n      losses\n      rating\n      delta\n    }\n  }\n': typeof types.UserRankedModesDocument
  '\n  query UserRatingHistory($userId: SbUserId!, $matchmakingType: MatchmakingType!) {\n    userRatingHistory(userId: $userId, matchmakingType: $matchmakingType) {\n      matchmakingType\n      totalGames\n      downsampled\n      points {\n        changeDate\n        rating\n        points\n        seasonId\n      }\n    }\n  }\n': typeof types.UserRatingHistoryDocument
  '\n  query UserProfileHeader($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      commendCount\n      twitchChannel {\n        id\n        twitchLogin\n        twitchDisplayName\n      }\n      liveStream {\n        id\n        twitchLogin\n        title\n        gameName\n        viewerCount\n        startedAt\n        thumbnailUrl\n      }\n    }\n  }\n': typeof types.UserProfileHeaderDocument
}
const documents: Documents = {
  '\n  query AdminNewsList($first: Int, $after: String) {\n    newsPosts(includeUnpublished: true, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          title\n          summary\n          publishedAt\n          updatedAt\n          author {\n            id\n            name\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n':
    types.AdminNewsListDocument,
  '\n  query AdminNewsPost($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      summary\n      content\n      translations {\n        language\n        title\n        summary\n        content\n      }\n      publishedAt\n      coverImagePath\n      coverImageUrl\n      author {\n        id\n        name\n      }\n    }\n  }\n':
    types.AdminNewsPostDocument,
  '\n  query AdminNewsHistory($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      edits {\n        title\n        summary\n        content\n        translations {\n          language\n          title\n          summary\n          content\n        }\n        publishedAt\n        coverImagePath\n        editedAt\n        editor {\n          id\n          name\n        }\n      }\n    }\n  }\n':
    types.AdminNewsHistoryDocument,
  '\n  mutation NewsCreatePost($post: NewsPostCreation!) {\n    newsCreatePost(post: $post) {\n      id\n    }\n  }\n':
    types.NewsCreatePostDocument,
  '\n  query AdminBlockedStreams {\n    blockedStreams {\n      id\n      createdAt\n      twitchLogin\n      twitchDisplayName\n      user {\n        id\n        name\n      }\n      blockedBy {\n        id\n        name\n      }\n    }\n  }\n':
    types.AdminBlockedStreamsDocument,
  '\n  mutation AdminUnblockStream($userId: SbUserId!) {\n    unblockStream(userId: $userId)\n  }\n':
    types.AdminUnblockStreamDocument,
  '\n  query AdminMatchmakingConfig {\n    matchmakingConfig {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        winProbScale\n        maxRatingSpread\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n        weightRematch\n        rematchHalfLifeSeconds\n        rematchDensityRadius\n        rematchDensityReference\n        rematchDensityFloor\n      }\n      perMode {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          winProbScale\n          maxRatingSpread\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n          weightRematch\n          rematchHalfLifeSeconds\n          rematchDensityRadius\n          rematchDensityReference\n          rematchDensityFloor\n        }\n      }\n      defaults {\n        searchIntervalSeconds\n        maxPlayersExamined\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        winProbScale\n        maxRatingSpread\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n        weightRematch\n        rematchHalfLifeSeconds\n        rematchDensityRadius\n        rematchDensityReference\n        rematchDensityFloor\n      }\n      modeDefaults {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          winProbScale\n          maxRatingSpread\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n          weightRematch\n          rematchHalfLifeSeconds\n          rematchDensityRadius\n          rematchDensityReference\n          rematchDensityFloor\n        }\n      }\n    }\n  }\n':
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
  '\n  query CurrentUrgentMessage {\n    urgentMessage {\n      id\n      title\n      message\n      translations {\n        language\n        title\n        message\n      }\n    }\n  }\n':
    types.CurrentUrgentMessageDocument,
  '\n  mutation SetUrgentMessage($message: UrgentMessageInput) {\n    newsSetUrgentMessage(message: $message)\n  }\n':
    types.SetUrgentMessageDocument,
  '\n  query ChannelActivity {\n    liveStreams {\n      id\n      twitchLogin\n      viewerCount\n      user {\n        id\n        name\n      }\n      ...LiveStreams_FeedEntryFragment\n    }\n    liveGames {\n      id\n      startTime\n      map {\n        id\n        name\n        mapFile {\n          id\n          image256Url\n          image512Url\n          image1024Url\n          image2048Url\n          width\n          height\n        }\n      }\n      config {\n        __typename\n        ... on GameConfigDataMatchmaking {\n          gameSourceExtra {\n            matchmakingType\n          }\n          teams {\n            race\n            user {\n              id\n              name\n            }\n          }\n        }\n      }\n    }\n  }\n':
    types.ChannelActivityDocument,
  '\n  query AdminGameReportsList($filter: GameReportFilter, $first: Int, $after: String) {\n    gameReports(filter: $filter, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          reason\n          details\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          reportedUser {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n':
    types.AdminGameReportsListDocument,
  '\n  query AdminGameReport($id: UUID!) {\n    gameReport(id: $id) {\n      id\n      reason\n      details\n      gameTimeSeconds\n      createdAt\n      resolvedAt\n      resolution\n      resolutionNotes\n      reporter {\n        id\n        name\n      }\n      reportedUser {\n        id\n        name\n      }\n      resolver {\n        id\n      }\n      game {\n        id\n        config {\n          __typename\n          ... on GameConfigDataLobby {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n          ... on GameConfigDataMatchmaking {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n        }\n      }\n      replay {\n        replayFileId\n        hash\n        url\n      }\n      reporterStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      reportedUserStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      siblingReports {\n        id\n        reason\n        details\n        gameTimeSeconds\n        createdAt\n        resolvedAt\n        resolution\n        reporter {\n          id\n        }\n      }\n    }\n  }\n':
    types.AdminGameReportDocument,
  '\n  mutation ResolveGameReport($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveGameReport(id: $id, resolution: $resolution, notes: $notes) {\n      id\n      resolvedAt\n      resolution\n      resolutionNotes\n      resolver {\n        id\n      }\n    }\n  }\n':
    types.ResolveGameReportDocument,
  '\n  mutation ResolveSiblingReports($id: UUID!, $resolution: GameReportResolution!, $notes: String) {\n    resolveSiblingReports(id: $id, resolution: $resolution, notes: $notes)\n  }\n':
    types.ResolveSiblingReportsDocument,
  '\n  query GameFeedback($gameId: UUID!) {\n    gameFeedback(gameId: $gameId) {\n      id\n      closesAt\n      given {\n        userId\n        kind\n      }\n      commendsRemaining\n      commendsAvailableAt\n      recentCommends {\n        userId\n        availableAt\n      }\n    }\n  }\n':
    types.GameFeedbackDocument,
  '\n  mutation CommendPlayer($gameId: UUID!, $userId: SbUserId!) {\n    commendPlayer(gameId: $gameId, userId: $userId) {\n      feedback {\n        id\n        closesAt\n        given {\n          userId\n          kind\n        }\n        commendsRemaining\n        commendsAvailableAt\n        recentCommends {\n          userId\n          availableAt\n        }\n      }\n      commendedUser {\n        id\n        commendCount\n      }\n    }\n  }\n':
    types.CommendPlayerDocument,
  '\n  query GamesPageContent {\n    ...LiveGames_FeedFragment\n  }\n':
    types.GamesPageContentDocument,
  '\n  fragment LiveGames_FeedFragment on Query {\n    liveGames {\n      id\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n':
    types.LiveGames_FeedFragmentFragmentDoc,
  '\n  fragment LiveGames_FeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_FeedEntryPlayersFragment\n        }\n      }\n    }\n\n    currentRanks {\n      id\n      userId\n      matchmakingType\n      seasonId\n      points\n      lifetimeGames\n    }\n\n    ...LiveGames_FeedEntryMapAndTypeFragment\n  }\n':
    types.LiveGames_FeedEntryFragmentFragmentDoc,
  '\n  fragment LiveGames_FeedEntryPlayersFragment on GamePlayer {\n    user {\n      id\n      name\n    }\n    race\n  }\n':
    types.LiveGames_FeedEntryPlayersFragmentFragmentDoc,
  '\n  fragment LiveGames_FeedEntryMapAndTypeFragment on Game {\n    id\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n      }\n    }\n  }\n':
    types.LiveGames_FeedEntryMapAndTypeFragmentFragmentDoc,
  '\n  mutation ReportGame($input: ReportGameInput!) {\n    reportGame(input: $input) {\n      id\n    }\n  }\n':
    types.ReportGameDocument,
  '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...Leagues_HomeFeedFragment\n    ...News_HomeFeedFragment\n  }\n':
    types.HomePageContentDocument,
  '\n  query HomePageLiveContent {\n    ...LiveGames_FeedFragment\n    ...LiveStreams_FeedFragment\n  }\n':
    types.HomePageLiveContentDocument,
  '\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n    translations {\n      language\n      title\n      message\n    }\n  }\n':
    types.UrgentMessage_HomeDisplayFragmentFragmentDoc,
  '\n  fragment Leagues_LeagueBadgeFragment on League {\n    name\n    translations {\n      language\n      name\n    }\n    badgeUrl\n  }\n':
    types.Leagues_LeagueBadgeFragmentFragmentDoc,
  '\n  fragment Leagues_HomeFeedFragment on Query {\n    activeLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n\n    futureLeagues {\n      id\n      ...Leagues_HomeFeedEntryFragment\n    }\n  }\n':
    types.Leagues_HomeFeedFragmentFragmentDoc,
  '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    translations {\n      language\n      name\n    }\n    matchmakingType\n    startAt\n    endAt\n    ...Leagues_LeagueBadgeFragment\n  }\n':
    types.Leagues_HomeFeedEntryFragmentFragmentDoc,
  '\n  query AdminMapFamilyReports($status: MapFamilyReportStatus!, $limit: Int!, $offset: Int!) {\n    mapFamilyReports(status: $status, limit: $limit, offset: $offset) {\n      id\n      kind\n      note\n      fromPublish\n      publishAnswer\n      reportedAt\n      status\n      resolvedAt\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n      }\n      map {\n        id\n        name\n      }\n      otherFamily {\n        id\n        name\n        current {\n          id\n        }\n      }\n      reportedBy {\n        id\n      }\n      resolvedBy {\n        id\n      }\n    }\n  }\n':
    types.AdminMapFamilyReportsDocument,
  '\n  query AdminMapFamilyReportCounts {\n    open: mapFamilyReportCount(status: OPEN)\n    resolved: mapFamilyReportCount(status: RESOLVED)\n    dismissed: mapFamilyReportCount(status: DISMISSED)\n    openClaims: mapOwnerClaimCount(status: OPEN)\n    openCollectionReports: mapCollectionReportCount\n  }\n':
    types.AdminMapFamilyReportCountsDocument,
  '\n  query AdminMapOwnerClaims($limit: Int!, $offset: Int!) {\n    mapOwnerClaims(status: OPEN, limit: $limit, offset: $offset) {\n      id\n      note\n      status\n      createdAt\n      claimant {\n        id\n      }\n      family {\n        id\n        name\n        owner {\n          id\n        }\n      }\n    }\n  }\n':
    types.AdminMapOwnerClaimsDocument,
  '\n  mutation AdminMapOwnerClaimGrant($claimId: UUID!) {\n    mapOwnerClaimGrant(claimId: $claimId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n      family {\n        id\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n':
    types.AdminMapOwnerClaimGrantDocument,
  '\n  mutation AdminMapOwnerClaimReject($claimId: UUID!) {\n    mapOwnerClaimReject(claimId: $claimId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n    }\n  }\n':
    types.AdminMapOwnerClaimRejectDocument,
  '\n  query AdminMapCollectionReports($after: String, $first: Int!) {\n    mapCollectionReports(open: true, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        node {\n          id\n          note\n          createdAt\n          reporter {\n            id\n          }\n          collection {\n            id\n            title\n            owner {\n              id\n            }\n          }\n        }\n      }\n    }\n  }\n':
    types.AdminMapCollectionReportsDocument,
  '\n  fragment MapSearchTest_Map on SbMap {\n    id\n    name\n    kind\n    playerCount\n    listed\n    staffPick\n    publishedAt\n    favoriteCount\n    isFavorited\n    inLibrary\n    publisher {\n      id\n      name\n    }\n    stats {\n      id\n      games7d\n      games28d\n      games90d\n      gamesTotal\n      players90d\n      medianLength90d\n      lastPlayedAt\n    }\n    file {\n      id\n      tileset\n      width\n      height\n      isEud\n      image256Url\n    }\n  }\n':
    types.MapSearchTest_MapFragmentDoc,
  '\n  query MapSearchTestMaps($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    maps(filter: $filter, sort: $sort, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          ...MapSearchTest_Map\n        }\n      }\n    }\n  }\n':
    types.MapSearchTestMapsDocument,
  '\n  query MapSearchTestLibrary($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    currentUser {\n      id\n      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            ...MapSearchTest_Map\n          }\n        }\n      }\n    }\n  }\n':
    types.MapSearchTestLibraryDocument,
  '\n  query MapSearchTestFavorites($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    currentUser {\n      id\n      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            ...MapSearchTest_Map\n          }\n        }\n      }\n    }\n  }\n':
    types.MapSearchTestFavoritesDocument,
  '\n  query MapSearchTestMap($id: SbMapId!) {\n    map(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n':
    types.MapSearchTestMapDocument,
  '\n  mutation MapSearchTestAddFavorite($id: SbMapId!) {\n    mapAddFavorite(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n':
    types.MapSearchTestAddFavoriteDocument,
  '\n  mutation MapSearchTestRemoveFavorite($id: SbMapId!) {\n    mapRemoveFavorite(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n':
    types.MapSearchTestRemoveFavoriteDocument,
  '\n  query MapSpawnsTestMaps {\n    maps(first: 100) {\n      edges {\n        node {\n          id\n          name\n          file {\n            id\n            image256Url\n            image512Url\n            image1024Url\n            image2048Url\n            imageSpawnsBaked\n            width\n            height\n            startLocations {\n              id\n              slot\n              x\n              y\n            }\n            umsContent\n          }\n        }\n      }\n    }\n  }\n':
    types.MapSpawnsTestMapsDocument,
  '\n  query MapSpawnsTestMap($id: SbMapId!) {\n    map(id: $id) {\n      id\n      name\n      file {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        imageSpawnsBaked\n        width\n        height\n        startLocations {\n          id\n          slot\n          x\n          y\n        }\n        umsContent\n      }\n    }\n  }\n':
    types.MapSpawnsTestMapDocument,
  '\n  query LocalKnownMap($hashes: [String!]!) {\n    mapsByHash(hashes: $hashes) {\n      id\n      name\n    }\n  }\n':
    types.LocalKnownMapDocument,
  '\n  query MapCatalogAll(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    maps(filter: $filter, sort: $sort, after: $after, first: $first) {\n      totalCount @include(if: $withCount)\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          id\n          family {\n            id\n          }\n          ...MapTile_SbMapFragment\n        }\n      }\n    }\n  }\n':
    types.MapCatalogAllDocument,
  '\n  query MapCatalogLibrary(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    currentUser {\n      id\n      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            id\n            family {\n              id\n            }\n            ...MapTile_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n':
    types.MapCatalogLibraryDocument,
  '\n  query MapCatalogFavorites(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    currentUser {\n      id\n      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            family {\n              id\n            }\n            ...MapTile_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n':
    types.MapCatalogFavoritesDocument,
  '\n  mutation MapCollectionUpdate($id: UUID!, $title: String, $description: String, $public: Boolean) {\n    mapCollectionUpdate(id: $id, title: $title, description: $description, public: $public) {\n      id\n      title\n      description\n      public\n      updatedAt\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n':
    types.MapCollectionUpdateDocument,
  '\n  mutation MapCollectionAddMap($collectionId: UUID!, $mapId: SbMapId!) {\n    mapCollectionAddMap(collectionId: $collectionId, mapId: $mapId) {\n      id\n      mapCount\n      updatedAt\n      ...MapCollectionMosaic_CollectionFragment\n    }\n  }\n':
    types.MapCollectionAddMapDocument,
  '\n  mutation MapCollectionSave($id: UUID!) {\n    mapCollectionSave(id: $id) {\n      id\n      isSaved\n      saveCount\n    }\n  }\n':
    types.MapCollectionSaveDocument,
  '\n  mutation MapCollectionUnsave($id: UUID!) {\n    mapCollectionUnsave(id: $id) {\n      id\n      isSaved\n      saveCount\n    }\n  }\n':
    types.MapCollectionUnsaveDocument,
  '\n  mutation MapCollectionUnhide($id: UUID!) {\n    mapCollectionUnhide(id: $id) {\n      id\n      public\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n':
    types.MapCollectionUnhideDocument,
  '\n  fragment MapCollectionMosaic_CollectionFragment on MapCollection {\n    id\n    cover {\n      id\n      name\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n':
    types.MapCollectionMosaic_CollectionFragmentFragmentDoc,
  '\n  fragment MapCollectionCard_CollectionFragment on MapCollection {\n    id\n    kind\n    title\n    public\n    mapCount\n    owner {\n      id\n      name\n    }\n    hidden {\n      id\n    }\n    pool {\n      id\n      matchmakingType\n      startDate\n      endDate\n    }\n    ...MapCollectionMosaic_CollectionFragment\n  }\n':
    types.MapCollectionCard_CollectionFragmentFragmentDoc,
  '\n  mutation MapCollectionCreate($title: String!, $staff: Boolean!) {\n    mapCollectionCreate(title: $title, staff: $staff) {\n      id\n      kind\n      title\n    }\n  }\n':
    types.MapCollectionCreateDocument,
  '\n  mutation MapCollectionDelete($id: UUID!) {\n    mapCollectionDelete(id: $id)\n  }\n':
    types.MapCollectionDeleteDocument,
  '\n  mutation MapCollectionReport($id: UUID!, $note: String!) {\n    mapCollectionReport(id: $id, note: $note) {\n      id\n    }\n  }\n':
    types.MapCollectionReportDocument,
  '\n  mutation MapCollectionHide($id: UUID!, $note: String!) {\n    mapCollectionHide(id: $id, note: $note) {\n      id\n      public\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n':
    types.MapCollectionHideDocument,
  '\n  query MapCollectionPage($id: UUID!) {\n    mapCollection(id: $id) {\n      id\n      kind\n      title\n      description\n      public\n      grantsStaffPick\n      canEdit\n      isSaved\n      mapCount\n      owner {\n        id\n        name\n      }\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n      pool {\n        id\n        matchmakingType\n        startDate\n        endDate\n        isCurrent\n        maxVetoCount\n        previous {\n          id\n        }\n        next {\n          id\n        }\n      }\n      ...MapCollectionMosaic_CollectionFragment\n    }\n  }\n':
    types.MapCollectionPageDocument,
  '\n  fragment MapCollectionRow_SbMapFragment on SbMap {\n    id\n    family {\n      id\n      listed\n    }\n    ...MapTile_SbMapFragment\n  }\n':
    types.MapCollectionRow_SbMapFragmentFragmentDoc,
  '\n  query MapCollectionPageMaps($id: UUID!, $after: String, $first: Int!, $withCount: Boolean!) {\n    mapCollection(id: $id) {\n      id\n      maps(after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            ...MapCollectionRow_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n':
    types.MapCollectionPageMapsDocument,
  '\n  query MapCollectionEntries($id: UUID!, $after: String, $first: Int!) {\n    mapCollection(id: $id) {\n      id\n      maps(after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          node {\n            id\n            family {\n              id\n              listed\n            }\n          }\n        }\n      }\n    }\n  }\n':
    types.MapCollectionEntriesDocument,
  '\n  query MapCollectionReportBar($open: Boolean!, $first: Int!) {\n    mapCollectionReports(open: $open, first: $first) {\n      edges {\n        node {\n          id\n          note\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          resolvedBy {\n            id\n          }\n          collection {\n            id\n          }\n        }\n      }\n    }\n  }\n':
    types.MapCollectionReportBarDocument,
  '\n  mutation MapCollectionReportDismiss($reportId: UUID!) {\n    mapCollectionReportDismiss(reportId: $reportId) {\n      id\n      resolvedAt\n      resolution\n      resolvedBy {\n        id\n      }\n    }\n  }\n':
    types.MapCollectionReportDismissDocument,
  '\n  query MapCollectionsTab($search: String, $loggedIn: Boolean!, $first: Int!) {\n    currentUser @include(if: $loggedIn) {\n      id\n      mapCollections {\n        id\n        kind\n        title\n        ...MapCollectionCard_CollectionFragment\n      }\n    }\n    ladder: mapCollections(section: LADDER, search: $search, first: $first) {\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n    staff: mapCollections(section: STAFF, search: $search, first: $first) {\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n  }\n':
    types.MapCollectionsTabDocument,
  '\n  query MapCollectionsPlayers($search: String, $after: String, $first: Int!, $withCount: Boolean!) {\n    mapCollections(section: PLAYERS, search: $search, after: $after, first: $first) {\n      totalCount @include(if: $withCount)\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n  }\n':
    types.MapCollectionsPlayersDocument,
  '\n  query MapCompare($a: SbMapId!, $b: SbMapId!) {\n    mapComparison(a: $a, b: $b) {\n      id\n      changes\n      terrainSimilarity\n      terrainChanges\n      startLocations {\n        id\n        slot\n        kind\n      }\n      bases {\n        id\n        beforeIndex\n        afterIndex\n        changed\n      }\n      a {\n        id\n        ...MapCompare_Side\n      }\n      b {\n        id\n        ...MapCompare_Side\n      }\n    }\n  }\n':
    types.MapCompareDocument,
  '\n  fragment MapCompare_Side on SbMap {\n    id\n    name\n    playerCount\n    file {\n      id\n      tileset\n      width\n      height\n      isEud\n      image2048Url\n      imageSpawnsBaked\n      umsContent\n      startLocations {\n        id\n        slot\n        x\n        y\n      }\n      analysis {\n        id\n        triggerCount\n        umsActionKinds\n      }\n    }\n  }\n':
    types.MapCompare_SideFragmentDoc,
  '\n  query MapDefaultNudge($id: SbMapId!) {\n    map(id: $id) {\n      id\n      family {\n        id\n        current {\n          id\n          name\n          listed\n        }\n      }\n    }\n  }\n':
    types.MapDefaultNudgeDocument,
  '\n  mutation MapDelist($fileId: SbMapId!, $note: String) {\n    mapDelist(fileId: $fileId, note: $note) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n      moderation {\n        id\n        publishedAt\n        delistedAt\n        delistedKind\n        delistedNote\n        delistedBy {\n          id\n          name\n        }\n      }\n    }\n  }\n':
    types.MapDelistDocument,
  '\n  fragment MapFamilyAction_FamilyFragment on MapFamily {\n    id\n    name\n    listed\n    current {\n      id\n    }\n    defaultMap {\n      id\n    }\n    files {\n      id\n      name\n      listed\n      firstSeenAt\n      favoriteCount\n      stats {\n        id\n        games28d\n        gamesTotal\n      }\n    }\n  }\n':
    types.MapFamilyAction_FamilyFragmentFragmentDoc,
  '\n  query MapFamilyActionFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        ...MapFamilyAction_FamilyFragment\n      }\n    }\n  }\n':
    types.MapFamilyActionFamilyDocument,
  '\n  query MapFamilyActionSimilar($fileId: SbMapId!) {\n    similarFiles(fileId: $fileId) {\n      id\n      similarity\n      map {\n        id\n        family {\n          id\n          name\n          ...MapFamilySearch_FamilyFragment\n        }\n      }\n    }\n  }\n':
    types.MapFamilyActionSimilarDocument,
  '\n  mutation MapFamilySplitFile($fileId: SbMapId!) {\n    mapFamilySplitFile(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n':
    types.MapFamilySplitFileDocument,
  '\n  mutation MapFamilyMoveFile($fileId: SbMapId!, $familyId: UUID!) {\n    mapFamilyMoveFile(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n':
    types.MapFamilyMoveFileDocument,
  '\n  mutation MapFamilyMerge($familyId: UUID!, $intoFamilyId: UUID!) {\n    mapFamilyMerge(familyId: $familyId, intoFamilyId: $intoFamilyId) {\n      id\n      name\n    }\n  }\n':
    types.MapFamilyMergeDocument,
  '\n  query MapFamilyReportFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        current {\n          id\n        }\n        owner {\n          id\n          name\n        }\n        files {\n          id\n          name\n          listed\n          firstSeenAt\n        }\n      }\n    }\n  }\n':
    types.MapFamilyReportFamilyDocument,
  '\n  mutation MapFamilyReport($input: MapFamilyReportInput!) {\n    mapFamilyReport(input: $input) {\n      id\n      status\n    }\n  }\n':
    types.MapFamilyReportDocument,
  '\n  fragment MapFamilySearch_FamilyFragment on MapFamily {\n    id\n    name\n    stats {\n      id\n      gamesTotal\n    }\n    files {\n      id\n    }\n    current {\n      id\n      listed\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n':
    types.MapFamilySearch_FamilyFragmentFragmentDoc,
  '\n  query MapFamilySearch($search: String!) {\n    maps(filter: { search: $search }, first: 6) {\n      nodes {\n        id\n        family {\n          id\n          ...MapFamilySearch_FamilyFragment\n        }\n      }\n    }\n  }\n':
    types.MapFamilySearchDocument,
  '\n  query MapFamilySearchById($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        ...MapFamilySearch_FamilyFragment\n      }\n    }\n  }\n':
    types.MapFamilySearchByIdDocument,
  '\n  mutation MapAddFavorite($id: SbMapId!) {\n    mapAddFavorite(id: $id) {\n      id\n      isFavorited\n      favoriteCount\n      family {\n        id\n        files {\n          id\n          isFavorited\n          favoriteCount\n        }\n      }\n    }\n  }\n':
    types.MapAddFavoriteDocument,
  '\n  mutation MapRemoveFavorite($id: SbMapId!) {\n    mapRemoveFavorite(id: $id) {\n      id\n      isFavorited\n      favoriteCount\n      family {\n        id\n        files {\n          id\n          isFavorited\n          favoriteCount\n        }\n      }\n    }\n  }\n':
    types.MapRemoveFavoriteDocument,
  '\n  fragment MapFileImage_FileFragment on MapFile {\n    id\n    image256Url\n    image512Url\n    image1024Url\n    image2048Url\n    imageSpawnsBaked\n    width\n    height\n    startLocations {\n      id\n      slot\n      x\n      y\n    }\n    umsContent\n  }\n':
    types.MapFileImage_FileFragmentFragmentDoc,
  '\n  mutation LocalAddToLibrary($id: SbMapId!) {\n    mapAddToLibrary(id: $id) {\n      id\n      inLibrary\n    }\n  }\n':
    types.LocalAddToLibraryDocument,
  '\n  mutation MapFamilySetDefault($fileId: SbMapId!) {\n    mapFamilySetDefault(fileId: $fileId) {\n      id\n      name\n      current {\n        id\n        name\n      }\n      defaultMap {\n        id\n      }\n      defaultSetAt\n      defaultSetBy {\n        id\n        name\n      }\n    }\n  }\n':
    types.MapFamilySetDefaultDocument,
  '\n  fragment MapOwner_FamilyOwnerFragment on MapFamily {\n    id\n    owner {\n      id\n      name\n    }\n    ownerKind\n    ownerSetAt\n    credit\n  }\n':
    types.MapOwner_FamilyOwnerFragmentFragmentDoc,
  '\n  mutation MapOwnerClaim($familyId: UUID!, $note: String) {\n    mapOwnerClaim(familyId: $familyId, note: $note) {\n      id\n      granted\n      claim {\n        id\n        status\n        note\n        createdAt\n      }\n      family {\n        id\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n':
    types.MapOwnerClaimDocument,
  '\n  mutation MapOwnerRelinquish($familyId: UUID!) {\n    mapOwnerRelinquish(familyId: $familyId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n':
    types.MapOwnerRelinquishDocument,
  '\n  mutation MapFamilyRemoveOwner($familyId: UUID!) {\n    mapFamilyRemoveOwner(familyId: $familyId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n':
    types.MapFamilyRemoveOwnerDocument,
  '\n  query MapOwnerEditFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        name\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n':
    types.MapOwnerEditFamilyDocument,
  '\n  mutation MapFamilySetOwner($familyId: UUID!, $userId: SbUserId!) {\n    mapFamilySetOwner(familyId: $familyId, userId: $userId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n':
    types.MapFamilySetOwnerDocument,
  '\n  mutation MapFamilySetCredit($familyId: UUID!, $credit: String) {\n    mapFamilySetCredit(familyId: $familyId, credit: $credit) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n':
    types.MapFamilySetCreditDocument,
  '\n  query MapOwnerAddFileLibrary($after: String, $first: Int, $canManageMaps: Boolean!) {\n    currentUser {\n      id\n      mapLibrary(sort: NEWEST, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            name\n            listed\n            playerCount\n            publishedAt\n            publisher {\n              id\n            }\n            moderation @include(if: $canManageMaps) {\n              id\n              delistedKind\n            }\n            family {\n              id\n              name\n              listed\n              credit\n              owner {\n                id\n              }\n              files {\n                id\n              }\n            }\n            file {\n              id\n              width\n              height\n              ...MapFileImage_FileFragment\n            }\n          }\n        }\n      }\n    }\n  }\n':
    types.MapOwnerAddFileLibraryDocument,
  '\n  query MapOwnerAddFileUploaded($id: SbMapId!, $canManageMaps: Boolean!) {\n    map(id: $id) {\n      id\n      name\n      listed\n      playerCount\n      publishedAt\n      publisher {\n        id\n      }\n      moderation @include(if: $canManageMaps) {\n        id\n        delistedKind\n      }\n      family {\n        id\n        name\n        listed\n        credit\n        owner {\n          id\n        }\n        files {\n          id\n        }\n      }\n      file {\n        id\n        width\n        height\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n':
    types.MapOwnerAddFileUploadedDocument,
  '\n  mutation MapOwnerAddFileLink($fileId: SbMapId!, $familyId: UUID!) {\n    mapFileLink(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n':
    types.MapOwnerAddFileLinkDocument,
  '\n  mutation MapOwnerAddFilePublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {\n    mapPublish(fileId: $fileId, answer: $answer) {\n      id\n      heldForReview\n      file {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n':
    types.MapOwnerAddFilePublishDocument,
  '\n  query MapLiveGames {\n    liveGames {\n      id\n      map {\n        id\n      }\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n':
    types.MapLiveGamesDocument,
  '\n  fragment MapPageFiles_FileFragment on SbMap {\n    id\n    name\n    listed\n    firstSeenAt\n    stats {\n      id\n      games28d\n      gamesTotal\n    }\n  }\n':
    types.MapPageFiles_FileFragmentFragmentDoc,
  '\n  fragment MapPageFiles_FamilyFragment on MapFamily {\n    id\n    name\n    listed\n    current {\n      id\n      name\n    }\n    defaultMap {\n      id\n    }\n    defaultSetBy @include(if: $canManageMaps) {\n      id\n      name\n    }\n    owner {\n      id\n    }\n    files {\n      id\n      ...MapPageFiles_FileFragment\n    }\n  }\n':
    types.MapPageFiles_FamilyFragmentFragmentDoc,
  '\n  mutation MapPageFilesUnlink($fileId: SbMapId!) {\n    mapFileUnlink(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n':
    types.MapPageFilesUnlinkDocument,
  '\n  fragment MapPageStats_FamilyFragment on MapFamily {\n    id\n    stats {\n      id\n      gamesTotal\n      games28d\n      players90d\n      medianLength90d\n      lastPlayedAt\n    }\n    weeklyActivity(weeks: 26) {\n      id\n      weekStart\n      lobbyGames\n      matchmakingGames\n    }\n  }\n':
    types.MapPageStats_FamilyFragmentFragmentDoc,
  '\n  fragment MapPageMatchups_MapFragment on SbMap {\n    id\n    kind\n    matchupSeasons {\n      id\n      seasonId\n      matchmakingType\n      games\n    }\n  }\n':
    types.MapPageMatchups_MapFragmentFragmentDoc,
  '\n  query MapMatchups($id: SbMapId!, $matchmakingType: MatchmakingType!, $seasonId: Int) {\n    map(id: $id) {\n      id\n      matchups(matchmakingType: $matchmakingType, seasonId: $seasonId) {\n        id\n        matchup\n        games\n        leftWins\n        rightWins\n        medianLength\n      }\n    }\n  }\n':
    types.MapMatchupsDocument,
  '\n  query MapPageFamily($id: UUID!, $canManageMaps: Boolean!) {\n    mapFamily(id: $id) {\n      id\n      file {\n        id\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n        owner {\n          id\n          name\n        }\n        ownerKind\n        credit\n        ...MapPageStats_FamilyFragment\n        ...MapPageFiles_FamilyFragment\n      }\n    }\n  }\n':
    types.MapPageFamilyDocument,
  '\n  query MapPageFile($id: SbMapId!, $canManageMaps: Boolean!) {\n    map(id: $id) {\n      id\n      name\n      kind\n      family {\n        id\n        name\n      }\n      stats {\n        id\n      }\n      file {\n        id\n        image256Url\n        ...MapFileImage_FileFragment\n      }\n      ...MapPage_HeaderFragment\n      ...MapPage_ActionsFragment\n      ...MapPage_FactsFragment\n      ...MapPage_HowToPlayFragment\n      ...MapPageMatchups_MapFragment\n      ...MapPageFiles_FileFragment\n    }\n  }\n':
    types.MapPageFileDocument,
  '\n  fragment MapPage_FactsFragment on SbMap {\n    id\n    kind\n    playerCount\n    file {\n      id\n      width\n      height\n      tileset\n      isEud\n      umsForces {\n        name\n        teamId\n        players {\n          playerId\n          isComputer\n        }\n      }\n      analysis {\n        id\n        baseCount\n      }\n    }\n  }\n':
    types.MapPage_FactsFragmentFragmentDoc,
  '\n  fragment MapPage_HeaderFragment on SbMap {\n    id\n    name\n    description\n    kind\n    listed\n    staffPick\n    publishedAt\n    publisher {\n      id\n      name\n    }\n    file {\n      id\n      originalName\n      originalDescription\n    }\n    moderation @include(if: $canManageMaps) {\n      id\n      delistedAt\n      delistedKind\n      delistedNote\n      delistedBy {\n        id\n        name\n      }\n    }\n  }\n':
    types.MapPage_HeaderFragmentFragmentDoc,
  '\n  fragment MapPage_ActionsFragment on SbMap {\n    id\n    name\n    listed\n    isFavorited\n    inLibrary\n    publisher {\n      id\n    }\n    moderation @include(if: $canManageMaps) {\n      id\n      publishedAt\n      delistedKind\n    }\n  }\n':
    types.MapPage_ActionsFragmentFragmentDoc,
  '\n  mutation MapPageRelist($fileId: SbMapId!) {\n    mapRelist(fileId: $fileId) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n      moderation {\n        id\n        publishedAt\n        delistedAt\n        delistedKind\n        delistedNote\n        delistedBy {\n          id\n          name\n        }\n      }\n    }\n  }\n':
    types.MapPageRelistDocument,
  '\n  mutation MapPageFileUnlink($fileId: SbMapId!) {\n    mapFileUnlink(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n':
    types.MapPageFileUnlinkDocument,
  '\n  query MapPageClaimPreview($familyId: UUID!) {\n    mapOwnerClaimPreview(familyId: $familyId) {\n      id\n      blockedReason\n      instant\n      openClaim {\n        id\n        status\n      }\n    }\n  }\n':
    types.MapPageClaimPreviewDocument,
  '\n  fragment MapPage_HowToPlayFragment on SbMap {\n    id\n    kind\n    file {\n      id\n      originalDescription\n    }\n  }\n':
    types.MapPage_HowToPlayFragmentFragmentDoc,
  '\n  fragment MapPublish_SuggestionFragment on MapPublishSuggestion {\n    id\n    similarity\n    sameKind\n    triggerSimilarity\n    sameResources\n    family {\n      id\n      name\n    }\n    file {\n      id\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n':
    types.MapPublish_SuggestionFragmentFragmentDoc,
  '\n  fragment MapPublish_FileFragment on SbMap {\n    id\n    name\n    family {\n      id\n      name\n      current {\n        id\n      }\n    }\n    file {\n      id\n      ...MapFileImage_FileFragment\n    }\n  }\n':
    types.MapPublish_FileFragmentFragmentDoc,
  '\n  fragment MapPublish_PreviewFragment on MapPublishPreview {\n    id\n    blockedReason\n    needsReview\n    existingMap {\n      id\n      name\n    }\n    suggestions {\n      id\n      ...MapPublish_SuggestionFragment\n    }\n  }\n':
    types.MapPublish_PreviewFragmentFragmentDoc,
  '\n  query MapPublishPreview($fileId: SbMapId!) {\n    mapPublishPreview(fileId: $fileId) {\n      id\n      ...MapPublish_PreviewFragment\n    }\n    # What the views of the file show about its listing, so they all catch up to it once the\n    # preview loads\n    map(id: $fileId) {\n      id\n      listed\n      publishedAt\n      staffPick\n      publisher {\n        id\n        name\n      }\n      ...MapPublish_FileFragment\n    }\n  }\n':
    types.MapPublishPreviewDocument,
  '\n  query MapLinkSuggestions($fileId: SbMapId!) {\n    mapLinkSuggestions(fileId: $fileId) {\n      id\n      ...MapPublish_SuggestionFragment\n    }\n    map(id: $fileId) {\n      id\n      ...MapPublish_FileFragment\n    }\n  }\n':
    types.MapLinkSuggestionsDocument,
  '\n  mutation MapPublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {\n    mapPublish(fileId: $fileId, answer: $answer) {\n      id\n      heldForReview\n      file {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n':
    types.MapPublishDocument,
  '\n  mutation MapFileLink($fileId: SbMapId!, $familyId: UUID!) {\n    mapFileLink(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n':
    types.MapFileLinkDocument,
  '\n  query MapPublishOwnedMaps($owner: SbUserId!) {\n    maps(filter: { owner: $owner }, sort: NAME, first: 100) {\n      edges {\n        node {\n          id\n          family {\n            id\n            name\n          }\n        }\n      }\n    }\n  }\n':
    types.MapPublishOwnedMapsDocument,
  '\n  mutation MapPublishReviewApprove($reportId: UUID!) {\n    mapPublishReviewApprove(reportId: $reportId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n      map {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n      }\n    }\n  }\n':
    types.MapPublishReviewApproveDocument,
  '\n  mutation MapReportBarSetDefault($fileId: SbMapId!) {\n    mapFamilySetDefault(fileId: $fileId) {\n      id\n      name\n      current {\n        id\n        name\n      }\n      defaultMap {\n        id\n      }\n      defaultSetAt\n      defaultSetBy {\n        id\n        name\n      }\n    }\n  }\n':
    types.MapReportBarSetDefaultDocument,
  '\n  query MapReportBar($id: UUID!) {\n    mapFamilyReportById(id: $id) {\n      id\n      kind\n      note\n      fromPublish\n      publishAnswer\n      reportedAt\n      status\n      resolvedAt\n      reportedBy {\n        id\n      }\n      resolvedBy {\n        id\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n        owner {\n          id\n        }\n      }\n      map {\n        id\n        name\n        listed\n        firstSeenAt\n        family {\n          id\n        }\n        stats {\n          id\n          gamesTotal\n        }\n      }\n      otherFamily {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n':
    types.MapReportBarDocument,
  '\n  mutation MapFamilyReportSetStatus($id: UUID!, $status: MapFamilyReportStatus!) {\n    mapFamilyReportSetStatus(id: $id, status: $status) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n    }\n  }\n':
    types.MapFamilyReportSetStatusDocument,
  '\n  fragment MapTile_SbMapFragment on SbMap {\n    id\n    name\n    kind\n    playerCount\n    staffPick\n    listed\n    publishedAt\n    isFavorited\n    publisher {\n      id\n    }\n    family {\n      id\n      name\n      current {\n        id\n      }\n    }\n    stats {\n      id\n      games7d\n      games28d\n      gamesTotal\n      trendingScore\n    }\n    file {\n      id\n      ...MapFileImage_FileFragment\n      width\n      height\n      tileset\n      isEud\n      umsForces {\n        name\n        teamId\n        players {\n          playerId\n          isComputer\n        }\n      }\n    }\n  }\n':
    types.MapTile_SbMapFragmentFragmentDoc,
  '\n  mutation MapUnpublish($fileId: SbMapId!) {\n    mapUnpublish(fileId: $fileId) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n    }\n  }\n':
    types.MapUnpublishDocument,
  '\n  query MapUploadKnownMap($hashes: [String!]!) {\n    mapsByHash(hashes: $hashes) {\n      id\n    }\n  }\n':
    types.MapUploadKnownMapDocument,
  '\n  mutation MapUploadAddToLibrary($id: SbMapId!) {\n    mapAddToLibrary(id: $id) {\n      id\n      inLibrary\n    }\n  }\n':
    types.MapUploadAddToLibraryDocument,
  '\n  query NewsArchive($first: Int, $after: String) {\n    newsPosts(first: $first, after: $after) {\n      edges {\n        node {\n          id\n          title\n          summary\n          translations {\n            language\n            title\n            summary\n          }\n          publishedAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n':
    types.NewsArchiveDocument,
  '\n  fragment News_HomeFeedFragment on Query {\n    newsPosts(first: 10) {\n      edges {\n        node {\n          id\n          title\n          summary\n          translations {\n            language\n            title\n            summary\n          }\n          publishedAt\n          coverImageUrl\n          coverImageSmallUrl\n        }\n      }\n    }\n  }\n':
    types.News_HomeFeedFragmentFragmentDoc,
  '\n  mutation NewsUpdatePost($id: UUID!, $updates: NewsPostUpdates!) {\n    newsUpdatePost(id: $id, updates: $updates) {\n      id\n      title\n      summary\n      content\n      translations {\n        language\n        title\n        summary\n        content\n      }\n      publishedAt\n      updatedAt\n      coverImagePath\n      coverImageUrl\n      coverImageSmallUrl\n    }\n  }\n':
    types.NewsUpdatePostDocument,
  '\n  mutation NewsDeletePost($id: UUID!) {\n    newsDeletePost(id: $id)\n  }\n':
    types.NewsDeletePostDocument,
  '\n  query NewsPost($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      content\n      translations {\n        language\n        title\n        content\n      }\n      publishedAt\n      coverImageUrl\n      coverImageSmallUrl\n      author {\n        id\n        name\n      }\n    }\n  }\n':
    types.NewsPostDocument,
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
  '\n  query ConnectionSettings {\n    myTwitchConnection {\n      id\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n':
    types.ConnectionSettingsDocument,
  '\n  mutation ConnectionSettingsStartTwitchLink($desktop: Boolean!) {\n    twitchStartLink(desktop: $desktop) {\n      url\n    }\n  }\n':
    types.ConnectionSettingsStartTwitchLinkDocument,
  '\n  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {\n    twitchCompleteLink(code: $code, state: $state) {\n      id\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n':
    types.ConnectionSettingsCompleteTwitchLinkDocument,
  '\n  mutation ConnectionSettingsUnlinkTwitch {\n    twitchUnlink\n  }\n':
    types.ConnectionSettingsUnlinkTwitchDocument,
  '\n  query LiveUserIds {\n    liveStreamUserIds\n  }\n': types.LiveUserIdsDocument,
  '\n  fragment LiveStreams_FeedFragment on Query {\n    liveStreams {\n      twitchLogin\n      viewerCount\n      ...LiveStreams_FeedEntryFragment\n    }\n  }\n':
    types.LiveStreams_FeedFragmentFragmentDoc,
  '\n  fragment LiveStreams_FeedEntryFragment on LiveStream {\n    id\n    twitchLogin\n    twitchDisplayName\n    title\n    viewerCount\n    startedAt\n    thumbnailUrl\n    user {\n      id\n      name\n    }\n  }\n':
    types.LiveStreams_FeedEntryFragmentFragmentDoc,
  '\n  mutation BlockStream($userId: SbUserId!) {\n    blockStream(userId: $userId)\n  }\n':
    types.BlockStreamDocument,
  '\n  mutation UnblockStream($userId: SbUserId!) {\n    unblockStream(userId: $userId)\n  }\n':
    types.UnblockStreamDocument,
  '\n  query LiveStreamsPage {\n    ...LiveStreams_FeedFragment\n  }\n':
    types.LiveStreamsPageDocument,
  '\n  query UserNameAuditHistory(\n    $userId: SbUserId!\n    $displayNameLimit: Int\n    $displayNameOffset: Int\n    $loginNameLimit: Int\n    $loginNameOffset: Int\n  ) {\n    userDisplayNameAuditHistory(\n      userId: $userId\n      limit: $displayNameLimit\n      offset: $displayNameOffset\n    ) {\n      id\n      oldName\n      newName\n      changedAt\n      changedByUser {\n        id\n      }\n      changeReason\n      ipAddress\n      userAgent\n      usedToken\n    }\n    userLoginNameAuditHistory(userId: $userId, limit: $loginNameLimit, offset: $loginNameOffset) {\n      id\n      oldLoginName\n      newLoginName\n      changedAt\n      changeReason\n      ipAddress\n      userAgent\n    }\n  }\n':
    types.UserNameAuditHistoryDocument,
  '\n  mutation AdminChangeUserDisplayName(\n    $userId: SbUserId!\n    $newName: String!\n    $grantToken: Boolean!\n    $reason: String\n  ) {\n    userAdminChangeDisplayName(\n      userId: $userId\n      newName: $newName\n      grantToken: $grantToken\n      reason: $reason\n    ) {\n      id\n      name\n    }\n  }\n':
    types.AdminChangeUserDisplayNameDocument,
  '\n  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {\n    user(id: $userId) {\n      id\n      ...AdminUserProfile_Permissions @include(if: $includePermissions)\n    }\n  }\n':
    types.AdminUserProfileDocument,
  '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      useDevelopmentClient\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmaking\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageGameReports\n      manageRestrictedNames\n      manageSignupCodes\n      manageLiveStreams\n    }\n  }\n':
    types.AdminUserProfile_PermissionsFragmentDoc,
  '\n  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {\n    userUpdatePermissions(userId: $userId, permissions: $permissions) {\n      ...AdminUserProfile_Permissions\n    }\n  }\n':
    types.AdminUpdateUserPermissionsDocument,
  '\n  query UserProfileOwnedMaps($owner: SbUserId!, $after: String, $first: Int) {\n    maps(filter: { owner: $owner }, sort: NEWEST, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          id\n          ...MapTile_SbMapFragment\n        }\n      }\n    }\n  }\n':
    types.UserProfileOwnedMapsDocument,
  '\n  query UserProfileOwnsMaps($owner: SbUserId!) {\n    maps(filter: { owner: $owner }, first: 1) {\n      edges {\n        cursor\n      }\n    }\n  }\n':
    types.UserProfileOwnsMapsDocument,
  '\n  query UserProfileOverlayLive($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      commendCount\n      liveStream {\n        id\n        twitchLogin\n        title\n        viewerCount\n      }\n    }\n  }\n':
    types.UserProfileOverlayLiveDocument,
  '\n  query UserRankedModes($userId: SbUserId!) {\n    userRankedModes(userId: $userId) {\n      matchmakingType\n      totalGames\n      wins\n      losses\n      rating\n      delta\n    }\n  }\n':
    types.UserRankedModesDocument,
  '\n  query UserRatingHistory($userId: SbUserId!, $matchmakingType: MatchmakingType!) {\n    userRatingHistory(userId: $userId, matchmakingType: $matchmakingType) {\n      matchmakingType\n      totalGames\n      downsampled\n      points {\n        changeDate\n        rating\n        points\n        seasonId\n      }\n    }\n  }\n':
    types.UserRatingHistoryDocument,
  '\n  query UserProfileHeader($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      commendCount\n      twitchChannel {\n        id\n        twitchLogin\n        twitchDisplayName\n      }\n      liveStream {\n        id\n        twitchLogin\n        title\n        gameName\n        viewerCount\n        startedAt\n        thumbnailUrl\n      }\n    }\n  }\n':
    types.UserProfileHeaderDocument,
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
  source: '\n  query AdminNewsList($first: Int, $after: String) {\n    newsPosts(includeUnpublished: true, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          title\n          summary\n          publishedAt\n          updatedAt\n          author {\n            id\n            name\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminNewsList($first: Int, $after: String) {\n    newsPosts(includeUnpublished: true, first: $first, after: $after) {\n      edges {\n        node {\n          id\n          title\n          summary\n          publishedAt\n          updatedAt\n          author {\n            id\n            name\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminNewsPost($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      summary\n      content\n      translations {\n        language\n        title\n        summary\n        content\n      }\n      publishedAt\n      coverImagePath\n      coverImageUrl\n      author {\n        id\n        name\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminNewsPost($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      summary\n      content\n      translations {\n        language\n        title\n        summary\n        content\n      }\n      publishedAt\n      coverImagePath\n      coverImageUrl\n      author {\n        id\n        name\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminNewsHistory($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      edits {\n        title\n        summary\n        content\n        translations {\n          language\n          title\n          summary\n          content\n        }\n        publishedAt\n        coverImagePath\n        editedAt\n        editor {\n          id\n          name\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminNewsHistory($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      edits {\n        title\n        summary\n        content\n        translations {\n          language\n          title\n          summary\n          content\n        }\n        publishedAt\n        coverImagePath\n        editedAt\n        editor {\n          id\n          name\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation NewsCreatePost($post: NewsPostCreation!) {\n    newsCreatePost(post: $post) {\n      id\n    }\n  }\n',
): (typeof documents)['\n  mutation NewsCreatePost($post: NewsPostCreation!) {\n    newsCreatePost(post: $post) {\n      id\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminBlockedStreams {\n    blockedStreams {\n      id\n      createdAt\n      twitchLogin\n      twitchDisplayName\n      user {\n        id\n        name\n      }\n      blockedBy {\n        id\n        name\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminBlockedStreams {\n    blockedStreams {\n      id\n      createdAt\n      twitchLogin\n      twitchDisplayName\n      user {\n        id\n        name\n      }\n      blockedBy {\n        id\n        name\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AdminUnblockStream($userId: SbUserId!) {\n    unblockStream(userId: $userId)\n  }\n',
): (typeof documents)['\n  mutation AdminUnblockStream($userId: SbUserId!) {\n    unblockStream(userId: $userId)\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminMatchmakingConfig {\n    matchmakingConfig {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        winProbScale\n        maxRatingSpread\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n        weightRematch\n        rematchHalfLifeSeconds\n        rematchDensityRadius\n        rematchDensityReference\n        rematchDensityFloor\n      }\n      perMode {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          winProbScale\n          maxRatingSpread\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n          weightRematch\n          rematchHalfLifeSeconds\n          rematchDensityRadius\n          rematchDensityReference\n          rematchDensityFloor\n        }\n      }\n      defaults {\n        searchIntervalSeconds\n        maxPlayersExamined\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        winProbScale\n        maxRatingSpread\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n        weightRematch\n        rematchHalfLifeSeconds\n        rematchDensityRadius\n        rematchDensityReference\n        rematchDensityFloor\n      }\n      modeDefaults {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          winProbScale\n          maxRatingSpread\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n          weightRematch\n          rematchHalfLifeSeconds\n          rematchDensityRadius\n          rematchDensityReference\n          rematchDensityFloor\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminMatchmakingConfig {\n    matchmakingConfig {\n      searchIntervalSeconds\n      maxPlayersExamined\n      global {\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        winProbScale\n        maxRatingSpread\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n        weightRematch\n        rematchHalfLifeSeconds\n        rematchDensityRadius\n        rematchDensityReference\n        rematchDensityFloor\n      }\n      perMode {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          winProbScale\n          maxRatingSpread\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n          weightRematch\n          rematchHalfLifeSeconds\n          rematchDensityRadius\n          rematchDensityReference\n          rematchDensityFloor\n        }\n      }\n      defaults {\n        searchIntervalSeconds\n        maxPlayersExamined\n        weightRatingVariance\n        weightWinProb\n        weightLatency\n        uncertaintyK\n        winProbScale\n        maxRatingSpread\n        minQuality\n        adaptiveComfortableMultiplier\n        adaptiveDecayPerMissing\n        populationHalfLifeSeconds\n        weightRematch\n        rematchHalfLifeSeconds\n        rematchDensityRadius\n        rematchDensityReference\n        rematchDensityFloor\n      }\n      modeDefaults {\n        matchmakingType\n        config {\n          weightRatingVariance\n          weightWinProb\n          weightLatency\n          uncertaintyK\n          winProbScale\n          maxRatingSpread\n          minQuality\n          adaptiveComfortableMultiplier\n          adaptiveDecayPerMissing\n          populationHalfLifeSeconds\n          weightRematch\n          rematchHalfLifeSeconds\n          rematchDensityRadius\n          rematchDensityReference\n          rematchDensityFloor\n        }\n      }\n    }\n  }\n']
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
  source: '\n  query CurrentUrgentMessage {\n    urgentMessage {\n      id\n      title\n      message\n      translations {\n        language\n        title\n        message\n      }\n    }\n  }\n',
): (typeof documents)['\n  query CurrentUrgentMessage {\n    urgentMessage {\n      id\n      title\n      message\n      translations {\n        language\n        title\n        message\n      }\n    }\n  }\n']
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
  source: '\n  query ChannelActivity {\n    liveStreams {\n      id\n      twitchLogin\n      viewerCount\n      user {\n        id\n        name\n      }\n      ...LiveStreams_FeedEntryFragment\n    }\n    liveGames {\n      id\n      startTime\n      map {\n        id\n        name\n        mapFile {\n          id\n          image256Url\n          image512Url\n          image1024Url\n          image2048Url\n          width\n          height\n        }\n      }\n      config {\n        __typename\n        ... on GameConfigDataMatchmaking {\n          gameSourceExtra {\n            matchmakingType\n          }\n          teams {\n            race\n            user {\n              id\n              name\n            }\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query ChannelActivity {\n    liveStreams {\n      id\n      twitchLogin\n      viewerCount\n      user {\n        id\n        name\n      }\n      ...LiveStreams_FeedEntryFragment\n    }\n    liveGames {\n      id\n      startTime\n      map {\n        id\n        name\n        mapFile {\n          id\n          image256Url\n          image512Url\n          image1024Url\n          image2048Url\n          width\n          height\n        }\n      }\n      config {\n        __typename\n        ... on GameConfigDataMatchmaking {\n          gameSourceExtra {\n            matchmakingType\n          }\n          teams {\n            race\n            user {\n              id\n              name\n            }\n          }\n        }\n      }\n    }\n  }\n']
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
  source: '\n  query AdminGameReport($id: UUID!) {\n    gameReport(id: $id) {\n      id\n      reason\n      details\n      gameTimeSeconds\n      createdAt\n      resolvedAt\n      resolution\n      resolutionNotes\n      reporter {\n        id\n        name\n      }\n      reportedUser {\n        id\n        name\n      }\n      resolver {\n        id\n      }\n      game {\n        id\n        config {\n          __typename\n          ... on GameConfigDataLobby {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n          ... on GameConfigDataMatchmaking {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n        }\n      }\n      replay {\n        replayFileId\n        hash\n        url\n      }\n      reporterStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      reportedUserStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      siblingReports {\n        id\n        reason\n        details\n        gameTimeSeconds\n        createdAt\n        resolvedAt\n        resolution\n        reporter {\n          id\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminGameReport($id: UUID!) {\n    gameReport(id: $id) {\n      id\n      reason\n      details\n      gameTimeSeconds\n      createdAt\n      resolvedAt\n      resolution\n      resolutionNotes\n      reporter {\n        id\n        name\n      }\n      reportedUser {\n        id\n        name\n      }\n      resolver {\n        id\n      }\n      game {\n        id\n        config {\n          __typename\n          ... on GameConfigDataLobby {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n          ... on GameConfigDataMatchmaking {\n            teams {\n              isComputer\n              user {\n                id\n                name\n              }\n            }\n          }\n        }\n      }\n      replay {\n        replayFileId\n        hash\n        url\n      }\n      reporterStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      reportedUserStats {\n        total\n        actioned\n        dismissed\n        abusive\n        duplicate\n        pending\n      }\n      siblingReports {\n        id\n        reason\n        details\n        gameTimeSeconds\n        createdAt\n        resolvedAt\n        resolution\n        reporter {\n          id\n        }\n      }\n    }\n  }\n']
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
  source: '\n  query GameFeedback($gameId: UUID!) {\n    gameFeedback(gameId: $gameId) {\n      id\n      closesAt\n      given {\n        userId\n        kind\n      }\n      commendsRemaining\n      commendsAvailableAt\n      recentCommends {\n        userId\n        availableAt\n      }\n    }\n  }\n',
): (typeof documents)['\n  query GameFeedback($gameId: UUID!) {\n    gameFeedback(gameId: $gameId) {\n      id\n      closesAt\n      given {\n        userId\n        kind\n      }\n      commendsRemaining\n      commendsAvailableAt\n      recentCommends {\n        userId\n        availableAt\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CommendPlayer($gameId: UUID!, $userId: SbUserId!) {\n    commendPlayer(gameId: $gameId, userId: $userId) {\n      feedback {\n        id\n        closesAt\n        given {\n          userId\n          kind\n        }\n        commendsRemaining\n        commendsAvailableAt\n        recentCommends {\n          userId\n          availableAt\n        }\n      }\n      commendedUser {\n        id\n        commendCount\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation CommendPlayer($gameId: UUID!, $userId: SbUserId!) {\n    commendPlayer(gameId: $gameId, userId: $userId) {\n      feedback {\n        id\n        closesAt\n        given {\n          userId\n          kind\n        }\n        commendsRemaining\n        commendsAvailableAt\n        recentCommends {\n          userId\n          availableAt\n        }\n      }\n      commendedUser {\n        id\n        commendCount\n      }\n    }\n  }\n']
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
  source: '\n  fragment LiveGames_FeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_FeedEntryPlayersFragment\n        }\n      }\n    }\n\n    currentRanks {\n      id\n      userId\n      matchmakingType\n      seasonId\n      points\n      lifetimeGames\n    }\n\n    ...LiveGames_FeedEntryMapAndTypeFragment\n  }\n',
): (typeof documents)['\n  fragment LiveGames_FeedEntryFragment on Game {\n    id\n    startTime\n    map {\n      id\n      name\n      mapFile {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        width\n        height\n      }\n    }\n    config {\n      __typename\n\n      ... on GameConfigDataMatchmaking {\n        gameSourceExtra {\n          matchmakingType\n        }\n        teams {\n          user {\n            id\n          }\n          ...LiveGames_FeedEntryPlayersFragment\n        }\n      }\n    }\n\n    currentRanks {\n      id\n      userId\n      matchmakingType\n      seasonId\n      points\n      lifetimeGames\n    }\n\n    ...LiveGames_FeedEntryMapAndTypeFragment\n  }\n']
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
  source: '\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...Leagues_HomeFeedFragment\n    ...News_HomeFeedFragment\n  }\n',
): (typeof documents)['\n  query HomePageContent {\n    urgentMessage {\n      ...UrgentMessage_HomeDisplayFragment\n    }\n\n    ...Leagues_HomeFeedFragment\n    ...News_HomeFeedFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query HomePageLiveContent {\n    ...LiveGames_FeedFragment\n    ...LiveStreams_FeedFragment\n  }\n',
): (typeof documents)['\n  query HomePageLiveContent {\n    ...LiveGames_FeedFragment\n    ...LiveStreams_FeedFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n    translations {\n      language\n      title\n      message\n    }\n  }\n',
): (typeof documents)['\n  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {\n    id\n    title\n    message\n    translations {\n      language\n      title\n      message\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment Leagues_LeagueBadgeFragment on League {\n    name\n    translations {\n      language\n      name\n    }\n    badgeUrl\n  }\n',
): (typeof documents)['\n  fragment Leagues_LeagueBadgeFragment on League {\n    name\n    translations {\n      language\n      name\n    }\n    badgeUrl\n  }\n']
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
  source: '\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    translations {\n      language\n      name\n    }\n    matchmakingType\n    startAt\n    endAt\n    ...Leagues_LeagueBadgeFragment\n  }\n',
): (typeof documents)['\n  fragment Leagues_HomeFeedEntryFragment on League {\n    id\n    name\n    translations {\n      language\n      name\n    }\n    matchmakingType\n    startAt\n    endAt\n    ...Leagues_LeagueBadgeFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminMapFamilyReports($status: MapFamilyReportStatus!, $limit: Int!, $offset: Int!) {\n    mapFamilyReports(status: $status, limit: $limit, offset: $offset) {\n      id\n      kind\n      note\n      fromPublish\n      publishAnswer\n      reportedAt\n      status\n      resolvedAt\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n      }\n      map {\n        id\n        name\n      }\n      otherFamily {\n        id\n        name\n        current {\n          id\n        }\n      }\n      reportedBy {\n        id\n      }\n      resolvedBy {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminMapFamilyReports($status: MapFamilyReportStatus!, $limit: Int!, $offset: Int!) {\n    mapFamilyReports(status: $status, limit: $limit, offset: $offset) {\n      id\n      kind\n      note\n      fromPublish\n      publishAnswer\n      reportedAt\n      status\n      resolvedAt\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n      }\n      map {\n        id\n        name\n      }\n      otherFamily {\n        id\n        name\n        current {\n          id\n        }\n      }\n      reportedBy {\n        id\n      }\n      resolvedBy {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminMapFamilyReportCounts {\n    open: mapFamilyReportCount(status: OPEN)\n    resolved: mapFamilyReportCount(status: RESOLVED)\n    dismissed: mapFamilyReportCount(status: DISMISSED)\n    openClaims: mapOwnerClaimCount(status: OPEN)\n    openCollectionReports: mapCollectionReportCount\n  }\n',
): (typeof documents)['\n  query AdminMapFamilyReportCounts {\n    open: mapFamilyReportCount(status: OPEN)\n    resolved: mapFamilyReportCount(status: RESOLVED)\n    dismissed: mapFamilyReportCount(status: DISMISSED)\n    openClaims: mapOwnerClaimCount(status: OPEN)\n    openCollectionReports: mapCollectionReportCount\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminMapOwnerClaims($limit: Int!, $offset: Int!) {\n    mapOwnerClaims(status: OPEN, limit: $limit, offset: $offset) {\n      id\n      note\n      status\n      createdAt\n      claimant {\n        id\n      }\n      family {\n        id\n        name\n        owner {\n          id\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminMapOwnerClaims($limit: Int!, $offset: Int!) {\n    mapOwnerClaims(status: OPEN, limit: $limit, offset: $offset) {\n      id\n      note\n      status\n      createdAt\n      claimant {\n        id\n      }\n      family {\n        id\n        name\n        owner {\n          id\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AdminMapOwnerClaimGrant($claimId: UUID!) {\n    mapOwnerClaimGrant(claimId: $claimId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n      family {\n        id\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation AdminMapOwnerClaimGrant($claimId: UUID!) {\n    mapOwnerClaimGrant(claimId: $claimId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n      family {\n        id\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AdminMapOwnerClaimReject($claimId: UUID!) {\n    mapOwnerClaimReject(claimId: $claimId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation AdminMapOwnerClaimReject($claimId: UUID!) {\n    mapOwnerClaimReject(claimId: $claimId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AdminMapCollectionReports($after: String, $first: Int!) {\n    mapCollectionReports(open: true, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        node {\n          id\n          note\n          createdAt\n          reporter {\n            id\n          }\n          collection {\n            id\n            title\n            owner {\n              id\n            }\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query AdminMapCollectionReports($after: String, $first: Int!) {\n    mapCollectionReports(open: true, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        node {\n          id\n          note\n          createdAt\n          reporter {\n            id\n          }\n          collection {\n            id\n            title\n            owner {\n              id\n            }\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapSearchTest_Map on SbMap {\n    id\n    name\n    kind\n    playerCount\n    listed\n    staffPick\n    publishedAt\n    favoriteCount\n    isFavorited\n    inLibrary\n    publisher {\n      id\n      name\n    }\n    stats {\n      id\n      games7d\n      games28d\n      games90d\n      gamesTotal\n      players90d\n      medianLength90d\n      lastPlayedAt\n    }\n    file {\n      id\n      tileset\n      width\n      height\n      isEud\n      image256Url\n    }\n  }\n',
): (typeof documents)['\n  fragment MapSearchTest_Map on SbMap {\n    id\n    name\n    kind\n    playerCount\n    listed\n    staffPick\n    publishedAt\n    favoriteCount\n    isFavorited\n    inLibrary\n    publisher {\n      id\n      name\n    }\n    stats {\n      id\n      games7d\n      games28d\n      games90d\n      gamesTotal\n      players90d\n      medianLength90d\n      lastPlayedAt\n    }\n    file {\n      id\n      tileset\n      width\n      height\n      isEud\n      image256Url\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapSearchTestMaps($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    maps(filter: $filter, sort: $sort, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          ...MapSearchTest_Map\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapSearchTestMaps($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    maps(filter: $filter, sort: $sort, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          ...MapSearchTest_Map\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapSearchTestLibrary($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    currentUser {\n      id\n      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            ...MapSearchTest_Map\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapSearchTestLibrary($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    currentUser {\n      id\n      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            ...MapSearchTest_Map\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapSearchTestFavorites($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    currentUser {\n      id\n      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            ...MapSearchTest_Map\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapSearchTestFavorites($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {\n    currentUser {\n      id\n      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            ...MapSearchTest_Map\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapSearchTestMap($id: SbMapId!) {\n    map(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n',
): (typeof documents)['\n  query MapSearchTestMap($id: SbMapId!) {\n    map(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapSearchTestAddFavorite($id: SbMapId!) {\n    mapAddFavorite(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n',
): (typeof documents)['\n  mutation MapSearchTestAddFavorite($id: SbMapId!) {\n    mapAddFavorite(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapSearchTestRemoveFavorite($id: SbMapId!) {\n    mapRemoveFavorite(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n',
): (typeof documents)['\n  mutation MapSearchTestRemoveFavorite($id: SbMapId!) {\n    mapRemoveFavorite(id: $id) {\n      ...MapSearchTest_Map\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapSpawnsTestMaps {\n    maps(first: 100) {\n      edges {\n        node {\n          id\n          name\n          file {\n            id\n            image256Url\n            image512Url\n            image1024Url\n            image2048Url\n            imageSpawnsBaked\n            width\n            height\n            startLocations {\n              id\n              slot\n              x\n              y\n            }\n            umsContent\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapSpawnsTestMaps {\n    maps(first: 100) {\n      edges {\n        node {\n          id\n          name\n          file {\n            id\n            image256Url\n            image512Url\n            image1024Url\n            image2048Url\n            imageSpawnsBaked\n            width\n            height\n            startLocations {\n              id\n              slot\n              x\n              y\n            }\n            umsContent\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapSpawnsTestMap($id: SbMapId!) {\n    map(id: $id) {\n      id\n      name\n      file {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        imageSpawnsBaked\n        width\n        height\n        startLocations {\n          id\n          slot\n          x\n          y\n        }\n        umsContent\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapSpawnsTestMap($id: SbMapId!) {\n    map(id: $id) {\n      id\n      name\n      file {\n        id\n        image256Url\n        image512Url\n        image1024Url\n        image2048Url\n        imageSpawnsBaked\n        width\n        height\n        startLocations {\n          id\n          slot\n          x\n          y\n        }\n        umsContent\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query LocalKnownMap($hashes: [String!]!) {\n    mapsByHash(hashes: $hashes) {\n      id\n      name\n    }\n  }\n',
): (typeof documents)['\n  query LocalKnownMap($hashes: [String!]!) {\n    mapsByHash(hashes: $hashes) {\n      id\n      name\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCatalogAll(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    maps(filter: $filter, sort: $sort, after: $after, first: $first) {\n      totalCount @include(if: $withCount)\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          id\n          family {\n            id\n          }\n          ...MapTile_SbMapFragment\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCatalogAll(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    maps(filter: $filter, sort: $sort, after: $after, first: $first) {\n      totalCount @include(if: $withCount)\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          id\n          family {\n            id\n          }\n          ...MapTile_SbMapFragment\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCatalogLibrary(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    currentUser {\n      id\n      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            id\n            family {\n              id\n            }\n            ...MapTile_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCatalogLibrary(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    currentUser {\n      id\n      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          addedAt\n          node {\n            id\n            family {\n              id\n            }\n            ...MapTile_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCatalogFavorites(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    currentUser {\n      id\n      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            family {\n              id\n            }\n            ...MapTile_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCatalogFavorites(\n    $filter: MapFilter\n    $sort: MapSort\n    $after: String\n    $first: Int\n    $withCount: Boolean!\n  ) {\n    currentUser {\n      id\n      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            family {\n              id\n            }\n            ...MapTile_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionUpdate($id: UUID!, $title: String, $description: String, $public: Boolean) {\n    mapCollectionUpdate(id: $id, title: $title, description: $description, public: $public) {\n      id\n      title\n      description\n      public\n      updatedAt\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionUpdate($id: UUID!, $title: String, $description: String, $public: Boolean) {\n    mapCollectionUpdate(id: $id, title: $title, description: $description, public: $public) {\n      id\n      title\n      description\n      public\n      updatedAt\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionAddMap($collectionId: UUID!, $mapId: SbMapId!) {\n    mapCollectionAddMap(collectionId: $collectionId, mapId: $mapId) {\n      id\n      mapCount\n      updatedAt\n      ...MapCollectionMosaic_CollectionFragment\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionAddMap($collectionId: UUID!, $mapId: SbMapId!) {\n    mapCollectionAddMap(collectionId: $collectionId, mapId: $mapId) {\n      id\n      mapCount\n      updatedAt\n      ...MapCollectionMosaic_CollectionFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionSave($id: UUID!) {\n    mapCollectionSave(id: $id) {\n      id\n      isSaved\n      saveCount\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionSave($id: UUID!) {\n    mapCollectionSave(id: $id) {\n      id\n      isSaved\n      saveCount\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionUnsave($id: UUID!) {\n    mapCollectionUnsave(id: $id) {\n      id\n      isSaved\n      saveCount\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionUnsave($id: UUID!) {\n    mapCollectionUnsave(id: $id) {\n      id\n      isSaved\n      saveCount\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionUnhide($id: UUID!) {\n    mapCollectionUnhide(id: $id) {\n      id\n      public\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionUnhide($id: UUID!) {\n    mapCollectionUnhide(id: $id) {\n      id\n      public\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapCollectionMosaic_CollectionFragment on MapCollection {\n    id\n    cover {\n      id\n      name\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment MapCollectionMosaic_CollectionFragment on MapCollection {\n    id\n    cover {\n      id\n      name\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapCollectionCard_CollectionFragment on MapCollection {\n    id\n    kind\n    title\n    public\n    mapCount\n    owner {\n      id\n      name\n    }\n    hidden {\n      id\n    }\n    pool {\n      id\n      matchmakingType\n      startDate\n      endDate\n    }\n    ...MapCollectionMosaic_CollectionFragment\n  }\n',
): (typeof documents)['\n  fragment MapCollectionCard_CollectionFragment on MapCollection {\n    id\n    kind\n    title\n    public\n    mapCount\n    owner {\n      id\n      name\n    }\n    hidden {\n      id\n    }\n    pool {\n      id\n      matchmakingType\n      startDate\n      endDate\n    }\n    ...MapCollectionMosaic_CollectionFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionCreate($title: String!, $staff: Boolean!) {\n    mapCollectionCreate(title: $title, staff: $staff) {\n      id\n      kind\n      title\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionCreate($title: String!, $staff: Boolean!) {\n    mapCollectionCreate(title: $title, staff: $staff) {\n      id\n      kind\n      title\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionDelete($id: UUID!) {\n    mapCollectionDelete(id: $id)\n  }\n',
): (typeof documents)['\n  mutation MapCollectionDelete($id: UUID!) {\n    mapCollectionDelete(id: $id)\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionReport($id: UUID!, $note: String!) {\n    mapCollectionReport(id: $id, note: $note) {\n      id\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionReport($id: UUID!, $note: String!) {\n    mapCollectionReport(id: $id, note: $note) {\n      id\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionHide($id: UUID!, $note: String!) {\n    mapCollectionHide(id: $id, note: $note) {\n      id\n      public\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionHide($id: UUID!, $note: String!) {\n    mapCollectionHide(id: $id, note: $note) {\n      id\n      public\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCollectionPage($id: UUID!) {\n    mapCollection(id: $id) {\n      id\n      kind\n      title\n      description\n      public\n      grantsStaffPick\n      canEdit\n      isSaved\n      mapCount\n      owner {\n        id\n        name\n      }\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n      pool {\n        id\n        matchmakingType\n        startDate\n        endDate\n        isCurrent\n        maxVetoCount\n        previous {\n          id\n        }\n        next {\n          id\n        }\n      }\n      ...MapCollectionMosaic_CollectionFragment\n    }\n  }\n',
): (typeof documents)['\n  query MapCollectionPage($id: UUID!) {\n    mapCollection(id: $id) {\n      id\n      kind\n      title\n      description\n      public\n      grantsStaffPick\n      canEdit\n      isSaved\n      mapCount\n      owner {\n        id\n        name\n      }\n      hidden {\n        id\n        note\n        hiddenAt\n      }\n      pool {\n        id\n        matchmakingType\n        startDate\n        endDate\n        isCurrent\n        maxVetoCount\n        previous {\n          id\n        }\n        next {\n          id\n        }\n      }\n      ...MapCollectionMosaic_CollectionFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapCollectionRow_SbMapFragment on SbMap {\n    id\n    family {\n      id\n      listed\n    }\n    ...MapTile_SbMapFragment\n  }\n',
): (typeof documents)['\n  fragment MapCollectionRow_SbMapFragment on SbMap {\n    id\n    family {\n      id\n      listed\n    }\n    ...MapTile_SbMapFragment\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCollectionPageMaps($id: UUID!, $after: String, $first: Int!, $withCount: Boolean!) {\n    mapCollection(id: $id) {\n      id\n      maps(after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            ...MapCollectionRow_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCollectionPageMaps($id: UUID!, $after: String, $first: Int!, $withCount: Boolean!) {\n    mapCollection(id: $id) {\n      id\n      maps(after: $after, first: $first) {\n        totalCount @include(if: $withCount)\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            ...MapCollectionRow_SbMapFragment\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCollectionEntries($id: UUID!, $after: String, $first: Int!) {\n    mapCollection(id: $id) {\n      id\n      maps(after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          node {\n            id\n            family {\n              id\n              listed\n            }\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCollectionEntries($id: UUID!, $after: String, $first: Int!) {\n    mapCollection(id: $id) {\n      id\n      maps(after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          node {\n            id\n            family {\n              id\n              listed\n            }\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCollectionReportBar($open: Boolean!, $first: Int!) {\n    mapCollectionReports(open: $open, first: $first) {\n      edges {\n        node {\n          id\n          note\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          resolvedBy {\n            id\n          }\n          collection {\n            id\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCollectionReportBar($open: Boolean!, $first: Int!) {\n    mapCollectionReports(open: $open, first: $first) {\n      edges {\n        node {\n          id\n          note\n          createdAt\n          resolvedAt\n          resolution\n          reporter {\n            id\n          }\n          resolvedBy {\n            id\n          }\n          collection {\n            id\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapCollectionReportDismiss($reportId: UUID!) {\n    mapCollectionReportDismiss(reportId: $reportId) {\n      id\n      resolvedAt\n      resolution\n      resolvedBy {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapCollectionReportDismiss($reportId: UUID!) {\n    mapCollectionReportDismiss(reportId: $reportId) {\n      id\n      resolvedAt\n      resolution\n      resolvedBy {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCollectionsTab($search: String, $loggedIn: Boolean!, $first: Int!) {\n    currentUser @include(if: $loggedIn) {\n      id\n      mapCollections {\n        id\n        kind\n        title\n        ...MapCollectionCard_CollectionFragment\n      }\n    }\n    ladder: mapCollections(section: LADDER, search: $search, first: $first) {\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n    staff: mapCollections(section: STAFF, search: $search, first: $first) {\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCollectionsTab($search: String, $loggedIn: Boolean!, $first: Int!) {\n    currentUser @include(if: $loggedIn) {\n      id\n      mapCollections {\n        id\n        kind\n        title\n        ...MapCollectionCard_CollectionFragment\n      }\n    }\n    ladder: mapCollections(section: LADDER, search: $search, first: $first) {\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n    staff: mapCollections(section: STAFF, search: $search, first: $first) {\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCollectionsPlayers($search: String, $after: String, $first: Int!, $withCount: Boolean!) {\n    mapCollections(section: PLAYERS, search: $search, after: $after, first: $first) {\n      totalCount @include(if: $withCount)\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCollectionsPlayers($search: String, $after: String, $first: Int!, $withCount: Boolean!) {\n    mapCollections(section: PLAYERS, search: $search, after: $after, first: $first) {\n      totalCount @include(if: $withCount)\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        node {\n          id\n          ...MapCollectionCard_CollectionFragment\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapCompare($a: SbMapId!, $b: SbMapId!) {\n    mapComparison(a: $a, b: $b) {\n      id\n      changes\n      terrainSimilarity\n      terrainChanges\n      startLocations {\n        id\n        slot\n        kind\n      }\n      bases {\n        id\n        beforeIndex\n        afterIndex\n        changed\n      }\n      a {\n        id\n        ...MapCompare_Side\n      }\n      b {\n        id\n        ...MapCompare_Side\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapCompare($a: SbMapId!, $b: SbMapId!) {\n    mapComparison(a: $a, b: $b) {\n      id\n      changes\n      terrainSimilarity\n      terrainChanges\n      startLocations {\n        id\n        slot\n        kind\n      }\n      bases {\n        id\n        beforeIndex\n        afterIndex\n        changed\n      }\n      a {\n        id\n        ...MapCompare_Side\n      }\n      b {\n        id\n        ...MapCompare_Side\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapCompare_Side on SbMap {\n    id\n    name\n    playerCount\n    file {\n      id\n      tileset\n      width\n      height\n      isEud\n      image2048Url\n      imageSpawnsBaked\n      umsContent\n      startLocations {\n        id\n        slot\n        x\n        y\n      }\n      analysis {\n        id\n        triggerCount\n        umsActionKinds\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment MapCompare_Side on SbMap {\n    id\n    name\n    playerCount\n    file {\n      id\n      tileset\n      width\n      height\n      isEud\n      image2048Url\n      imageSpawnsBaked\n      umsContent\n      startLocations {\n        id\n        slot\n        x\n        y\n      }\n      analysis {\n        id\n        triggerCount\n        umsActionKinds\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapDefaultNudge($id: SbMapId!) {\n    map(id: $id) {\n      id\n      family {\n        id\n        current {\n          id\n          name\n          listed\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapDefaultNudge($id: SbMapId!) {\n    map(id: $id) {\n      id\n      family {\n        id\n        current {\n          id\n          name\n          listed\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapDelist($fileId: SbMapId!, $note: String) {\n    mapDelist(fileId: $fileId, note: $note) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n      moderation {\n        id\n        publishedAt\n        delistedAt\n        delistedKind\n        delistedNote\n        delistedBy {\n          id\n          name\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapDelist($fileId: SbMapId!, $note: String) {\n    mapDelist(fileId: $fileId, note: $note) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n      moderation {\n        id\n        publishedAt\n        delistedAt\n        delistedKind\n        delistedNote\n        delistedBy {\n          id\n          name\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapFamilyAction_FamilyFragment on MapFamily {\n    id\n    name\n    listed\n    current {\n      id\n    }\n    defaultMap {\n      id\n    }\n    files {\n      id\n      name\n      listed\n      firstSeenAt\n      favoriteCount\n      stats {\n        id\n        games28d\n        gamesTotal\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment MapFamilyAction_FamilyFragment on MapFamily {\n    id\n    name\n    listed\n    current {\n      id\n    }\n    defaultMap {\n      id\n    }\n    files {\n      id\n      name\n      listed\n      firstSeenAt\n      favoriteCount\n      stats {\n        id\n        games28d\n        gamesTotal\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapFamilyActionFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        ...MapFamilyAction_FamilyFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapFamilyActionFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        ...MapFamilyAction_FamilyFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapFamilyActionSimilar($fileId: SbMapId!) {\n    similarFiles(fileId: $fileId) {\n      id\n      similarity\n      map {\n        id\n        family {\n          id\n          name\n          ...MapFamilySearch_FamilyFragment\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapFamilyActionSimilar($fileId: SbMapId!) {\n    similarFiles(fileId: $fileId) {\n      id\n      similarity\n      map {\n        id\n        family {\n          id\n          name\n          ...MapFamilySearch_FamilyFragment\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilySplitFile($fileId: SbMapId!) {\n    mapFamilySplitFile(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilySplitFile($fileId: SbMapId!) {\n    mapFamilySplitFile(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilyMoveFile($fileId: SbMapId!, $familyId: UUID!) {\n    mapFamilyMoveFile(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilyMoveFile($fileId: SbMapId!, $familyId: UUID!) {\n    mapFamilyMoveFile(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilyMerge($familyId: UUID!, $intoFamilyId: UUID!) {\n    mapFamilyMerge(familyId: $familyId, intoFamilyId: $intoFamilyId) {\n      id\n      name\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilyMerge($familyId: UUID!, $intoFamilyId: UUID!) {\n    mapFamilyMerge(familyId: $familyId, intoFamilyId: $intoFamilyId) {\n      id\n      name\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapFamilyReportFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        current {\n          id\n        }\n        owner {\n          id\n          name\n        }\n        files {\n          id\n          name\n          listed\n          firstSeenAt\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapFamilyReportFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        current {\n          id\n        }\n        owner {\n          id\n          name\n        }\n        files {\n          id\n          name\n          listed\n          firstSeenAt\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilyReport($input: MapFamilyReportInput!) {\n    mapFamilyReport(input: $input) {\n      id\n      status\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilyReport($input: MapFamilyReportInput!) {\n    mapFamilyReport(input: $input) {\n      id\n      status\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapFamilySearch_FamilyFragment on MapFamily {\n    id\n    name\n    stats {\n      id\n      gamesTotal\n    }\n    files {\n      id\n    }\n    current {\n      id\n      listed\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment MapFamilySearch_FamilyFragment on MapFamily {\n    id\n    name\n    stats {\n      id\n      gamesTotal\n    }\n    files {\n      id\n    }\n    current {\n      id\n      listed\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapFamilySearch($search: String!) {\n    maps(filter: { search: $search }, first: 6) {\n      nodes {\n        id\n        family {\n          id\n          ...MapFamilySearch_FamilyFragment\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapFamilySearch($search: String!) {\n    maps(filter: { search: $search }, first: 6) {\n      nodes {\n        id\n        family {\n          id\n          ...MapFamilySearch_FamilyFragment\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapFamilySearchById($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        ...MapFamilySearch_FamilyFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapFamilySearchById($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        ...MapFamilySearch_FamilyFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapAddFavorite($id: SbMapId!) {\n    mapAddFavorite(id: $id) {\n      id\n      isFavorited\n      favoriteCount\n      family {\n        id\n        files {\n          id\n          isFavorited\n          favoriteCount\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapAddFavorite($id: SbMapId!) {\n    mapAddFavorite(id: $id) {\n      id\n      isFavorited\n      favoriteCount\n      family {\n        id\n        files {\n          id\n          isFavorited\n          favoriteCount\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapRemoveFavorite($id: SbMapId!) {\n    mapRemoveFavorite(id: $id) {\n      id\n      isFavorited\n      favoriteCount\n      family {\n        id\n        files {\n          id\n          isFavorited\n          favoriteCount\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapRemoveFavorite($id: SbMapId!) {\n    mapRemoveFavorite(id: $id) {\n      id\n      isFavorited\n      favoriteCount\n      family {\n        id\n        files {\n          id\n          isFavorited\n          favoriteCount\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapFileImage_FileFragment on MapFile {\n    id\n    image256Url\n    image512Url\n    image1024Url\n    image2048Url\n    imageSpawnsBaked\n    width\n    height\n    startLocations {\n      id\n      slot\n      x\n      y\n    }\n    umsContent\n  }\n',
): (typeof documents)['\n  fragment MapFileImage_FileFragment on MapFile {\n    id\n    image256Url\n    image512Url\n    image1024Url\n    image2048Url\n    imageSpawnsBaked\n    width\n    height\n    startLocations {\n      id\n      slot\n      x\n      y\n    }\n    umsContent\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation LocalAddToLibrary($id: SbMapId!) {\n    mapAddToLibrary(id: $id) {\n      id\n      inLibrary\n    }\n  }\n',
): (typeof documents)['\n  mutation LocalAddToLibrary($id: SbMapId!) {\n    mapAddToLibrary(id: $id) {\n      id\n      inLibrary\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilySetDefault($fileId: SbMapId!) {\n    mapFamilySetDefault(fileId: $fileId) {\n      id\n      name\n      current {\n        id\n        name\n      }\n      defaultMap {\n        id\n      }\n      defaultSetAt\n      defaultSetBy {\n        id\n        name\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilySetDefault($fileId: SbMapId!) {\n    mapFamilySetDefault(fileId: $fileId) {\n      id\n      name\n      current {\n        id\n        name\n      }\n      defaultMap {\n        id\n      }\n      defaultSetAt\n      defaultSetBy {\n        id\n        name\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapOwner_FamilyOwnerFragment on MapFamily {\n    id\n    owner {\n      id\n      name\n    }\n    ownerKind\n    ownerSetAt\n    credit\n  }\n',
): (typeof documents)['\n  fragment MapOwner_FamilyOwnerFragment on MapFamily {\n    id\n    owner {\n      id\n      name\n    }\n    ownerKind\n    ownerSetAt\n    credit\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapOwnerClaim($familyId: UUID!, $note: String) {\n    mapOwnerClaim(familyId: $familyId, note: $note) {\n      id\n      granted\n      claim {\n        id\n        status\n        note\n        createdAt\n      }\n      family {\n        id\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapOwnerClaim($familyId: UUID!, $note: String) {\n    mapOwnerClaim(familyId: $familyId, note: $note) {\n      id\n      granted\n      claim {\n        id\n        status\n        note\n        createdAt\n      }\n      family {\n        id\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapOwnerRelinquish($familyId: UUID!) {\n    mapOwnerRelinquish(familyId: $familyId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n',
): (typeof documents)['\n  mutation MapOwnerRelinquish($familyId: UUID!) {\n    mapOwnerRelinquish(familyId: $familyId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilyRemoveOwner($familyId: UUID!) {\n    mapFamilyRemoveOwner(familyId: $familyId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilyRemoveOwner($familyId: UUID!) {\n    mapFamilyRemoveOwner(familyId: $familyId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapOwnerEditFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        name\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapOwnerEditFamily($id: UUID!) {\n    mapFamily(id: $id) {\n      id\n      family {\n        id\n        name\n        ...MapOwner_FamilyOwnerFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilySetOwner($familyId: UUID!, $userId: SbUserId!) {\n    mapFamilySetOwner(familyId: $familyId, userId: $userId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilySetOwner($familyId: UUID!, $userId: SbUserId!) {\n    mapFamilySetOwner(familyId: $familyId, userId: $userId) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilySetCredit($familyId: UUID!, $credit: String) {\n    mapFamilySetCredit(familyId: $familyId, credit: $credit) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilySetCredit($familyId: UUID!, $credit: String) {\n    mapFamilySetCredit(familyId: $familyId, credit: $credit) {\n      id\n      ...MapOwner_FamilyOwnerFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapOwnerAddFileLibrary($after: String, $first: Int, $canManageMaps: Boolean!) {\n    currentUser {\n      id\n      mapLibrary(sort: NEWEST, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            name\n            listed\n            playerCount\n            publishedAt\n            publisher {\n              id\n            }\n            moderation @include(if: $canManageMaps) {\n              id\n              delistedKind\n            }\n            family {\n              id\n              name\n              listed\n              credit\n              owner {\n                id\n              }\n              files {\n                id\n              }\n            }\n            file {\n              id\n              width\n              height\n              ...MapFileImage_FileFragment\n            }\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapOwnerAddFileLibrary($after: String, $first: Int, $canManageMaps: Boolean!) {\n    currentUser {\n      id\n      mapLibrary(sort: NEWEST, after: $after, first: $first) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        edges {\n          cursor\n          node {\n            id\n            name\n            listed\n            playerCount\n            publishedAt\n            publisher {\n              id\n            }\n            moderation @include(if: $canManageMaps) {\n              id\n              delistedKind\n            }\n            family {\n              id\n              name\n              listed\n              credit\n              owner {\n                id\n              }\n              files {\n                id\n              }\n            }\n            file {\n              id\n              width\n              height\n              ...MapFileImage_FileFragment\n            }\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapOwnerAddFileUploaded($id: SbMapId!, $canManageMaps: Boolean!) {\n    map(id: $id) {\n      id\n      name\n      listed\n      playerCount\n      publishedAt\n      publisher {\n        id\n      }\n      moderation @include(if: $canManageMaps) {\n        id\n        delistedKind\n      }\n      family {\n        id\n        name\n        listed\n        credit\n        owner {\n          id\n        }\n        files {\n          id\n        }\n      }\n      file {\n        id\n        width\n        height\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapOwnerAddFileUploaded($id: SbMapId!, $canManageMaps: Boolean!) {\n    map(id: $id) {\n      id\n      name\n      listed\n      playerCount\n      publishedAt\n      publisher {\n        id\n      }\n      moderation @include(if: $canManageMaps) {\n        id\n        delistedKind\n      }\n      family {\n        id\n        name\n        listed\n        credit\n        owner {\n          id\n        }\n        files {\n          id\n        }\n      }\n      file {\n        id\n        width\n        height\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapOwnerAddFileLink($fileId: SbMapId!, $familyId: UUID!) {\n    mapFileLink(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapOwnerAddFileLink($fileId: SbMapId!, $familyId: UUID!) {\n    mapFileLink(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapOwnerAddFilePublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {\n    mapPublish(fileId: $fileId, answer: $answer) {\n      id\n      heldForReview\n      file {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapOwnerAddFilePublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {\n    mapPublish(fileId: $fileId, answer: $answer) {\n      id\n      heldForReview\n      file {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapLiveGames {\n    liveGames {\n      id\n      map {\n        id\n      }\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n',
): (typeof documents)['\n  query MapLiveGames {\n    liveGames {\n      id\n      map {\n        id\n      }\n      ...LiveGames_FeedEntryFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPageFiles_FileFragment on SbMap {\n    id\n    name\n    listed\n    firstSeenAt\n    stats {\n      id\n      games28d\n      gamesTotal\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPageFiles_FileFragment on SbMap {\n    id\n    name\n    listed\n    firstSeenAt\n    stats {\n      id\n      games28d\n      gamesTotal\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPageFiles_FamilyFragment on MapFamily {\n    id\n    name\n    listed\n    current {\n      id\n      name\n    }\n    defaultMap {\n      id\n    }\n    defaultSetBy @include(if: $canManageMaps) {\n      id\n      name\n    }\n    owner {\n      id\n    }\n    files {\n      id\n      ...MapPageFiles_FileFragment\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPageFiles_FamilyFragment on MapFamily {\n    id\n    name\n    listed\n    current {\n      id\n      name\n    }\n    defaultMap {\n      id\n    }\n    defaultSetBy @include(if: $canManageMaps) {\n      id\n      name\n    }\n    owner {\n      id\n    }\n    files {\n      id\n      ...MapPageFiles_FileFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapPageFilesUnlink($fileId: SbMapId!) {\n    mapFileUnlink(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapPageFilesUnlink($fileId: SbMapId!) {\n    mapFileUnlink(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPageStats_FamilyFragment on MapFamily {\n    id\n    stats {\n      id\n      gamesTotal\n      games28d\n      players90d\n      medianLength90d\n      lastPlayedAt\n    }\n    weeklyActivity(weeks: 26) {\n      id\n      weekStart\n      lobbyGames\n      matchmakingGames\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPageStats_FamilyFragment on MapFamily {\n    id\n    stats {\n      id\n      gamesTotal\n      games28d\n      players90d\n      medianLength90d\n      lastPlayedAt\n    }\n    weeklyActivity(weeks: 26) {\n      id\n      weekStart\n      lobbyGames\n      matchmakingGames\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPageMatchups_MapFragment on SbMap {\n    id\n    kind\n    matchupSeasons {\n      id\n      seasonId\n      matchmakingType\n      games\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPageMatchups_MapFragment on SbMap {\n    id\n    kind\n    matchupSeasons {\n      id\n      seasonId\n      matchmakingType\n      games\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapMatchups($id: SbMapId!, $matchmakingType: MatchmakingType!, $seasonId: Int) {\n    map(id: $id) {\n      id\n      matchups(matchmakingType: $matchmakingType, seasonId: $seasonId) {\n        id\n        matchup\n        games\n        leftWins\n        rightWins\n        medianLength\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapMatchups($id: SbMapId!, $matchmakingType: MatchmakingType!, $seasonId: Int) {\n    map(id: $id) {\n      id\n      matchups(matchmakingType: $matchmakingType, seasonId: $seasonId) {\n        id\n        matchup\n        games\n        leftWins\n        rightWins\n        medianLength\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapPageFamily($id: UUID!, $canManageMaps: Boolean!) {\n    mapFamily(id: $id) {\n      id\n      file {\n        id\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n        owner {\n          id\n          name\n        }\n        ownerKind\n        credit\n        ...MapPageStats_FamilyFragment\n        ...MapPageFiles_FamilyFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapPageFamily($id: UUID!, $canManageMaps: Boolean!) {\n    mapFamily(id: $id) {\n      id\n      file {\n        id\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n        owner {\n          id\n          name\n        }\n        ownerKind\n        credit\n        ...MapPageStats_FamilyFragment\n        ...MapPageFiles_FamilyFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapPageFile($id: SbMapId!, $canManageMaps: Boolean!) {\n    map(id: $id) {\n      id\n      name\n      kind\n      family {\n        id\n        name\n      }\n      stats {\n        id\n      }\n      file {\n        id\n        image256Url\n        ...MapFileImage_FileFragment\n      }\n      ...MapPage_HeaderFragment\n      ...MapPage_ActionsFragment\n      ...MapPage_FactsFragment\n      ...MapPage_HowToPlayFragment\n      ...MapPageMatchups_MapFragment\n      ...MapPageFiles_FileFragment\n    }\n  }\n',
): (typeof documents)['\n  query MapPageFile($id: SbMapId!, $canManageMaps: Boolean!) {\n    map(id: $id) {\n      id\n      name\n      kind\n      family {\n        id\n        name\n      }\n      stats {\n        id\n      }\n      file {\n        id\n        image256Url\n        ...MapFileImage_FileFragment\n      }\n      ...MapPage_HeaderFragment\n      ...MapPage_ActionsFragment\n      ...MapPage_FactsFragment\n      ...MapPage_HowToPlayFragment\n      ...MapPageMatchups_MapFragment\n      ...MapPageFiles_FileFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPage_FactsFragment on SbMap {\n    id\n    kind\n    playerCount\n    file {\n      id\n      width\n      height\n      tileset\n      isEud\n      umsForces {\n        name\n        teamId\n        players {\n          playerId\n          isComputer\n        }\n      }\n      analysis {\n        id\n        baseCount\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPage_FactsFragment on SbMap {\n    id\n    kind\n    playerCount\n    file {\n      id\n      width\n      height\n      tileset\n      isEud\n      umsForces {\n        name\n        teamId\n        players {\n          playerId\n          isComputer\n        }\n      }\n      analysis {\n        id\n        baseCount\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPage_HeaderFragment on SbMap {\n    id\n    name\n    description\n    kind\n    listed\n    staffPick\n    publishedAt\n    publisher {\n      id\n      name\n    }\n    file {\n      id\n      originalName\n      originalDescription\n    }\n    moderation @include(if: $canManageMaps) {\n      id\n      delistedAt\n      delistedKind\n      delistedNote\n      delistedBy {\n        id\n        name\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPage_HeaderFragment on SbMap {\n    id\n    name\n    description\n    kind\n    listed\n    staffPick\n    publishedAt\n    publisher {\n      id\n      name\n    }\n    file {\n      id\n      originalName\n      originalDescription\n    }\n    moderation @include(if: $canManageMaps) {\n      id\n      delistedAt\n      delistedKind\n      delistedNote\n      delistedBy {\n        id\n        name\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPage_ActionsFragment on SbMap {\n    id\n    name\n    listed\n    isFavorited\n    inLibrary\n    publisher {\n      id\n    }\n    moderation @include(if: $canManageMaps) {\n      id\n      publishedAt\n      delistedKind\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPage_ActionsFragment on SbMap {\n    id\n    name\n    listed\n    isFavorited\n    inLibrary\n    publisher {\n      id\n    }\n    moderation @include(if: $canManageMaps) {\n      id\n      publishedAt\n      delistedKind\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapPageRelist($fileId: SbMapId!) {\n    mapRelist(fileId: $fileId) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n      moderation {\n        id\n        publishedAt\n        delistedAt\n        delistedKind\n        delistedNote\n        delistedBy {\n          id\n          name\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapPageRelist($fileId: SbMapId!) {\n    mapRelist(fileId: $fileId) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n      moderation {\n        id\n        publishedAt\n        delistedAt\n        delistedKind\n        delistedNote\n        delistedBy {\n          id\n          name\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapPageFileUnlink($fileId: SbMapId!) {\n    mapFileUnlink(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapPageFileUnlink($fileId: SbMapId!) {\n    mapFileUnlink(fileId: $fileId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapPageClaimPreview($familyId: UUID!) {\n    mapOwnerClaimPreview(familyId: $familyId) {\n      id\n      blockedReason\n      instant\n      openClaim {\n        id\n        status\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapPageClaimPreview($familyId: UUID!) {\n    mapOwnerClaimPreview(familyId: $familyId) {\n      id\n      blockedReason\n      instant\n      openClaim {\n        id\n        status\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPage_HowToPlayFragment on SbMap {\n    id\n    kind\n    file {\n      id\n      originalDescription\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPage_HowToPlayFragment on SbMap {\n    id\n    kind\n    file {\n      id\n      originalDescription\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPublish_SuggestionFragment on MapPublishSuggestion {\n    id\n    similarity\n    sameKind\n    triggerSimilarity\n    sameResources\n    family {\n      id\n      name\n    }\n    file {\n      id\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPublish_SuggestionFragment on MapPublishSuggestion {\n    id\n    similarity\n    sameKind\n    triggerSimilarity\n    sameResources\n    family {\n      id\n      name\n    }\n    file {\n      id\n      file {\n        id\n        ...MapFileImage_FileFragment\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPublish_FileFragment on SbMap {\n    id\n    name\n    family {\n      id\n      name\n      current {\n        id\n      }\n    }\n    file {\n      id\n      ...MapFileImage_FileFragment\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPublish_FileFragment on SbMap {\n    id\n    name\n    family {\n      id\n      name\n      current {\n        id\n      }\n    }\n    file {\n      id\n      ...MapFileImage_FileFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapPublish_PreviewFragment on MapPublishPreview {\n    id\n    blockedReason\n    needsReview\n    existingMap {\n      id\n      name\n    }\n    suggestions {\n      id\n      ...MapPublish_SuggestionFragment\n    }\n  }\n',
): (typeof documents)['\n  fragment MapPublish_PreviewFragment on MapPublishPreview {\n    id\n    blockedReason\n    needsReview\n    existingMap {\n      id\n      name\n    }\n    suggestions {\n      id\n      ...MapPublish_SuggestionFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapPublishPreview($fileId: SbMapId!) {\n    mapPublishPreview(fileId: $fileId) {\n      id\n      ...MapPublish_PreviewFragment\n    }\n    # What the views of the file show about its listing, so they all catch up to it once the\n    # preview loads\n    map(id: $fileId) {\n      id\n      listed\n      publishedAt\n      staffPick\n      publisher {\n        id\n        name\n      }\n      ...MapPublish_FileFragment\n    }\n  }\n',
): (typeof documents)['\n  query MapPublishPreview($fileId: SbMapId!) {\n    mapPublishPreview(fileId: $fileId) {\n      id\n      ...MapPublish_PreviewFragment\n    }\n    # What the views of the file show about its listing, so they all catch up to it once the\n    # preview loads\n    map(id: $fileId) {\n      id\n      listed\n      publishedAt\n      staffPick\n      publisher {\n        id\n        name\n      }\n      ...MapPublish_FileFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapLinkSuggestions($fileId: SbMapId!) {\n    mapLinkSuggestions(fileId: $fileId) {\n      id\n      ...MapPublish_SuggestionFragment\n    }\n    map(id: $fileId) {\n      id\n      ...MapPublish_FileFragment\n    }\n  }\n',
): (typeof documents)['\n  query MapLinkSuggestions($fileId: SbMapId!) {\n    mapLinkSuggestions(fileId: $fileId) {\n      id\n      ...MapPublish_SuggestionFragment\n    }\n    map(id: $fileId) {\n      id\n      ...MapPublish_FileFragment\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapPublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {\n    mapPublish(fileId: $fileId, answer: $answer) {\n      id\n      heldForReview\n      file {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapPublish($fileId: SbMapId!, $answer: MapPublishAnswerInput!) {\n    mapPublish(fileId: $fileId, answer: $answer) {\n      id\n      heldForReview\n      file {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFileLink($fileId: SbMapId!, $familyId: UUID!) {\n    mapFileLink(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFileLink($fileId: SbMapId!, $familyId: UUID!) {\n    mapFileLink(fileId: $fileId, familyId: $familyId) {\n      id\n      file {\n        id\n        family {\n          id\n          name\n        }\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n      }\n      previousFamily {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapPublishOwnedMaps($owner: SbUserId!) {\n    maps(filter: { owner: $owner }, sort: NAME, first: 100) {\n      edges {\n        node {\n          id\n          family {\n            id\n            name\n          }\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapPublishOwnedMaps($owner: SbUserId!) {\n    maps(filter: { owner: $owner }, sort: NAME, first: 100) {\n      edges {\n        node {\n          id\n          family {\n            id\n            name\n          }\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapPublishReviewApprove($reportId: UUID!) {\n    mapPublishReviewApprove(reportId: $reportId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n      map {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapPublishReviewApprove($reportId: UUID!) {\n    mapPublishReviewApprove(reportId: $reportId) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n      map {\n        id\n        listed\n        publishedAt\n        publisher {\n          id\n          name\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapReportBarSetDefault($fileId: SbMapId!) {\n    mapFamilySetDefault(fileId: $fileId) {\n      id\n      name\n      current {\n        id\n        name\n      }\n      defaultMap {\n        id\n      }\n      defaultSetAt\n      defaultSetBy {\n        id\n        name\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapReportBarSetDefault($fileId: SbMapId!) {\n    mapFamilySetDefault(fileId: $fileId) {\n      id\n      name\n      current {\n        id\n        name\n      }\n      defaultMap {\n        id\n      }\n      defaultSetAt\n      defaultSetBy {\n        id\n        name\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapReportBar($id: UUID!) {\n    mapFamilyReportById(id: $id) {\n      id\n      kind\n      note\n      fromPublish\n      publishAnswer\n      reportedAt\n      status\n      resolvedAt\n      reportedBy {\n        id\n      }\n      resolvedBy {\n        id\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n        owner {\n          id\n        }\n      }\n      map {\n        id\n        name\n        listed\n        firstSeenAt\n        family {\n          id\n        }\n        stats {\n          id\n          gamesTotal\n        }\n      }\n      otherFamily {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MapReportBar($id: UUID!) {\n    mapFamilyReportById(id: $id) {\n      id\n      kind\n      note\n      fromPublish\n      publishAnswer\n      reportedAt\n      status\n      resolvedAt\n      reportedBy {\n        id\n      }\n      resolvedBy {\n        id\n      }\n      family {\n        id\n        name\n        current {\n          id\n        }\n        files {\n          id\n        }\n        owner {\n          id\n        }\n      }\n      map {\n        id\n        name\n        listed\n        firstSeenAt\n        family {\n          id\n        }\n        stats {\n          id\n          gamesTotal\n        }\n      }\n      otherFamily {\n        id\n        name\n        current {\n          id\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapFamilyReportSetStatus($id: UUID!, $status: MapFamilyReportStatus!) {\n    mapFamilyReportSetStatus(id: $id, status: $status) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapFamilyReportSetStatus($id: UUID!, $status: MapFamilyReportStatus!) {\n    mapFamilyReportSetStatus(id: $id, status: $status) {\n      id\n      status\n      resolvedAt\n      resolvedBy {\n        id\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment MapTile_SbMapFragment on SbMap {\n    id\n    name\n    kind\n    playerCount\n    staffPick\n    listed\n    publishedAt\n    isFavorited\n    publisher {\n      id\n    }\n    family {\n      id\n      name\n      current {\n        id\n      }\n    }\n    stats {\n      id\n      games7d\n      games28d\n      gamesTotal\n      trendingScore\n    }\n    file {\n      id\n      ...MapFileImage_FileFragment\n      width\n      height\n      tileset\n      isEud\n      umsForces {\n        name\n        teamId\n        players {\n          playerId\n          isComputer\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment MapTile_SbMapFragment on SbMap {\n    id\n    name\n    kind\n    playerCount\n    staffPick\n    listed\n    publishedAt\n    isFavorited\n    publisher {\n      id\n    }\n    family {\n      id\n      name\n      current {\n        id\n      }\n    }\n    stats {\n      id\n      games7d\n      games28d\n      gamesTotal\n      trendingScore\n    }\n    file {\n      id\n      ...MapFileImage_FileFragment\n      width\n      height\n      tileset\n      isEud\n      umsForces {\n        name\n        teamId\n        players {\n          playerId\n          isComputer\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapUnpublish($fileId: SbMapId!) {\n    mapUnpublish(fileId: $fileId) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n    }\n  }\n',
): (typeof documents)['\n  mutation MapUnpublish($fileId: SbMapId!) {\n    mapUnpublish(fileId: $fileId) {\n      id\n      listed\n      publishedAt\n      publisher {\n        id\n        name\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MapUploadKnownMap($hashes: [String!]!) {\n    mapsByHash(hashes: $hashes) {\n      id\n    }\n  }\n',
): (typeof documents)['\n  query MapUploadKnownMap($hashes: [String!]!) {\n    mapsByHash(hashes: $hashes) {\n      id\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation MapUploadAddToLibrary($id: SbMapId!) {\n    mapAddToLibrary(id: $id) {\n      id\n      inLibrary\n    }\n  }\n',
): (typeof documents)['\n  mutation MapUploadAddToLibrary($id: SbMapId!) {\n    mapAddToLibrary(id: $id) {\n      id\n      inLibrary\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query NewsArchive($first: Int, $after: String) {\n    newsPosts(first: $first, after: $after) {\n      edges {\n        node {\n          id\n          title\n          summary\n          translations {\n            language\n            title\n            summary\n          }\n          publishedAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n',
): (typeof documents)['\n  query NewsArchive($first: Int, $after: String) {\n    newsPosts(first: $first, after: $after) {\n      edges {\n        node {\n          id\n          title\n          summary\n          translations {\n            language\n            title\n            summary\n          }\n          publishedAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment News_HomeFeedFragment on Query {\n    newsPosts(first: 10) {\n      edges {\n        node {\n          id\n          title\n          summary\n          translations {\n            language\n            title\n            summary\n          }\n          publishedAt\n          coverImageUrl\n          coverImageSmallUrl\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  fragment News_HomeFeedFragment on Query {\n    newsPosts(first: 10) {\n      edges {\n        node {\n          id\n          title\n          summary\n          translations {\n            language\n            title\n            summary\n          }\n          publishedAt\n          coverImageUrl\n          coverImageSmallUrl\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation NewsUpdatePost($id: UUID!, $updates: NewsPostUpdates!) {\n    newsUpdatePost(id: $id, updates: $updates) {\n      id\n      title\n      summary\n      content\n      translations {\n        language\n        title\n        summary\n        content\n      }\n      publishedAt\n      updatedAt\n      coverImagePath\n      coverImageUrl\n      coverImageSmallUrl\n    }\n  }\n',
): (typeof documents)['\n  mutation NewsUpdatePost($id: UUID!, $updates: NewsPostUpdates!) {\n    newsUpdatePost(id: $id, updates: $updates) {\n      id\n      title\n      summary\n      content\n      translations {\n        language\n        title\n        summary\n        content\n      }\n      publishedAt\n      updatedAt\n      coverImagePath\n      coverImageUrl\n      coverImageSmallUrl\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation NewsDeletePost($id: UUID!) {\n    newsDeletePost(id: $id)\n  }\n',
): (typeof documents)['\n  mutation NewsDeletePost($id: UUID!) {\n    newsDeletePost(id: $id)\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query NewsPost($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      content\n      translations {\n        language\n        title\n        content\n      }\n      publishedAt\n      coverImageUrl\n      coverImageSmallUrl\n      author {\n        id\n        name\n      }\n    }\n  }\n',
): (typeof documents)['\n  query NewsPost($id: UUID!) {\n    newsPost(id: $id) {\n      id\n      title\n      content\n      translations {\n        language\n        title\n        content\n      }\n      publishedAt\n      coverImageUrl\n      coverImageSmallUrl\n      author {\n        id\n        name\n      }\n    }\n  }\n']
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
  source: '\n  query ConnectionSettings {\n    myTwitchConnection {\n      id\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n',
): (typeof documents)['\n  query ConnectionSettings {\n    myTwitchConnection {\n      id\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n']
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
  source: '\n  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {\n    twitchCompleteLink(code: $code, state: $state) {\n      id\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n',
): (typeof documents)['\n  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {\n    twitchCompleteLink(code: $code, state: $state) {\n      id\n      twitchUserId\n      twitchLogin\n      twitchDisplayName\n      linkedAt\n    }\n  }\n']
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
  source: '\n  fragment LiveStreams_FeedEntryFragment on LiveStream {\n    id\n    twitchLogin\n    twitchDisplayName\n    title\n    viewerCount\n    startedAt\n    thumbnailUrl\n    user {\n      id\n      name\n    }\n  }\n',
): (typeof documents)['\n  fragment LiveStreams_FeedEntryFragment on LiveStream {\n    id\n    twitchLogin\n    twitchDisplayName\n    title\n    viewerCount\n    startedAt\n    thumbnailUrl\n    user {\n      id\n      name\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation BlockStream($userId: SbUserId!) {\n    blockStream(userId: $userId)\n  }\n',
): (typeof documents)['\n  mutation BlockStream($userId: SbUserId!) {\n    blockStream(userId: $userId)\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation UnblockStream($userId: SbUserId!) {\n    unblockStream(userId: $userId)\n  }\n',
): (typeof documents)['\n  mutation UnblockStream($userId: SbUserId!) {\n    unblockStream(userId: $userId)\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query LiveStreamsPage {\n    ...LiveStreams_FeedFragment\n  }\n',
): (typeof documents)['\n  query LiveStreamsPage {\n    ...LiveStreams_FeedFragment\n  }\n']
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
  source: '\n  mutation AdminChangeUserDisplayName(\n    $userId: SbUserId!\n    $newName: String!\n    $grantToken: Boolean!\n    $reason: String\n  ) {\n    userAdminChangeDisplayName(\n      userId: $userId\n      newName: $newName\n      grantToken: $grantToken\n      reason: $reason\n    ) {\n      id\n      name\n    }\n  }\n',
): (typeof documents)['\n  mutation AdminChangeUserDisplayName(\n    $userId: SbUserId!\n    $newName: String!\n    $grantToken: Boolean!\n    $reason: String\n  ) {\n    userAdminChangeDisplayName(\n      userId: $userId\n      newName: $newName\n      grantToken: $grantToken\n      reason: $reason\n    ) {\n      id\n      name\n    }\n  }\n']
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
  source: '\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      useDevelopmentClient\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmaking\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageGameReports\n      manageRestrictedNames\n      manageSignupCodes\n      manageLiveStreams\n    }\n  }\n',
): (typeof documents)['\n  fragment AdminUserProfile_Permissions on SbUser {\n    id\n    permissions {\n      id\n      editPermissions\n      debug\n      useDevelopmentClient\n      banUsers\n      manageLeagues\n      manageMaps\n      manageMapPools\n      manageMatchmaking\n      manageMatchmakingTimes\n      manageMatchmakingSeasons\n      massDeleteMaps\n      moderateChatChannels\n      manageNews\n      manageBugReports\n      manageGameReports\n      manageRestrictedNames\n      manageSignupCodes\n      manageLiveStreams\n    }\n  }\n']
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
  source: '\n  query UserProfileOwnedMaps($owner: SbUserId!, $after: String, $first: Int) {\n    maps(filter: { owner: $owner }, sort: NEWEST, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          id\n          ...MapTile_SbMapFragment\n        }\n      }\n    }\n  }\n',
): (typeof documents)['\n  query UserProfileOwnedMaps($owner: SbUserId!, $after: String, $first: Int) {\n    maps(filter: { owner: $owner }, sort: NEWEST, after: $after, first: $first) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      edges {\n        cursor\n        node {\n          id\n          ...MapTile_SbMapFragment\n        }\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UserProfileOwnsMaps($owner: SbUserId!) {\n    maps(filter: { owner: $owner }, first: 1) {\n      edges {\n        cursor\n      }\n    }\n  }\n',
): (typeof documents)['\n  query UserProfileOwnsMaps($owner: SbUserId!) {\n    maps(filter: { owner: $owner }, first: 1) {\n      edges {\n        cursor\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UserProfileOverlayLive($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      commendCount\n      liveStream {\n        id\n        twitchLogin\n        title\n        viewerCount\n      }\n    }\n  }\n',
): (typeof documents)['\n  query UserProfileOverlayLive($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      commendCount\n      liveStream {\n        id\n        twitchLogin\n        title\n        viewerCount\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UserRankedModes($userId: SbUserId!) {\n    userRankedModes(userId: $userId) {\n      matchmakingType\n      totalGames\n      wins\n      losses\n      rating\n      delta\n    }\n  }\n',
): (typeof documents)['\n  query UserRankedModes($userId: SbUserId!) {\n    userRankedModes(userId: $userId) {\n      matchmakingType\n      totalGames\n      wins\n      losses\n      rating\n      delta\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UserRatingHistory($userId: SbUserId!, $matchmakingType: MatchmakingType!) {\n    userRatingHistory(userId: $userId, matchmakingType: $matchmakingType) {\n      matchmakingType\n      totalGames\n      downsampled\n      points {\n        changeDate\n        rating\n        points\n        seasonId\n      }\n    }\n  }\n',
): (typeof documents)['\n  query UserRatingHistory($userId: SbUserId!, $matchmakingType: MatchmakingType!) {\n    userRatingHistory(userId: $userId, matchmakingType: $matchmakingType) {\n      matchmakingType\n      totalGames\n      downsampled\n      points {\n        changeDate\n        rating\n        points\n        seasonId\n      }\n    }\n  }\n']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UserProfileHeader($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      commendCount\n      twitchChannel {\n        id\n        twitchLogin\n        twitchDisplayName\n      }\n      liveStream {\n        id\n        twitchLogin\n        title\n        gameName\n        viewerCount\n        startedAt\n        thumbnailUrl\n      }\n    }\n  }\n',
): (typeof documents)['\n  query UserProfileHeader($userId: SbUserId!) {\n    user(id: $userId) {\n      id\n      commendCount\n      twitchChannel {\n        id\n        twitchLogin\n        twitchDisplayName\n      }\n      liveStream {\n        id\n        twitchLogin\n        title\n        gameName\n        viewerCount\n        startedAt\n        thumbnailUrl\n      }\n    }\n  }\n']

export function graphql(source: string) {
  return (documents as any)[source] ?? {}
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never
