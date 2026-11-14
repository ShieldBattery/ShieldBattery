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

/** How to treat maps that use EUD triggers. */
export enum EudFilter {
  /** Include EUD maps. */
  Any = 'ANY',
  /** Leave EUD maps out. */
  Exclude = 'EXCLUDE',
  /** Only show EUD maps. */
  Only = 'ONLY',
}

export enum GameFeedbackKind {
  Commend = 'COMMEND',
  Report = 'REPORT',
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

/** Something that differs between two maps. */
export enum MapChange {
  Bases = 'BASES',
  Description = 'DESCRIPTION',
  Dimensions = 'DIMENSIONS',
  Eud = 'EUD',
  /** The forces (teams) and their slots' races and controllers. */
  Forces = 'FORCES',
  Name = 'NAME',
  PlayerCount = 'PLAYER_COUNT',
  StartLocations = 'START_LOCATIONS',
  /** The walkable shape of the terrain (only compared between maps of the same dimensions). */
  Terrain = 'TERRAIN',
  Tileset = 'TILESET',
  TriggerCount = 'TRIGGER_COUNT',
  /** The trigger actions the maps use that melee games don't. */
  UmsActions = 'UMS_ACTIONS',
}

/** Who took a map file out of the listings, or blocked it from being listed. */
export enum MapDelistedKind {
  /** The file's publisher unpublished it. Anyone may publish it again. */
  Publisher = 'PUBLISHER',
  /** Staff delisted it, whether or not it was listed. Only staff can list it again. */
  Staff = 'STAFF',
}

/** A user's report about a map. */
export type MapFamilyReportInput = {
  /**
   * The map that is the same as `otherFamilyId` (`SAME_MAP`), or whose owner didn't make it
   * (`WRONG_OWNER`; the reporter can't be its owner). Required for those. For `WRONG_DEFAULT`
   * and `INAPPROPRIATE`, optionally the map the reporter saw `mapId` in, which it must still be
   * in. Ignored otherwise.
   */
  familyId?: string | null | undefined
  kind: MapFamilyReportKind
  /**
   * The file that isn't part of its map (`WRONG_MAP`), should be the default of its map, which
   * has no owner (`WRONG_DEFAULT`; a listed file that isn't the current one), or is
   * inappropriate (`INAPPROPRIATE`). Required for those, ignored otherwise.
   */
  mapId?: Types.SbMapId | null | undefined
  note?: string | null | undefined
  /** The map that is the same as `familyId`. Required for `SAME_MAP`, ignored otherwise. */
  otherFamilyId?: string | null | undefined
}

/** What a user is telling staff about a map. */
export enum MapFamilyReportKind {
  /** A file's name, description or content is inappropriate. */
  Inappropriate = 'INAPPROPRIATE',
  /**
   * A file's name or description hit the restricted names list when it was published, so it
   * waits for staff to list it or dismiss the report. Only filed by the server.
   */
  PublishReview = 'PUBLISH_REVIEW',
  /** A map is the same as another map. */
  SameMap = 'SAME_MAP',
  /** A map with no owner should have another file as its default. */
  WrongDefault = 'WRONG_DEFAULT',
  /** A file isn't part of the map it's in. */
  WrongMap = 'WRONG_MAP',
  /** A map's owner didn't make it. */
  WrongOwner = 'WRONG_OWNER',
}

/** How staff closed a family report. */
export enum MapFamilyReportStatus {
  /** Staff found nothing to change. */
  Dismissed = 'DISMISSED',
  /** Waiting for staff. */
  Open = 'OPEN',
  /** Staff acted on it. */
  Resolved = 'RESOLVED',
}

/** Filters for map listings. Every filter that is set must match. */
export type MapFilter = {
  eud?: EudFilter
  lens?: MapLens
  /** Only maps with at least this many player slots. */
  minPlayers?: number | null | undefined
  /** Only maps (families) this user owns. */
  owner?: Types.SbUserId | null | undefined
  /** Exact player counts to include. */
  players?: Array<number> | null | undefined
  /** Only maps published at or after this time. */
  publishedSince?: string | null | undefined
  /**
   * Text to search for in map names (curated and original) and descriptions. Case,
   * punctuation and spacing are ignored, and longer queries tolerate small typos.
   */
  search?: string | null | undefined
  sizes?: Array<MapSizeClass> | null | undefined
  /** Only staff picks (`true`) or only maps that aren't staff picks (`false`). */
  staffPick?: boolean | null | undefined
  /** Tileset ids to include. */
  tilesets?: Array<number> | null | undefined
  /**
   * Only verified maps (`true`): staff picks, and maps whose ownership staff granted. With
   * `false`, only the other maps.
   */
  verified?: boolean | null | undefined
}

/** Whether a map is played as a regular melee map or with its own Use Map Settings rules. */
export enum MapKind {
  Melee = 'MELEE',
  Ums = 'UMS',
}

/** Which kind of maps to show. */
export enum MapLens {
  /** Every map. */
  All = 'ALL',
  /** Maps meant for regular melee games. */
  Melee = 'MELEE',
  /** Use Map Settings maps: custom games, scenarios and other non-melee maps. */
  Ums = 'UMS',
}

/** Why a user can't claim a map. */
export enum MapOwnerClaimBlockedReason {
  /** The user already owns the map. */
  AlreadyOwner = 'ALREADY_OWNER',
  /** The user hasn't verified their email address. */
  EmailUnverified = 'EMAIL_UNVERIFIED',
  /** The map has no listed file. */
  NotListed = 'NOT_LISTED',
  /** The user made too many claims recently. */
  RateLimited = 'RATE_LIMITED',
  /** The user is restricted from publishing maps. */
  Restricted = 'RESTRICTED',
}

/** Where a claim to own a map stands. */
export enum MapOwnerClaimStatus {
  /** The claimant was made the owner, by staff or at once. */
  Granted = 'GRANTED',
  /** Waiting for staff. */
  Open = 'OPEN',
  /** Staff turned it down. */
  Rejected = 'REJECTED',
}

/** How a map's owner became its owner. */
export enum MapOwnerKind {
  /** They claimed the map themselves, having published every listed file of it. */
  Claim = 'CLAIM',
  /** Staff granted their claim or set them as the owner. */
  Staff = 'STAFF',
}

export type MapPublishAnswerInput = {
  /** One of the suggested maps. Required for `JOIN` and `UNSURE`, ignored for `KEEP`. */
  familyId?: string | null | undefined
  kind: MapPublishAnswerKind
}

/** How the publisher answers "is this file a version of one of these maps?". */
export enum MapPublishAnswerKind {
  /** The file is a version of `familyId`: list it in that map. */
  Join = 'JOIN',
  /** List the file where it is: in a map of its own, or in its `existingMap`. */
  Keep = 'KEEP',
  /**
   * The file might be a version of `familyId`: list it in a map of its own, and let staff
   * decide.
   */
  Unsure = 'UNSURE',
}

/** Why a user can't publish a file. */
export enum MapPublishBlockedReason {
  /** The file is already listed. */
  AlreadyListed = 'ALREADY_LISTED',
  /** The user hasn't verified their email address. */
  EmailUnverified = 'EMAIL_UNVERIFIED',
  /** The file's name is empty once color codes are stripped. */
  EmptyName = 'EMPTY_NAME',
  /** The file isn't in the user's library. */
  NotInLibrary = 'NOT_IN_LIBRARY',
  /** The user published too many files recently. */
  RateLimited = 'RATE_LIMITED',
  /** The user is restricted from publishing maps. */
  Restricted = 'RESTRICTED',
  /** Staff took the file out of the listings, so only staff can list it again. */
  StaffDelisted = 'STAFF_DELISTED',
}

/**
 * What a publisher said about the map their file may be a version of, kept on a publish review
 * while the file is held and applied when staff approve it.
 */
export enum MapPublishReviewAnswer {
  /** The file is a version of that map: approving the review moves the file into it. */
  Join = 'JOIN',
  /** The file might be a version of that map: approving the review files a `SAME_MAP` report. */
  Unsure = 'UNSURE',
}

/** A size class, by the larger of a map's width and height (in tiles). */
export enum MapSizeClass {
  /** Larger than 192. */
  Huge = 'HUGE',
  /** 129 to 192. */
  Large = 'LARGE',
  /** 97 to 128. */
  Medium = 'MEDIUM',
  /** 65 to 96. */
  Small = 'SMALL',
  /** Up to 64. */
  Tiny = 'TINY',
}

/** The order maps are listed in. */
export enum MapSort {
  /**
   * A collection's own order: as its editor arranged it, or for a Starred collection, the most
   * recently starred first. The default when listing a collection's maps; any other listing
   * treats it as its own default sort.
   */
  CollectionOrder = 'COLLECTION_ORDER',
  /** Most favorited first. */
  MostFavorited = 'MOST_FAVORITED',
  /** Alphabetical, ignoring leading player-count prefixes and bracketed tags. */
  Name = 'NAME',
  /**
   * Most recently published (or, in a user's maps, favorites or a collection, most recently
   * added) first.
   */
  Newest = 'NEWEST',
  /** Fewest player slots first. */
  Players = 'PLAYERS',
  /** Most games in the last 7 days first. */
  Popular_7D = 'POPULAR_7D',
  /** Most games in the last 28 days first. */
  Popular_28D = 'POPULAR_28D',
  /** Most games in the last 90 days first. */
  Popular_90D = 'POPULAR_90D',
  /** Most games ever first. */
  PopularAllTime = 'POPULAR_ALL_TIME',
  /**
   * Best search matches first, then the most played in the last 28 days. Without a search, the
   * same as `POPULAR_28D`.
   */
  Relevance = 'RELEVANCE',
  /** Maps whose lobby play is rising fastest first, then the most played in the last 28 days. */
  Trending = 'TRENDING',
}

/** What happened to a start location between two maps. */
export enum MapStartLocationChangeKind {
  Added = 'ADDED',
  Moved = 'MOVED',
  Removed = 'REMOVED',
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
  maxRatingSpread?: number | null | undefined
  minQuality?: number | null | undefined
  populationHalfLifeSeconds?: number | null | undefined
  rematchDensityFloor?: number | null | undefined
  rematchDensityRadius?: number | null | undefined
  rematchDensityReference?: number | null | undefined
  rematchHalfLifeSeconds?: number | null | undefined
  uncertaintyK?: number | null | undefined
  weightLatency?: number | null | undefined
  weightRatingVariance?: number | null | undefined
  weightRematch?: number | null | undefined
  weightWinProb?: number | null | undefined
  winProbScale?: number | null | undefined
}

export type MatchmakerPerModeOverrideInput = {
  config: MatchmakerModeConfigOverridesInput
  matchmakingType: Types.MatchmakingType
}

export type NewsPostCreation = {
  authorId?: Types.SbUserId | null | undefined
  content: string
  coverImagePath?: string | null | undefined
  publishedAt?: string | null | undefined
  summary: string
  title: string
  translations?: Array<NewsPostTranslationInput> | null | undefined
}

export type NewsPostTranslationInput = {
  content?: string | null | undefined
  language: string
  summary?: string | null | undefined
  title?: string | null | undefined
}

/**
 * Partial updates for an existing news post. Fields omitted from the input are left unchanged.
 * For `publishedAt` and `coverImagePath`, an explicit null clears the current value (e.g.
 * unpublishing a post), so a single mutation covers editing, publishing now, scheduling, and
 * unpublishing. `translations` replaces every translation, so an empty list removes them all.
 */
export type NewsPostUpdates = {
  content?: string | null | undefined
  coverImagePath?: string | null | undefined
  publishedAt?: string | null | undefined
  summary?: string | null | undefined
  title?: string | null | undefined
  translations?: Array<NewsPostTranslationInput> | null | undefined
}

export type ReportGameInput = {
  details?: string | null | undefined
  gameId: string
  /**
   * How far into the game, in seconds of game time, the report is being filed. Only set for
   * reports filed while the game is being played.
   */
  gameTimeSeconds?: number | null | undefined
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
  manageLiveStreams: boolean
  manageMapPools: boolean
  manageMaps: boolean
  manageMatchmaking: boolean
  manageMatchmakingSeasons: boolean
  manageMatchmakingTimes: boolean
  manageNews: boolean
  manageRestrictedNames: boolean
  manageSignupCodes: boolean
  massDeleteMaps: boolean
  moderateChatChannels: boolean
  useDevelopmentClient: boolean
}

export type UrgentMessageInput = {
  message: string
  title: string
  translations?: Array<UrgentMessageTranslationInput> | null | undefined
}

export type UrgentMessageTranslationInput = {
  language: string
  message: string
  title: string
}

export type AdminNewsListQueryVariables = Exact<{
  first?: number | null | undefined
  after?: string | null | undefined
}>

export type AdminNewsListQuery = {
  newsPosts: {
    edges: Array<{
      node: {
        id: string
        title: string
        summary: string
        publishedAt: string | null
        updatedAt: string
        author: { id: Types.SbUserId; name: string } | null
      }
    }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

export type AdminNewsPostQueryVariables = Exact<{
  id: string
}>

export type AdminNewsPostQuery = {
  newsPost: {
    id: string
    title: string
    summary: string
    content: string
    publishedAt: string | null
    coverImagePath: string | null
    coverImageUrl: string | null
    translations: Array<{
      language: string
      title: string | null
      summary: string | null
      content: string | null
    }>
    author: { id: Types.SbUserId; name: string } | null
  } | null
}

export type AdminNewsHistoryQueryVariables = Exact<{
  id: string
}>

export type AdminNewsHistoryQuery = {
  newsPost: {
    id: string
    title: string
    edits: Array<{
      title: string
      summary: string
      content: string
      publishedAt: string | null
      coverImagePath: string | null
      editedAt: string
      translations: Array<{
        language: string
        title: string | null
        summary: string | null
        content: string | null
      }>
      editor: { id: Types.SbUserId; name: string } | null
    }>
  } | null
}

export type NewsCreatePostMutationVariables = Exact<{
  post: NewsPostCreation
}>

export type NewsCreatePostMutation = { newsCreatePost: { id: string } }

export type AdminBlockedStreamsQueryVariables = Exact<{ [key: string]: never }>

export type AdminBlockedStreamsQuery = {
  blockedStreams: Array<{
    id: string
    createdAt: string
    twitchLogin: string | null
    twitchDisplayName: string | null
    user: { id: Types.SbUserId; name: string } | null
    blockedBy: { id: Types.SbUserId; name: string } | null
  }>
}

export type AdminUnblockStreamMutationVariables = Exact<{
  userId: Types.SbUserId
}>

export type AdminUnblockStreamMutation = { unblockStream: boolean }

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
      winProbScale: number | null
      maxRatingSpread: number | null
      minQuality: number | null
      adaptiveComfortableMultiplier: number | null
      adaptiveDecayPerMissing: number | null
      populationHalfLifeSeconds: number | null
      weightRematch: number | null
      rematchHalfLifeSeconds: number | null
      rematchDensityRadius: number | null
      rematchDensityReference: number | null
      rematchDensityFloor: number | null
    }
    perMode: Array<{
      matchmakingType: Types.MatchmakingType
      config: {
        weightRatingVariance: number | null
        weightWinProb: number | null
        weightLatency: number | null
        uncertaintyK: number | null
        winProbScale: number | null
        maxRatingSpread: number | null
        minQuality: number | null
        adaptiveComfortableMultiplier: number | null
        adaptiveDecayPerMissing: number | null
        populationHalfLifeSeconds: number | null
        weightRematch: number | null
        rematchHalfLifeSeconds: number | null
        rematchDensityRadius: number | null
        rematchDensityReference: number | null
        rematchDensityFloor: number | null
      }
    }>
    defaults: {
      searchIntervalSeconds: number
      maxPlayersExamined: number
      weightRatingVariance: number
      weightWinProb: number
      weightLatency: number
      uncertaintyK: number
      winProbScale: number
      maxRatingSpread: number
      minQuality: number
      adaptiveComfortableMultiplier: number
      adaptiveDecayPerMissing: number
      populationHalfLifeSeconds: number
      weightRematch: number
      rematchHalfLifeSeconds: number
      rematchDensityRadius: number
      rematchDensityReference: number
      rematchDensityFloor: number
    }
    modeDefaults: Array<{
      matchmakingType: Types.MatchmakingType
      config: {
        weightRatingVariance: number | null
        weightWinProb: number | null
        weightLatency: number | null
        uncertaintyK: number | null
        winProbScale: number | null
        maxRatingSpread: number | null
        minQuality: number | null
        adaptiveComfortableMultiplier: number | null
        adaptiveDecayPerMissing: number | null
        populationHalfLifeSeconds: number | null
        weightRematch: number | null
        rematchHalfLifeSeconds: number | null
        rematchDensityRadius: number | null
        rematchDensityReference: number | null
        rematchDensityFloor: number | null
      }
    }>
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

export type CurrentUrgentMessageQueryVariables = Exact<{ [key: string]: never }>

export type CurrentUrgentMessageQuery = {
  urgentMessage: {
    id: string
    title: string
    message: string
    translations: Array<{ language: string; title: string; message: string }>
  } | null
}

export type SetUrgentMessageMutationVariables = Exact<{
  message?: UrgentMessageInput | null | undefined
}>

export type SetUrgentMessageMutation = { newsSetUrgentMessage: boolean }

export type ChannelActivityQueryVariables = Exact<{ [key: string]: never }>

export type ChannelActivityQuery = {
  liveStreams: Array<
    {
      id: string
      twitchLogin: string
      viewerCount: number
      user: { id: Types.SbUserId; name: string } | null
    } & {
      ' $fragmentRefs'?: {
        LiveStreams_FeedEntryFragmentFragment: LiveStreams_FeedEntryFragmentFragment
      }
    }
  >
  liveGames: Array<{
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
            Array<{ race: Types.RaceChar; user: { id: Types.SbUserId; name: string } | null }>
          >
        }
  }>
}

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
    gameTimeSeconds: number | null
    createdAt: string
    resolvedAt: string | null
    resolution: GameReportResolution | null
    resolutionNotes: string | null
    reporter: { id: Types.SbUserId; name: string } | null
    reportedUser: { id: Types.SbUserId; name: string } | null
    resolver: { id: Types.SbUserId } | null
    game: {
      id: string
      config:
        | {
            __typename: 'GameConfigDataLobby'
            teams: Array<
              Array<{ isComputer: boolean; user: { id: Types.SbUserId; name: string } | null }>
            >
          }
        | {
            __typename: 'GameConfigDataMatchmaking'
            teams: Array<
              Array<{ isComputer: boolean; user: { id: Types.SbUserId; name: string } | null }>
            >
          }
    } | null
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
    siblingReports: Array<{
      id: string
      reason: GameReportReason
      details: string | null
      gameTimeSeconds: number | null
      createdAt: string
      resolvedAt: string | null
      resolution: GameReportResolution | null
      reporter: { id: Types.SbUserId } | null
    }>
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

export type ResolveSiblingReportsMutationVariables = Exact<{
  id: string
  resolution: GameReportResolution
  notes?: string | null | undefined
}>

export type ResolveSiblingReportsMutation = { resolveSiblingReports: number }

export type GameFeedbackQueryVariables = Exact<{
  gameId: string
}>

export type GameFeedbackQuery = {
  gameFeedback: {
    id: string
    closesAt: string | null
    commendsRemaining: number
    commendsAvailableAt: string | null
    given: Array<{ userId: Types.SbUserId; kind: GameFeedbackKind }>
    recentCommends: Array<{ userId: Types.SbUserId; availableAt: string }>
  }
}

export type CommendPlayerMutationVariables = Exact<{
  gameId: string
  userId: Types.SbUserId
}>

export type CommendPlayerMutation = {
  commendPlayer: {
    feedback: {
      id: string
      closesAt: string | null
      commendsRemaining: number
      commendsAvailableAt: string | null
      given: Array<{ userId: Types.SbUserId; kind: GameFeedbackKind }>
      recentCommends: Array<{ userId: Types.SbUserId; availableAt: string }>
    }
    commendedUser: { id: Types.SbUserId; commendCount: number }
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
  currentRanks: Array<{
    id: string
    userId: Types.SbUserId
    matchmakingType: Types.MatchmakingType
    seasonId: number
    points: number
    lifetimeGames: number
  }>
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
    Leagues_HomeFeedFragmentFragment: Leagues_HomeFeedFragmentFragment
    News_HomeFeedFragmentFragment: News_HomeFeedFragmentFragment
  }
}

export type HomePageLiveContentQueryVariables = Exact<{ [key: string]: never }>

export type HomePageLiveContentQuery = {
  ' $fragmentRefs'?: {
    LiveGames_FeedFragmentFragment: LiveGames_FeedFragmentFragment
    LiveStreams_FeedFragmentFragment: LiveStreams_FeedFragmentFragment
  }
}

export type UrgentMessage_HomeDisplayFragmentFragment = {
  id: string
  title: string
  message: string
  translations: Array<{ language: string; title: string; message: string }>
} & { ' $fragmentName'?: 'UrgentMessage_HomeDisplayFragmentFragment' }

export type Leagues_LeagueBadgeFragmentFragment = {
  name: string
  badgeUrl: string | null
  translations: Array<{ language: string; name: string | null }>
} & { ' $fragmentName'?: 'Leagues_LeagueBadgeFragmentFragment' }

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
  translations: Array<{ language: string; name: string | null }>
} & {
  ' $fragmentRefs'?: { Leagues_LeagueBadgeFragmentFragment: Leagues_LeagueBadgeFragmentFragment }
}) & { ' $fragmentName'?: 'Leagues_HomeFeedEntryFragmentFragment' }

export type AdminMapFamilyReportsQueryVariables = Exact<{
  status: MapFamilyReportStatus
  limit: number
  offset: number
}>

export type AdminMapFamilyReportsQuery = {
  mapFamilyReports: Array<{
    id: string
    kind: MapFamilyReportKind
    note: string | null
    fromPublish: boolean
    publishAnswer: MapPublishReviewAnswer | null
    reportedAt: string
    status: MapFamilyReportStatus
    resolvedAt: string | null
    family: {
      id: string
      name: string
      current: { id: Types.SbMapId }
      files: Array<{ id: Types.SbMapId }>
    } | null
    map: { id: Types.SbMapId; name: string } | null
    otherFamily: { id: string; name: string; current: { id: Types.SbMapId } } | null
    reportedBy: { id: Types.SbUserId } | null
    resolvedBy: { id: Types.SbUserId } | null
  }>
}

export type AdminMapFamilyReportCountsQueryVariables = Exact<{ [key: string]: never }>

export type AdminMapFamilyReportCountsQuery = {
  open: number
  resolved: number
  dismissed: number
  openClaims: number
}

export type AdminMapOwnerClaimsQueryVariables = Exact<{
  limit: number
  offset: number
}>

export type AdminMapOwnerClaimsQuery = {
  mapOwnerClaims: Array<{
    id: string
    note: string | null
    status: MapOwnerClaimStatus
    createdAt: string
    claimant: { id: Types.SbUserId } | null
    family: { id: string; name: string; owner: { id: Types.SbUserId } | null } | null
  }>
}

export type AdminMapOwnerClaimGrantMutationVariables = Exact<{
  claimId: string
}>

export type AdminMapOwnerClaimGrantMutation = {
  mapOwnerClaimGrant: {
    id: string
    status: MapOwnerClaimStatus
    resolvedAt: string | null
    resolvedBy: { id: Types.SbUserId } | null
    family:
      | ({ id: string } & {
          ' $fragmentRefs'?: {
            MapOwner_FamilyOwnerFragmentFragment: MapOwner_FamilyOwnerFragmentFragment
          }
        })
      | null
  }
}

export type AdminMapOwnerClaimRejectMutationVariables = Exact<{
  claimId: string
}>

export type AdminMapOwnerClaimRejectMutation = {
  mapOwnerClaimReject: {
    id: string
    status: MapOwnerClaimStatus
    resolvedAt: string | null
    resolvedBy: { id: Types.SbUserId } | null
  }
}

export type MapSearchTest_MapFragment = {
  id: Types.SbMapId
  name: string
  kind: MapKind
  playerCount: number
  listed: boolean
  staffPick: boolean
  publishedAt: string | null
  favoriteCount: number
  isFavorited: boolean
  inLibrary: boolean
  publisher: { id: Types.SbUserId; name: string } | null
  stats: {
    id: string
    games7d: number
    games28d: number
    games90d: number
    gamesTotal: number
    players90d: number
    medianLength90d: number | null
    lastPlayedAt: string
  } | null
  file: {
    id: string
    tileset: number
    width: number
    height: number
    isEud: boolean
    image256Url: string
  }
} & { ' $fragmentName'?: 'MapSearchTest_MapFragment' }

export type MapSearchTestMapsQueryVariables = Exact<{
  filter?: MapFilter | null | undefined
  sort?: MapSort | null | undefined
  after?: string | null | undefined
  first?: number | null | undefined
}>

export type MapSearchTestMapsQuery = {
  maps: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    edges: Array<{
      cursor: string
      node: { ' $fragmentRefs'?: { MapSearchTest_MapFragment: MapSearchTest_MapFragment } }
    }>
  }
}

export type MapSearchTestLibraryQueryVariables = Exact<{
  filter?: MapFilter | null | undefined
  sort?: MapSort | null | undefined
  after?: string | null | undefined
  first?: number | null | undefined
}>

export type MapSearchTestLibraryQuery = {
  currentUser: {
    id: Types.SbUserId
    mapLibrary: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      edges: Array<{
        cursor: string
        addedAt: string
        node: { ' $fragmentRefs'?: { MapSearchTest_MapFragment: MapSearchTest_MapFragment } }
      }>
    }
  } | null
}

export type MapSearchTestFavoritesQueryVariables = Exact<{
  filter?: MapFilter | null | undefined
  sort?: MapSort | null | undefined
  after?: string | null | undefined
  first?: number | null | undefined
}>

export type MapSearchTestFavoritesQuery = {
  currentUser: {
    id: Types.SbUserId
    favoriteMaps: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      edges: Array<{
        cursor: string
        addedAt: string | null
        node: { ' $fragmentRefs'?: { MapSearchTest_MapFragment: MapSearchTest_MapFragment } }
      }>
    }
  } | null
}

export type MapSearchTestMapQueryVariables = Exact<{
  id: Types.SbMapId
}>

export type MapSearchTestMapQuery = {
  map: { ' $fragmentRefs'?: { MapSearchTest_MapFragment: MapSearchTest_MapFragment } } | null
}

export type MapSearchTestAddFavoriteMutationVariables = Exact<{
  id: Types.SbMapId
}>

export type MapSearchTestAddFavoriteMutation = {
  mapAddFavorite: { ' $fragmentRefs'?: { MapSearchTest_MapFragment: MapSearchTest_MapFragment } }
}

export type MapSearchTestRemoveFavoriteMutationVariables = Exact<{
  id: Types.SbMapId
}>

export type MapSearchTestRemoveFavoriteMutation = {
  mapRemoveFavorite: { ' $fragmentRefs'?: { MapSearchTest_MapFragment: MapSearchTest_MapFragment } }
}

export type MapSpawnsTestMapsQueryVariables = Exact<{ [key: string]: never }>

export type MapSpawnsTestMapsQuery = {
  maps: {
    edges: Array<{
      node: {
        id: Types.SbMapId
        name: string
        file: {
          id: string
          image256Url: string
          image512Url: string
          image1024Url: string
          image2048Url: string
          imageSpawnsBaked: boolean
          width: number
          height: number
          umsContent: boolean | null
          startLocations: Array<{ id: string; slot: number; x: number; y: number }>
        }
      }
    }>
  }
}

export type MapSpawnsTestMapQueryVariables = Exact<{
  id: Types.SbMapId
}>

export type MapSpawnsTestMapQuery = {
  map: {
    id: Types.SbMapId
    name: string
    file: {
      id: string
      image256Url: string
      image512Url: string
      image1024Url: string
      image2048Url: string
      imageSpawnsBaked: boolean
      width: number
      height: number
      umsContent: boolean | null
      startLocations: Array<{ id: string; slot: number; x: number; y: number }>
    }
  } | null
}

export type LocalKnownMapQueryVariables = Exact<{
  hashes: Array<string> | string
}>

export type LocalKnownMapQuery = { mapsByHash: Array<{ id: Types.SbMapId; name: string }> }

export type MapCatalogAllQueryVariables = Exact<{
  filter?: MapFilter | null | undefined
  sort?: MapSort | null | undefined
  after?: string | null | undefined
  first?: number | null | undefined
  withCount: boolean
}>

export type MapCatalogAllQuery = {
  maps: {
    totalCount?: number
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    edges: Array<{
      cursor: string
      node: { id: Types.SbMapId } & {
        ' $fragmentRefs'?: { MapTile_SbMapFragmentFragment: MapTile_SbMapFragmentFragment }
      }
    }>
  }
}

export type MapCatalogLibraryQueryVariables = Exact<{
  filter?: MapFilter | null | undefined
  sort?: MapSort | null | undefined
  after?: string | null | undefined
  first?: number | null | undefined
  withCount: boolean
}>

export type MapCatalogLibraryQuery = {
  currentUser: {
    id: Types.SbUserId
    mapLibrary: {
      totalCount?: number
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      edges: Array<{
        cursor: string
        addedAt: string
        node: { id: Types.SbMapId } & {
          ' $fragmentRefs'?: { MapTile_SbMapFragmentFragment: MapTile_SbMapFragmentFragment }
        }
      }>
    }
  } | null
}

export type MapCatalogFavoritesQueryVariables = Exact<{
  filter?: MapFilter | null | undefined
  sort?: MapSort | null | undefined
  after?: string | null | undefined
  first?: number | null | undefined
  withCount: boolean
}>

export type MapCatalogFavoritesQuery = {
  currentUser: {
    id: Types.SbUserId
    favoriteMaps: {
      totalCount?: number
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      edges: Array<{
        cursor: string
        node: { id: Types.SbMapId } & {
          ' $fragmentRefs'?: { MapTile_SbMapFragmentFragment: MapTile_SbMapFragmentFragment }
        }
      }>
    }
  } | null
}

export type MapCompareQueryVariables = Exact<{
  a: Types.SbMapId
  b: Types.SbMapId
}>

export type MapCompareQuery = {
  mapComparison: {
    id: string
    changes: Array<MapChange>
    terrainSimilarity: number | null
    terrainChanges: string | null
    startLocations: Array<{ id: string; slot: number; kind: MapStartLocationChangeKind }>
    bases: Array<{
      id: string
      beforeIndex: number | null
      afterIndex: number | null
      changed: boolean
    }>
    a: { id: Types.SbMapId } & {
      ' $fragmentRefs'?: { MapCompare_SideFragment: MapCompare_SideFragment }
    }
    b: { id: Types.SbMapId } & {
      ' $fragmentRefs'?: { MapCompare_SideFragment: MapCompare_SideFragment }
    }
  }
}

export type MapCompare_SideFragment = {
  id: Types.SbMapId
  name: string
  playerCount: number
  file: {
    id: string
    tileset: number
    width: number
    height: number
    isEud: boolean
    image2048Url: string
    imageSpawnsBaked: boolean
    umsContent: boolean | null
    startLocations: Array<{ id: string; slot: number; x: number; y: number }>
    analysis: { id: string; triggerCount: number; umsActionKinds: Array<string> } | null
  }
} & { ' $fragmentName'?: 'MapCompare_SideFragment' }

export type MapDefaultNudgeQueryVariables = Exact<{
  id: Types.SbMapId
}>

export type MapDefaultNudgeQuery = {
  map: {
    id: Types.SbMapId
    family: { id: string; current: { id: Types.SbMapId; name: string; listed: boolean } }
  } | null
}

export type MapDelistMutationVariables = Exact<{
  fileId: Types.SbMapId
  note?: string | null | undefined
}>

export type MapDelistMutation = {
  mapDelist: {
    id: Types.SbMapId
    listed: boolean
    publishedAt: string | null
    publisher: { id: Types.SbUserId; name: string } | null
    moderation: {
      id: string
      publishedAt: string | null
      delistedAt: string | null
      delistedKind: MapDelistedKind | null
      delistedNote: string | null
      delistedBy: { id: Types.SbUserId; name: string } | null
    } | null
  }
}

export type MapFamilyAction_FamilyFragmentFragment = {
  id: string
  name: string
  listed: boolean
  current: { id: Types.SbMapId }
  defaultMap: { id: Types.SbMapId } | null
  files: Array<{
    id: Types.SbMapId
    name: string
    listed: boolean
    firstSeenAt: string
    favoriteCount: number
    stats: { id: string; games28d: number; gamesTotal: number } | null
  }>
} & { ' $fragmentName'?: 'MapFamilyAction_FamilyFragmentFragment' }

export type MapFamilyActionFamilyQueryVariables = Exact<{
  id: string
}>

export type MapFamilyActionFamilyQuery = {
  mapFamily: {
    id: string
    family: { id: string } & {
      ' $fragmentRefs'?: {
        MapFamilyAction_FamilyFragmentFragment: MapFamilyAction_FamilyFragmentFragment
      }
    }
  } | null
}

export type MapFamilyActionSimilarQueryVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapFamilyActionSimilarQuery = {
  similarFiles: Array<{
    id: string
    similarity: number
    map: {
      id: Types.SbMapId
      family: { id: string; name: string } & {
        ' $fragmentRefs'?: {
          MapFamilySearch_FamilyFragmentFragment: MapFamilySearch_FamilyFragmentFragment
        }
      }
    }
  }>
}

export type MapFamilySplitFileMutationVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapFamilySplitFileMutation = {
  mapFamilySplitFile: {
    id: string
    file: { id: Types.SbMapId; family: { id: string; name: string } }
    family: { id: string; name: string }
    previousFamily: { id: string } | null
  }
}

export type MapFamilyMoveFileMutationVariables = Exact<{
  fileId: Types.SbMapId
  familyId: string
}>

export type MapFamilyMoveFileMutation = {
  mapFamilyMoveFile: {
    id: string
    file: { id: Types.SbMapId; family: { id: string; name: string } }
    family: { id: string; name: string }
    previousFamily: { id: string } | null
  }
}

export type MapFamilyMergeMutationVariables = Exact<{
  familyId: string
  intoFamilyId: string
}>

export type MapFamilyMergeMutation = { mapFamilyMerge: { id: string; name: string } }

export type MapFamilyReportFamilyQueryVariables = Exact<{
  id: string
}>

export type MapFamilyReportFamilyQuery = {
  mapFamily: {
    id: string
    family: {
      id: string
      current: { id: Types.SbMapId }
      owner: { id: Types.SbUserId; name: string } | null
      files: Array<{ id: Types.SbMapId; name: string; listed: boolean; firstSeenAt: string }>
    }
  } | null
}

export type MapFamilyReportMutationVariables = Exact<{
  input: MapFamilyReportInput
}>

export type MapFamilyReportMutation = {
  mapFamilyReport: { id: string; status: MapFamilyReportStatus }
}

export type MapFamilySearch_FamilyFragmentFragment = {
  id: string
  name: string
  stats: { id: string; gamesTotal: number } | null
  files: Array<{ id: Types.SbMapId }>
  current: {
    id: Types.SbMapId
    listed: boolean
    file: { id: string } & {
      ' $fragmentRefs'?: { MapFileImage_FileFragmentFragment: MapFileImage_FileFragmentFragment }
    }
  }
} & { ' $fragmentName'?: 'MapFamilySearch_FamilyFragmentFragment' }

export type MapFamilySearchQueryVariables = Exact<{
  search: string
}>

export type MapFamilySearchQuery = {
  maps: {
    nodes: Array<{
      id: Types.SbMapId
      family: { id: string } & {
        ' $fragmentRefs'?: {
          MapFamilySearch_FamilyFragmentFragment: MapFamilySearch_FamilyFragmentFragment
        }
      }
    }>
  }
}

export type MapFamilySearchByIdQueryVariables = Exact<{
  id: string
}>

export type MapFamilySearchByIdQuery = {
  mapFamily: {
    id: string
    family: { id: string } & {
      ' $fragmentRefs'?: {
        MapFamilySearch_FamilyFragmentFragment: MapFamilySearch_FamilyFragmentFragment
      }
    }
  } | null
}

export type MapAddFavoriteMutationVariables = Exact<{
  id: Types.SbMapId
}>

export type MapAddFavoriteMutation = {
  mapAddFavorite: {
    id: Types.SbMapId
    isFavorited: boolean
    favoriteCount: number
    family: {
      id: string
      files: Array<{ id: Types.SbMapId; isFavorited: boolean; favoriteCount: number }>
    }
  }
}

export type MapRemoveFavoriteMutationVariables = Exact<{
  id: Types.SbMapId
}>

export type MapRemoveFavoriteMutation = {
  mapRemoveFavorite: {
    id: Types.SbMapId
    isFavorited: boolean
    favoriteCount: number
    family: {
      id: string
      files: Array<{ id: Types.SbMapId; isFavorited: boolean; favoriteCount: number }>
    }
  }
}

export type MapFileImage_FileFragmentFragment = {
  id: string
  image256Url: string
  image512Url: string
  image1024Url: string
  image2048Url: string
  imageSpawnsBaked: boolean
  width: number
  height: number
  umsContent: boolean | null
  startLocations: Array<{ id: string; slot: number; x: number; y: number }>
} & { ' $fragmentName'?: 'MapFileImage_FileFragmentFragment' }

export type LocalAddToLibraryMutationVariables = Exact<{
  id: Types.SbMapId
}>

export type LocalAddToLibraryMutation = {
  mapAddToLibrary: { id: Types.SbMapId; inLibrary: boolean }
}

export type MapFamilySetDefaultMutationVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapFamilySetDefaultMutation = {
  mapFamilySetDefault: {
    id: string
    name: string
    defaultSetAt: string | null
    current: { id: Types.SbMapId; name: string }
    defaultMap: { id: Types.SbMapId } | null
    defaultSetBy: { id: Types.SbUserId; name: string } | null
  }
}

export type MapOwner_FamilyOwnerFragmentFragment = {
  id: string
  ownerKind: MapOwnerKind | null
  ownerSetAt: string | null
  credit: string | null
  owner: { id: Types.SbUserId; name: string } | null
} & { ' $fragmentName'?: 'MapOwner_FamilyOwnerFragmentFragment' }

export type MapOwnerClaimMutationVariables = Exact<{
  familyId: string
  note?: string | null | undefined
}>

export type MapOwnerClaimMutation = {
  mapOwnerClaim: {
    id: string
    granted: boolean
    claim: { id: string; status: MapOwnerClaimStatus; note: string | null; createdAt: string }
    family: { id: string } & {
      ' $fragmentRefs'?: {
        MapOwner_FamilyOwnerFragmentFragment: MapOwner_FamilyOwnerFragmentFragment
      }
    }
  }
}

export type MapOwnerRelinquishMutationVariables = Exact<{
  familyId: string
}>

export type MapOwnerRelinquishMutation = {
  mapOwnerRelinquish: { id: string } & {
    ' $fragmentRefs'?: {
      MapOwner_FamilyOwnerFragmentFragment: MapOwner_FamilyOwnerFragmentFragment
    }
  }
}

export type MapFamilyRemoveOwnerMutationVariables = Exact<{
  familyId: string
}>

export type MapFamilyRemoveOwnerMutation = {
  mapFamilyRemoveOwner: { id: string } & {
    ' $fragmentRefs'?: {
      MapOwner_FamilyOwnerFragmentFragment: MapOwner_FamilyOwnerFragmentFragment
    }
  }
}

export type MapOwnerEditFamilyQueryVariables = Exact<{
  id: string
}>

export type MapOwnerEditFamilyQuery = {
  mapFamily: {
    id: string
    family: { id: string; name: string } & {
      ' $fragmentRefs'?: {
        MapOwner_FamilyOwnerFragmentFragment: MapOwner_FamilyOwnerFragmentFragment
      }
    }
  } | null
}

export type MapFamilySetOwnerMutationVariables = Exact<{
  familyId: string
  userId: Types.SbUserId
}>

export type MapFamilySetOwnerMutation = {
  mapFamilySetOwner: { id: string } & {
    ' $fragmentRefs'?: {
      MapOwner_FamilyOwnerFragmentFragment: MapOwner_FamilyOwnerFragmentFragment
    }
  }
}

export type MapFamilySetCreditMutationVariables = Exact<{
  familyId: string
  credit?: string | null | undefined
}>

export type MapFamilySetCreditMutation = {
  mapFamilySetCredit: { id: string } & {
    ' $fragmentRefs'?: {
      MapOwner_FamilyOwnerFragmentFragment: MapOwner_FamilyOwnerFragmentFragment
    }
  }
}

export type MapOwnerAddFileLibraryQueryVariables = Exact<{
  after?: string | null | undefined
  first?: number | null | undefined
  canManageMaps: boolean
}>

export type MapOwnerAddFileLibraryQuery = {
  currentUser: {
    id: Types.SbUserId
    mapLibrary: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      edges: Array<{
        cursor: string
        node: {
          id: Types.SbMapId
          name: string
          listed: boolean
          playerCount: number
          publishedAt: string | null
          publisher: { id: Types.SbUserId } | null
          moderation?: { id: string; delistedKind: MapDelistedKind | null } | null
          family: {
            id: string
            name: string
            listed: boolean
            credit: string | null
            owner: { id: Types.SbUserId } | null
            files: Array<{ id: Types.SbMapId }>
          }
          file: { id: string; width: number; height: number } & {
            ' $fragmentRefs'?: {
              MapFileImage_FileFragmentFragment: MapFileImage_FileFragmentFragment
            }
          }
        }
      }>
    }
  } | null
}

export type MapOwnerAddFileUploadedQueryVariables = Exact<{
  id: Types.SbMapId
  canManageMaps: boolean
}>

export type MapOwnerAddFileUploadedQuery = {
  map: {
    id: Types.SbMapId
    name: string
    listed: boolean
    playerCount: number
    publishedAt: string | null
    publisher: { id: Types.SbUserId } | null
    moderation?: { id: string; delistedKind: MapDelistedKind | null } | null
    family: {
      id: string
      name: string
      listed: boolean
      credit: string | null
      owner: { id: Types.SbUserId } | null
      files: Array<{ id: Types.SbMapId }>
    }
    file: { id: string; width: number; height: number } & {
      ' $fragmentRefs'?: { MapFileImage_FileFragmentFragment: MapFileImage_FileFragmentFragment }
    }
  } | null
}

export type MapOwnerAddFileLinkMutationVariables = Exact<{
  fileId: Types.SbMapId
  familyId: string
}>

export type MapOwnerAddFileLinkMutation = {
  mapFileLink: {
    id: string
    file: { id: Types.SbMapId; family: { id: string; name: string } }
    family: { id: string; name: string; current: { id: Types.SbMapId } }
    previousFamily: { id: string } | null
  }
}

export type MapOwnerAddFilePublishMutationVariables = Exact<{
  fileId: Types.SbMapId
  answer: MapPublishAnswerInput
}>

export type MapOwnerAddFilePublishMutation = {
  mapPublish: {
    id: string
    heldForReview: boolean
    file: {
      id: Types.SbMapId
      listed: boolean
      publishedAt: string | null
      publisher: { id: Types.SbUserId; name: string } | null
      family: { id: string; name: string }
    }
    family: { id: string; name: string; current: { id: Types.SbMapId } }
  }
}

export type MapLiveGamesQueryVariables = Exact<{ [key: string]: never }>

export type MapLiveGamesQuery = {
  liveGames: Array<
    { id: string; map: { id: Types.SbMapId } } & {
      ' $fragmentRefs'?: {
        LiveGames_FeedEntryFragmentFragment: LiveGames_FeedEntryFragmentFragment
      }
    }
  >
}

export type MapPageFiles_FileFragmentFragment = {
  id: Types.SbMapId
  name: string
  listed: boolean
  firstSeenAt: string
  stats: { id: string; games28d: number; gamesTotal: number } | null
} & { ' $fragmentName'?: 'MapPageFiles_FileFragmentFragment' }

export type MapPageFiles_FamilyFragmentFragment = {
  id: string
  name: string
  listed: boolean
  current: { id: Types.SbMapId; name: string }
  defaultMap: { id: Types.SbMapId } | null
  defaultSetBy?: { id: Types.SbUserId; name: string } | null
  owner: { id: Types.SbUserId } | null
  files: Array<
    { id: Types.SbMapId } & {
      ' $fragmentRefs'?: { MapPageFiles_FileFragmentFragment: MapPageFiles_FileFragmentFragment }
    }
  >
} & { ' $fragmentName'?: 'MapPageFiles_FamilyFragmentFragment' }

export type MapPageFilesUnlinkMutationVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapPageFilesUnlinkMutation = {
  mapFileUnlink: {
    id: string
    file: { id: Types.SbMapId; family: { id: string; name: string } }
    family: { id: string; name: string; current: { id: Types.SbMapId } }
    previousFamily: { id: string } | null
  }
}

export type MapPageStats_FamilyFragmentFragment = {
  id: string
  stats: {
    id: string
    gamesTotal: number
    games28d: number
    players90d: number
    medianLength90d: number | null
    lastPlayedAt: string
  } | null
  weeklyActivity: Array<{
    id: string
    weekStart: string
    lobbyGames: number
    matchmakingGames: number
  }>
} & { ' $fragmentName'?: 'MapPageStats_FamilyFragmentFragment' }

export type MapPageMatchups_MapFragmentFragment = {
  id: Types.SbMapId
  kind: MapKind
  matchupSeasons: Array<{
    id: string
    seasonId: number
    matchmakingType: Types.MatchmakingType
    games: number
  }>
} & { ' $fragmentName'?: 'MapPageMatchups_MapFragmentFragment' }

export type MapMatchupsQueryVariables = Exact<{
  id: Types.SbMapId
  matchmakingType: Types.MatchmakingType
  seasonId?: number | null | undefined
}>

export type MapMatchupsQuery = {
  map: {
    id: Types.SbMapId
    matchups: Array<{
      id: string
      matchup: string
      games: number
      leftWins: number
      rightWins: number
      medianLength: number | null
    }>
  } | null
}

export type MapPageFamilyQueryVariables = Exact<{
  id: string
  canManageMaps: boolean
}>

export type MapPageFamilyQuery = {
  mapFamily: {
    id: string
    file: { id: Types.SbMapId } | null
    family: {
      id: string
      name: string
      ownerKind: MapOwnerKind | null
      credit: string | null
      current: { id: Types.SbMapId }
      files: Array<{ id: Types.SbMapId }>
      owner: { id: Types.SbUserId; name: string } | null
    } & {
      ' $fragmentRefs'?: {
        MapPageStats_FamilyFragmentFragment: MapPageStats_FamilyFragmentFragment
        MapPageFiles_FamilyFragmentFragment: MapPageFiles_FamilyFragmentFragment
      }
    }
  } | null
}

export type MapPageFileQueryVariables = Exact<{
  id: Types.SbMapId
  canManageMaps: boolean
}>

export type MapPageFileQuery = {
  map:
    | ({
        id: Types.SbMapId
        name: string
        kind: MapKind
        family: { id: string; name: string }
        stats: { id: string } | null
        file: { id: string; image256Url: string } & {
          ' $fragmentRefs'?: {
            MapFileImage_FileFragmentFragment: MapFileImage_FileFragmentFragment
          }
        }
      } & {
        ' $fragmentRefs'?: {
          MapPage_HeaderFragmentFragment: MapPage_HeaderFragmentFragment
          MapPage_ActionsFragmentFragment: MapPage_ActionsFragmentFragment
          MapPage_FactsFragmentFragment: MapPage_FactsFragmentFragment
          MapPage_HowToPlayFragmentFragment: MapPage_HowToPlayFragmentFragment
          MapPageMatchups_MapFragmentFragment: MapPageMatchups_MapFragmentFragment
          MapPageFiles_FileFragmentFragment: MapPageFiles_FileFragmentFragment
        }
      })
    | null
}

export type MapPage_FactsFragmentFragment = {
  id: Types.SbMapId
  kind: MapKind
  playerCount: number
  file: {
    id: string
    width: number
    height: number
    tileset: number
    isEud: boolean
    umsForces: Array<{
      name: string
      teamId: number
      players: Array<{ playerId: number; isComputer: boolean }>
    }>
    analysis: { id: string; baseCount: number | null } | null
  }
} & { ' $fragmentName'?: 'MapPage_FactsFragmentFragment' }

export type MapPage_HeaderFragmentFragment = {
  id: Types.SbMapId
  name: string
  description: string
  kind: MapKind
  listed: boolean
  staffPick: boolean
  publishedAt: string | null
  publisher: { id: Types.SbUserId; name: string } | null
  file: { id: string; originalName: string; originalDescription: string }
  moderation?: {
    id: string
    delistedAt: string | null
    delistedKind: MapDelistedKind | null
    delistedNote: string | null
    delistedBy: { id: Types.SbUserId; name: string } | null
  } | null
} & { ' $fragmentName'?: 'MapPage_HeaderFragmentFragment' }

export type MapPage_ActionsFragmentFragment = {
  id: Types.SbMapId
  name: string
  listed: boolean
  isFavorited: boolean
  inLibrary: boolean
  publisher: { id: Types.SbUserId } | null
  moderation?: {
    id: string
    publishedAt: string | null
    delistedKind: MapDelistedKind | null
  } | null
} & { ' $fragmentName'?: 'MapPage_ActionsFragmentFragment' }

export type MapPageRelistMutationVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapPageRelistMutation = {
  mapRelist: {
    id: Types.SbMapId
    listed: boolean
    publishedAt: string | null
    publisher: { id: Types.SbUserId; name: string } | null
    moderation: {
      id: string
      publishedAt: string | null
      delistedAt: string | null
      delistedKind: MapDelistedKind | null
      delistedNote: string | null
      delistedBy: { id: Types.SbUserId; name: string } | null
    } | null
  }
}

export type MapPageFileUnlinkMutationVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapPageFileUnlinkMutation = {
  mapFileUnlink: {
    id: string
    file: { id: Types.SbMapId; family: { id: string; name: string } }
    family: { id: string; name: string; current: { id: Types.SbMapId } }
    previousFamily: { id: string } | null
  }
}

export type MapPageClaimPreviewQueryVariables = Exact<{
  familyId: string
}>

export type MapPageClaimPreviewQuery = {
  mapOwnerClaimPreview: {
    id: string
    blockedReason: MapOwnerClaimBlockedReason | null
    instant: boolean
    openClaim: { id: string; status: MapOwnerClaimStatus } | null
  }
}

export type MapPage_HowToPlayFragmentFragment = {
  id: Types.SbMapId
  kind: MapKind
  file: { id: string; originalDescription: string }
} & { ' $fragmentName'?: 'MapPage_HowToPlayFragmentFragment' }

export type MapPublish_SuggestionFragmentFragment = {
  id: string
  similarity: number
  sameKind: boolean
  triggerSimilarity: number | null
  sameResources: boolean
  family: { id: string; name: string }
  file: {
    id: Types.SbMapId
    file: { id: string } & {
      ' $fragmentRefs'?: { MapFileImage_FileFragmentFragment: MapFileImage_FileFragmentFragment }
    }
  }
} & { ' $fragmentName'?: 'MapPublish_SuggestionFragmentFragment' }

export type MapPublish_FileFragmentFragment = {
  id: Types.SbMapId
  name: string
  family: { id: string; name: string; current: { id: Types.SbMapId } }
  file: { id: string } & {
    ' $fragmentRefs'?: { MapFileImage_FileFragmentFragment: MapFileImage_FileFragmentFragment }
  }
} & { ' $fragmentName'?: 'MapPublish_FileFragmentFragment' }

export type MapPublish_PreviewFragmentFragment = {
  id: string
  blockedReason: MapPublishBlockedReason | null
  needsReview: boolean
  existingMap: { id: string; name: string } | null
  suggestions: Array<
    { id: string } & {
      ' $fragmentRefs'?: {
        MapPublish_SuggestionFragmentFragment: MapPublish_SuggestionFragmentFragment
      }
    }
  >
} & { ' $fragmentName'?: 'MapPublish_PreviewFragmentFragment' }

export type MapPublishPreviewQueryVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapPublishPreviewQuery = {
  mapPublishPreview: { id: string } & {
    ' $fragmentRefs'?: { MapPublish_PreviewFragmentFragment: MapPublish_PreviewFragmentFragment }
  }
  map:
    | ({
        id: Types.SbMapId
        listed: boolean
        publishedAt: string | null
        staffPick: boolean
        publisher: { id: Types.SbUserId; name: string } | null
      } & {
        ' $fragmentRefs'?: { MapPublish_FileFragmentFragment: MapPublish_FileFragmentFragment }
      })
    | null
}

export type MapLinkSuggestionsQueryVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapLinkSuggestionsQuery = {
  mapLinkSuggestions: Array<
    { id: string } & {
      ' $fragmentRefs'?: {
        MapPublish_SuggestionFragmentFragment: MapPublish_SuggestionFragmentFragment
      }
    }
  >
  map:
    | ({ id: Types.SbMapId } & {
        ' $fragmentRefs'?: { MapPublish_FileFragmentFragment: MapPublish_FileFragmentFragment }
      })
    | null
}

export type MapPublishMutationVariables = Exact<{
  fileId: Types.SbMapId
  answer: MapPublishAnswerInput
}>

export type MapPublishMutation = {
  mapPublish: {
    id: string
    heldForReview: boolean
    file: {
      id: Types.SbMapId
      listed: boolean
      publishedAt: string | null
      publisher: { id: Types.SbUserId; name: string } | null
      family: { id: string; name: string }
    }
    family: { id: string; name: string; current: { id: Types.SbMapId } }
  }
}

export type MapFileLinkMutationVariables = Exact<{
  fileId: Types.SbMapId
  familyId: string
}>

export type MapFileLinkMutation = {
  mapFileLink: {
    id: string
    file: { id: Types.SbMapId; family: { id: string; name: string } }
    family: { id: string; name: string; current: { id: Types.SbMapId } }
    previousFamily: { id: string } | null
  }
}

export type MapPublishOwnedMapsQueryVariables = Exact<{
  owner: Types.SbUserId
}>

export type MapPublishOwnedMapsQuery = {
  maps: { edges: Array<{ node: { id: Types.SbMapId; family: { id: string; name: string } } }> }
}

export type MapPublishReviewApproveMutationVariables = Exact<{
  reportId: string
}>

export type MapPublishReviewApproveMutation = {
  mapPublishReviewApprove: {
    id: string
    status: MapFamilyReportStatus
    resolvedAt: string | null
    resolvedBy: { id: Types.SbUserId } | null
    map: {
      id: Types.SbMapId
      listed: boolean
      publishedAt: string | null
      publisher: { id: Types.SbUserId; name: string } | null
    } | null
  }
}

export type MapReportBarSetDefaultMutationVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapReportBarSetDefaultMutation = {
  mapFamilySetDefault: {
    id: string
    name: string
    defaultSetAt: string | null
    current: { id: Types.SbMapId; name: string }
    defaultMap: { id: Types.SbMapId } | null
    defaultSetBy: { id: Types.SbUserId; name: string } | null
  }
}

export type MapReportBarQueryVariables = Exact<{
  id: string
}>

export type MapReportBarQuery = {
  mapFamilyReportById: {
    id: string
    kind: MapFamilyReportKind
    note: string | null
    fromPublish: boolean
    publishAnswer: MapPublishReviewAnswer | null
    reportedAt: string
    status: MapFamilyReportStatus
    resolvedAt: string | null
    reportedBy: { id: Types.SbUserId } | null
    resolvedBy: { id: Types.SbUserId } | null
    family: {
      id: string
      name: string
      current: { id: Types.SbMapId }
      files: Array<{ id: Types.SbMapId }>
      owner: { id: Types.SbUserId } | null
    } | null
    map: {
      id: Types.SbMapId
      name: string
      listed: boolean
      firstSeenAt: string
      family: { id: string }
      stats: { id: string; gamesTotal: number } | null
    } | null
    otherFamily: { id: string; name: string; current: { id: Types.SbMapId } } | null
  } | null
}

export type MapFamilyReportSetStatusMutationVariables = Exact<{
  id: string
  status: MapFamilyReportStatus
}>

export type MapFamilyReportSetStatusMutation = {
  mapFamilyReportSetStatus: {
    id: string
    status: MapFamilyReportStatus
    resolvedAt: string | null
    resolvedBy: { id: Types.SbUserId } | null
  }
}

export type MapTile_SbMapFragmentFragment = {
  id: Types.SbMapId
  name: string
  kind: MapKind
  playerCount: number
  staffPick: boolean
  listed: boolean
  publishedAt: string | null
  isFavorited: boolean
  publisher: { id: Types.SbUserId } | null
  family: { id: string; name: string; current: { id: Types.SbMapId } }
  stats: {
    id: string
    games7d: number
    games28d: number
    gamesTotal: number
    trendingScore: number
  } | null
  file: {
    id: string
    width: number
    height: number
    tileset: number
    isEud: boolean
    umsForces: Array<{
      name: string
      teamId: number
      players: Array<{ playerId: number; isComputer: boolean }>
    }>
  } & {
    ' $fragmentRefs'?: { MapFileImage_FileFragmentFragment: MapFileImage_FileFragmentFragment }
  }
} & { ' $fragmentName'?: 'MapTile_SbMapFragmentFragment' }

export type MapUnpublishMutationVariables = Exact<{
  fileId: Types.SbMapId
}>

export type MapUnpublishMutation = {
  mapUnpublish: {
    id: Types.SbMapId
    listed: boolean
    publishedAt: string | null
    publisher: { id: Types.SbUserId; name: string } | null
  }
}

export type MapUploadKnownMapQueryVariables = Exact<{
  hashes: Array<string> | string
}>

export type MapUploadKnownMapQuery = { mapsByHash: Array<{ id: Types.SbMapId }> }

export type MapUploadAddToLibraryMutationVariables = Exact<{
  id: Types.SbMapId
}>

export type MapUploadAddToLibraryMutation = {
  mapAddToLibrary: { id: Types.SbMapId; inLibrary: boolean }
}

export type NewsArchiveQueryVariables = Exact<{
  first?: number | null | undefined
  after?: string | null | undefined
}>

export type NewsArchiveQuery = {
  newsPosts: {
    edges: Array<{
      node: {
        id: string
        title: string
        summary: string
        publishedAt: string | null
        translations: Array<{ language: string; title: string | null; summary: string | null }>
      }
    }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

export type News_HomeFeedFragmentFragment = {
  newsPosts: {
    edges: Array<{
      node: {
        id: string
        title: string
        summary: string
        publishedAt: string | null
        coverImageUrl: string | null
        coverImageSmallUrl: string | null
        translations: Array<{ language: string; title: string | null; summary: string | null }>
      }
    }>
  }
} & { ' $fragmentName'?: 'News_HomeFeedFragmentFragment' }

export type NewsUpdatePostMutationVariables = Exact<{
  id: string
  updates: NewsPostUpdates
}>

export type NewsUpdatePostMutation = {
  newsUpdatePost: {
    id: string
    title: string
    summary: string
    content: string
    publishedAt: string | null
    updatedAt: string
    coverImagePath: string | null
    coverImageUrl: string | null
    coverImageSmallUrl: string | null
    translations: Array<{
      language: string
      title: string | null
      summary: string | null
      content: string | null
    }>
  }
}

export type NewsDeletePostMutationVariables = Exact<{
  id: string
}>

export type NewsDeletePostMutation = { newsDeletePost: boolean }

export type NewsPostQueryVariables = Exact<{
  id: string
}>

export type NewsPostQuery = {
  newsPost: {
    id: string
    title: string
    content: string
    publishedAt: string | null
    coverImageUrl: string | null
    coverImageSmallUrl: string | null
    translations: Array<{ language: string; title: string | null; content: string | null }>
    author: { id: Types.SbUserId; name: string } | null
  } | null
}

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

export type ConnectionSettingsQueryVariables = Exact<{ [key: string]: never }>

export type ConnectionSettingsQuery = {
  myTwitchConnection: {
    id: string
    twitchUserId: string
    twitchLogin: string
    twitchDisplayName: string
    linkedAt: string
  } | null
}

export type ConnectionSettingsStartTwitchLinkMutationVariables = Exact<{
  desktop: boolean
}>

export type ConnectionSettingsStartTwitchLinkMutation = { twitchStartLink: { url: string } }

export type ConnectionSettingsCompleteTwitchLinkMutationVariables = Exact<{
  code: string
  state: string
}>

export type ConnectionSettingsCompleteTwitchLinkMutation = {
  twitchCompleteLink: {
    id: string
    twitchUserId: string
    twitchLogin: string
    twitchDisplayName: string
    linkedAt: string
  }
}

export type ConnectionSettingsUnlinkTwitchMutationVariables = Exact<{ [key: string]: never }>

export type ConnectionSettingsUnlinkTwitchMutation = { twitchUnlink: boolean }

export type LiveUserIdsQueryVariables = Exact<{ [key: string]: never }>

export type LiveUserIdsQuery = { liveStreamUserIds: Array<Types.SbUserId> }

export type LiveStreams_FeedFragmentFragment = {
  liveStreams: Array<
    { twitchLogin: string; viewerCount: number } & {
      ' $fragmentRefs'?: {
        LiveStreams_FeedEntryFragmentFragment: LiveStreams_FeedEntryFragmentFragment
      }
    }
  >
} & { ' $fragmentName'?: 'LiveStreams_FeedFragmentFragment' }

export type LiveStreams_FeedEntryFragmentFragment = {
  id: string
  twitchLogin: string
  twitchDisplayName: string
  title: string
  viewerCount: number
  startedAt: string
  thumbnailUrl: string
  user: { id: Types.SbUserId; name: string } | null
} & { ' $fragmentName'?: 'LiveStreams_FeedEntryFragmentFragment' }

export type BlockStreamMutationVariables = Exact<{
  userId: Types.SbUserId
}>

export type BlockStreamMutation = { blockStream: boolean }

export type UnblockStreamMutationVariables = Exact<{
  userId: Types.SbUserId
}>

export type UnblockStreamMutation = { unblockStream: boolean }

export type LiveStreamsPageQueryVariables = Exact<{ [key: string]: never }>

export type LiveStreamsPageQuery = {
  ' $fragmentRefs'?: { LiveStreams_FeedFragmentFragment: LiveStreams_FeedFragmentFragment }
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

export type AdminChangeUserDisplayNameMutationVariables = Exact<{
  userId: Types.SbUserId
  newName: string
  grantToken: boolean
  reason?: string | null | undefined
}>

export type AdminChangeUserDisplayNameMutation = {
  userAdminChangeDisplayName: { id: Types.SbUserId; name: string }
}

export type AdminUserProfileQueryVariables = Exact<{
  userId: Types.SbUserId
  includePermissions: boolean
}>

export type AdminUserProfileQuery = {
  user:
    | ({ id: Types.SbUserId } & {
        ' $fragmentRefs'?: {
          AdminUserProfile_PermissionsFragment: AdminUserProfile_PermissionsFragment
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
    useDevelopmentClient: boolean
    banUsers: boolean
    manageLeagues: boolean
    manageMaps: boolean
    manageMapPools: boolean
    manageMatchmaking: boolean
    manageMatchmakingTimes: boolean
    manageMatchmakingSeasons: boolean
    massDeleteMaps: boolean
    moderateChatChannels: boolean
    manageNews: boolean
    manageBugReports: boolean
    manageGameReports: boolean
    manageRestrictedNames: boolean
    manageSignupCodes: boolean
    manageLiveStreams: boolean
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

export type UserProfileOwnedMapsQueryVariables = Exact<{
  owner: Types.SbUserId
  after?: string | null | undefined
  first?: number | null | undefined
}>

export type UserProfileOwnedMapsQuery = {
  maps: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    edges: Array<{
      cursor: string
      node: { id: Types.SbMapId } & {
        ' $fragmentRefs'?: { MapTile_SbMapFragmentFragment: MapTile_SbMapFragmentFragment }
      }
    }>
  }
}

export type UserProfileOwnsMapsQueryVariables = Exact<{
  owner: Types.SbUserId
}>

export type UserProfileOwnsMapsQuery = { maps: { edges: Array<{ cursor: string }> } }

export type UserProfileOverlayLiveQueryVariables = Exact<{
  userId: Types.SbUserId
}>

export type UserProfileOverlayLiveQuery = {
  user: {
    id: Types.SbUserId
    commendCount: number
    liveStream: { id: string; twitchLogin: string; title: string; viewerCount: number } | null
  } | null
}

export type UserRankedModesQueryVariables = Exact<{
  userId: Types.SbUserId
}>

export type UserRankedModesQuery = {
  userRankedModes: Array<{
    matchmakingType: Types.MatchmakingType
    totalGames: number
    wins: number
    losses: number
    rating: number | null
    delta: number | null
  }>
}

export type UserRatingHistoryQueryVariables = Exact<{
  userId: Types.SbUserId
  matchmakingType: Types.MatchmakingType
}>

export type UserRatingHistoryQuery = {
  userRatingHistory: {
    matchmakingType: Types.MatchmakingType
    totalGames: number
    downsampled: boolean
    points: Array<{ changeDate: string; rating: number | null; points: number; seasonId: number }>
  }
}

export type UserProfileHeaderQueryVariables = Exact<{
  userId: Types.SbUserId
}>

export type UserProfileHeaderQuery = {
  user: {
    id: Types.SbUserId
    commendCount: number
    twitchChannel: { id: string; twitchLogin: string; twitchDisplayName: string } | null
    liveStream: {
      id: string
      twitchLogin: string
      title: string
      gameName: string
      viewerCount: number
      startedAt: string
      thumbnailUrl: string
    } | null
  } | null
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
            kind: 'Field',
            name: { kind: 'Name', value: 'currentRanks' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'seasonId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'points' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lifetimeGames' } },
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
            kind: 'Field',
            name: { kind: 'Name', value: 'currentRanks' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'seasonId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'points' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lifetimeGames' } },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                { kind: 'Field', name: { kind: 'Name', value: 'message' } },
              ],
            },
          },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'endAt' } },
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'Leagues_LeagueBadgeFragment' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<Leagues_HomeFeedFragmentFragment, unknown>
export const MapSearchTest_MapFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapSearchTest_Map' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapSearchTest_MapFragment, unknown>
export const MapCompare_SideFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapCompare_Side' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
                { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'startLocations' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'y' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'analysis' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'triggerCount' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'umsActionKinds' } },
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
} as unknown as DocumentNode<MapCompare_SideFragment, unknown>
export const MapFamilyAction_FamilyFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFamilyAction_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'current' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'defaultMap' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'files' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                { kind: 'Field', name: { kind: 'Name', value: 'firstSeenAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'stats' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
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
} as unknown as DocumentNode<MapFamilyAction_FamilyFragmentFragment, unknown>
export const MapFileImage_FileFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapFileImage_FileFragmentFragment, unknown>
export const MapFamilySearch_FamilyFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFamilySearch_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'files' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'current' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapFamilySearch_FamilyFragmentFragment, unknown>
export const MapOwner_FamilyOwnerFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerSetAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapOwner_FamilyOwnerFragmentFragment, unknown>
export const MapPageFiles_FileFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageFiles_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'firstSeenAt' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPageFiles_FileFragmentFragment, unknown>
export const MapPageFiles_FamilyFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageFiles_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'current' },
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
            name: { kind: 'Name', value: 'defaultMap' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'defaultSetBy' },
            directives: [
              {
                kind: 'Directive',
                name: { kind: 'Name', value: 'include' },
                arguments: [
                  {
                    kind: 'Argument',
                    name: { kind: 'Name', value: 'if' },
                    value: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
                  },
                ],
              },
            ],
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
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'files' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPageFiles_FileFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageFiles_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'firstSeenAt' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPageFiles_FamilyFragmentFragment, unknown>
export const MapPageStats_FamilyFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageStats_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'weeklyActivity' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'weeks' },
                value: { kind: 'IntValue', value: '26' },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'weekStart' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lobbyGames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingGames' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPageStats_FamilyFragmentFragment, unknown>
export const MapPageMatchups_MapFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageMatchups_MapFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'matchupSeasons' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'seasonId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPageMatchups_MapFragmentFragment, unknown>
export const MapPage_FactsFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPage_FactsFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'umsForces' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'teamId' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'players' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'playerId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isComputer' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'analysis' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'baseCount' } },
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
} as unknown as DocumentNode<MapPage_FactsFragmentFragment, unknown>
export const MapPage_HeaderFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPage_HeaderFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'description' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'originalName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'originalDescription' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'moderation' },
            directives: [
              {
                kind: 'Directive',
                name: { kind: 'Name', value: 'include' },
                arguments: [
                  {
                    kind: 'Argument',
                    name: { kind: 'Name', value: 'if' },
                    value: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delistedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delistedKind' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delistedNote' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'delistedBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<MapPage_HeaderFragmentFragment, unknown>
export const MapPage_ActionsFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPage_ActionsFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'moderation' },
            directives: [
              {
                kind: 'Directive',
                name: { kind: 'Name', value: 'include' },
                arguments: [
                  {
                    kind: 'Argument',
                    name: { kind: 'Name', value: 'if' },
                    value: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delistedKind' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPage_ActionsFragmentFragment, unknown>
export const MapPage_HowToPlayFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPage_HowToPlayFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'originalDescription' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPage_HowToPlayFragmentFragment, unknown>
export const MapPublish_FileFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPublish_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPublish_FileFragmentFragment, unknown>
export const MapPublish_SuggestionFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPublish_SuggestionFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapPublishSuggestion' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'similarity' } },
          { kind: 'Field', name: { kind: 'Name', value: 'sameKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'triggerSimilarity' } },
          { kind: 'Field', name: { kind: 'Name', value: 'sameResources' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
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
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPublish_SuggestionFragmentFragment, unknown>
export const MapPublish_PreviewFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPublish_PreviewFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapPublishPreview' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'blockedReason' } },
          { kind: 'Field', name: { kind: 'Name', value: 'needsReview' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'existingMap' },
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
            name: { kind: 'Name', value: 'suggestions' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPublish_SuggestionFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPublish_SuggestionFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapPublishSuggestion' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'similarity' } },
          { kind: 'Field', name: { kind: 'Name', value: 'sameKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'triggerSimilarity' } },
          { kind: 'Field', name: { kind: 'Name', value: 'sameResources' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
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
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
} as unknown as DocumentNode<MapPublish_PreviewFragmentFragment, unknown>
export const MapTile_SbMapFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'trendingScore' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'umsForces' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'teamId' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'players' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'playerId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isComputer' } },
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
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapTile_SbMapFragmentFragment, unknown>
export const News_HomeFeedFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'News_HomeFeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'newsPosts' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '10' },
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
                            { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'translations' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                                ],
                              },
                            },
                            { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'coverImageUrl' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'coverImageSmallUrl' } },
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
} as unknown as DocumentNode<News_HomeFeedFragmentFragment, unknown>
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
export const LiveStreams_FeedEntryFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'LiveStream' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'title' } },
          { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'thumbnailUrl' } },
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
        ],
      },
    },
  ],
} as unknown as DocumentNode<LiveStreams_FeedEntryFragmentFragment, unknown>
export const LiveStreams_FeedFragmentFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveStreams_FeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'liveStreams' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'LiveStream' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'title' } },
          { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'thumbnailUrl' } },
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
        ],
      },
    },
  ],
} as unknown as DocumentNode<LiveStreams_FeedFragmentFragment, unknown>
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
                { kind: 'Field', name: { kind: 'Name', value: 'useDevelopmentClient' } },
                { kind: 'Field', name: { kind: 'Name', value: 'banUsers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLeagues' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMapPools' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmaking' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageGameReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageSignupCodes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLiveStreams' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminUserProfile_PermissionsFragment, unknown>
export const AdminNewsListDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminNewsList' },
      variableDefinitions: [
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
            name: { kind: 'Name', value: 'newsPosts' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'includeUnpublished' },
                value: { kind: 'BooleanValue', value: true },
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
                            { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'author' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<AdminNewsListQuery, AdminNewsListQueryVariables>
export const AdminNewsPostDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminNewsPost' },
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
            name: { kind: 'Name', value: 'newsPost' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                { kind: 'Field', name: { kind: 'Name', value: 'content' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'translations' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'content' } },
                    ],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'coverImagePath' } },
                { kind: 'Field', name: { kind: 'Name', value: 'coverImageUrl' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'author' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<AdminNewsPostQuery, AdminNewsPostQueryVariables>
export const AdminNewsHistoryDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminNewsHistory' },
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
            name: { kind: 'Name', value: 'newsPost' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'edits' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'content' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'translations' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'content' } },
                          ],
                        },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'coverImagePath' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'editedAt' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'editor' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<AdminNewsHistoryQuery, AdminNewsHistoryQueryVariables>
export const NewsCreatePostDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'NewsCreatePost' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'post' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'NewsPostCreation' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'newsCreatePost' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'post' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'post' } },
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
} as unknown as DocumentNode<NewsCreatePostMutation, NewsCreatePostMutationVariables>
export const AdminBlockedStreamsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminBlockedStreams' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'blockedStreams' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'blockedBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<AdminBlockedStreamsQuery, AdminBlockedStreamsQueryVariables>
export const AdminUnblockStreamDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AdminUnblockStream' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'unblockStream' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AdminUnblockStreamMutation, AdminUnblockStreamMutationVariables>
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
                      { kind: 'Field', name: { kind: 'Name', value: 'winProbScale' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'maxRatingSpread' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'minQuality' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'adaptiveComfortableMultiplier' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'adaptiveDecayPerMissing' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'populationHalfLifeSeconds' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'weightRematch' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rematchHalfLifeSeconds' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rematchDensityRadius' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rematchDensityReference' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rematchDensityFloor' } },
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
                            { kind: 'Field', name: { kind: 'Name', value: 'winProbScale' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'maxRatingSpread' } },
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
                            { kind: 'Field', name: { kind: 'Name', value: 'weightRematch' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'rematchHalfLifeSeconds' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'rematchDensityRadius' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'rematchDensityReference' },
                            },
                            { kind: 'Field', name: { kind: 'Name', value: 'rematchDensityFloor' } },
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
                      { kind: 'Field', name: { kind: 'Name', value: 'winProbScale' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'maxRatingSpread' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'minQuality' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'adaptiveComfortableMultiplier' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'adaptiveDecayPerMissing' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'populationHalfLifeSeconds' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'weightRematch' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rematchHalfLifeSeconds' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rematchDensityRadius' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rematchDensityReference' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rematchDensityFloor' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'modeDefaults' },
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
                            { kind: 'Field', name: { kind: 'Name', value: 'winProbScale' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'maxRatingSpread' } },
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
                            { kind: 'Field', name: { kind: 'Name', value: 'weightRematch' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'rematchHalfLifeSeconds' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'rematchDensityRadius' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'rematchDensityReference' },
                            },
                            { kind: 'Field', name: { kind: 'Name', value: 'rematchDensityFloor' } },
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
export const CurrentUrgentMessageDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'CurrentUrgentMessage' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'urgentMessage' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'translations' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'message' } },
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
} as unknown as DocumentNode<CurrentUrgentMessageQuery, CurrentUrgentMessageQueryVariables>
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
export const ChannelActivityDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'ChannelActivity' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'liveStreams' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
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
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'liveGames' },
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
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'matchmakingType' },
                                  },
                                ],
                              },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'teams' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'race' } },
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
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'LiveStream' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'title' } },
          { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'thumbnailUrl' } },
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
        ],
      },
    },
  ],
} as unknown as DocumentNode<ChannelActivityQuery, ChannelActivityQueryVariables>
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
                { kind: 'Field', name: { kind: 'Name', value: 'gameTimeSeconds' } },
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
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
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
                                name: { kind: 'Name', value: 'GameConfigDataLobby' },
                              },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'teams' },
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        {
                                          kind: 'Field',
                                          name: { kind: 'Name', value: 'isComputer' },
                                        },
                                        {
                                          kind: 'Field',
                                          name: { kind: 'Name', value: 'user' },
                                          selectionSet: {
                                            kind: 'SelectionSet',
                                            selections: [
                                              {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'id' },
                                              },
                                              {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'name' },
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
                                    name: { kind: 'Name', value: 'teams' },
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        {
                                          kind: 'Field',
                                          name: { kind: 'Name', value: 'isComputer' },
                                        },
                                        {
                                          kind: 'Field',
                                          name: { kind: 'Name', value: 'user' },
                                          selectionSet: {
                                            kind: 'SelectionSet',
                                            selections: [
                                              {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'id' },
                                              },
                                              {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'name' },
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
                        },
                      },
                    ],
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'siblingReports' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'reason' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'details' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'gameTimeSeconds' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'resolution' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'reporter' },
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
export const ResolveSiblingReportsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'ResolveSiblingReports' },
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
            name: { kind: 'Name', value: 'resolveSiblingReports' },
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
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ResolveSiblingReportsMutation, ResolveSiblingReportsMutationVariables>
export const GameFeedbackDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GameFeedback' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'gameId' } },
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
            name: { kind: 'Name', value: 'gameFeedback' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'gameId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'gameId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'closesAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'given' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                    ],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'commendsRemaining' } },
                { kind: 'Field', name: { kind: 'Name', value: 'commendsAvailableAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'recentCommends' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'availableAt' } },
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
} as unknown as DocumentNode<GameFeedbackQuery, GameFeedbackQueryVariables>
export const CommendPlayerDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'CommendPlayer' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'gameId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'UUID' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'commendPlayer' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'gameId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'gameId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'feedback' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'closesAt' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'given' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                          ],
                        },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'commendsRemaining' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'commendsAvailableAt' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'recentCommends' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'availableAt' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'commendedUser' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'commendCount' } },
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
} as unknown as DocumentNode<CommendPlayerMutation, CommendPlayerMutationVariables>
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
            kind: 'Field',
            name: { kind: 'Name', value: 'currentRanks' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'seasonId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'points' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lifetimeGames' } },
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
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'Leagues_HomeFeedFragment' } },
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'News_HomeFeedFragment' } },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
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
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'translations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                { kind: 'Field', name: { kind: 'Name', value: 'message' } },
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
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'News_HomeFeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'newsPosts' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '10' },
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
                            { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'translations' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                                ],
                              },
                            },
                            { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'coverImageUrl' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'coverImageSmallUrl' } },
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
} as unknown as DocumentNode<HomePageContentQuery, HomePageContentQueryVariables>
export const HomePageLiveContentDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'HomePageLiveContent' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'LiveGames_FeedFragment' } },
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'LiveStreams_FeedFragment' } },
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
            kind: 'Field',
            name: { kind: 'Name', value: 'currentRanks' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'seasonId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'points' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lifetimeGames' } },
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
      name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'LiveStream' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'title' } },
          { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'thumbnailUrl' } },
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
      name: { kind: 'Name', value: 'LiveStreams_FeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'liveStreams' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<HomePageLiveContentQuery, HomePageLiveContentQueryVariables>
export const AdminMapFamilyReportsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminMapFamilyReports' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'status' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamilyReportStatus' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'limit' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'offset' } },
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
            name: { kind: 'Name', value: 'mapFamilyReports' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'status' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'status' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'limit' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'limit' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'offset' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'offset' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                { kind: 'Field', name: { kind: 'Name', value: 'fromPublish' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishAnswer' } },
                { kind: 'Field', name: { kind: 'Name', value: 'reportedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'files' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'map' },
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
                  name: { kind: 'Name', value: 'otherFamily' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'reportedBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'resolvedBy' },
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
} as unknown as DocumentNode<AdminMapFamilyReportsQuery, AdminMapFamilyReportsQueryVariables>
export const AdminMapFamilyReportCountsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminMapFamilyReportCounts' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'open' },
            name: { kind: 'Name', value: 'mapFamilyReportCount' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'status' },
                value: { kind: 'EnumValue', value: 'OPEN' },
              },
            ],
          },
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'resolved' },
            name: { kind: 'Name', value: 'mapFamilyReportCount' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'status' },
                value: { kind: 'EnumValue', value: 'RESOLVED' },
              },
            ],
          },
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'dismissed' },
            name: { kind: 'Name', value: 'mapFamilyReportCount' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'status' },
                value: { kind: 'EnumValue', value: 'DISMISSED' },
              },
            ],
          },
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'openClaims' },
            name: { kind: 'Name', value: 'mapOwnerClaimCount' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'status' },
                value: { kind: 'EnumValue', value: 'OPEN' },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AdminMapFamilyReportCountsQuery,
  AdminMapFamilyReportCountsQueryVariables
>
export const AdminMapOwnerClaimsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AdminMapOwnerClaims' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'limit' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'offset' } },
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
            name: { kind: 'Name', value: 'mapOwnerClaims' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'status' },
                value: { kind: 'EnumValue', value: 'OPEN' },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'limit' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'limit' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'offset' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'offset' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'claimant' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'owner' },
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
      },
    },
  ],
} as unknown as DocumentNode<AdminMapOwnerClaimsQuery, AdminMapOwnerClaimsQueryVariables>
export const AdminMapOwnerClaimGrantDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AdminMapOwnerClaimGrant' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'claimId' } },
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
            name: { kind: 'Name', value: 'mapOwnerClaimGrant' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'claimId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'claimId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'resolvedBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
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
      name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerSetAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AdminMapOwnerClaimGrantMutation,
  AdminMapOwnerClaimGrantMutationVariables
>
export const AdminMapOwnerClaimRejectDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AdminMapOwnerClaimReject' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'claimId' } },
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
            name: { kind: 'Name', value: 'mapOwnerClaimReject' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'claimId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'claimId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'resolvedBy' },
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
} as unknown as DocumentNode<
  AdminMapOwnerClaimRejectMutation,
  AdminMapOwnerClaimRejectMutationVariables
>
export const MapSearchTestMapsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapSearchTestMaps' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFilter' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapSort' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'maps' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'sort' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'after' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'edges' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'cursor' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'node' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'MapSearchTest_Map' },
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
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapSearchTest_Map' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapSearchTestMapsQuery, MapSearchTestMapsQueryVariables>
export const MapSearchTestLibraryDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapSearchTestLibrary' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFilter' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapSort' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'currentUser' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapLibrary' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'filter' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'sort' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'after' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'first' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
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
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'edges' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'cursor' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'addedAt' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'node' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'MapSearchTest_Map' },
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
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapSearchTest_Map' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapSearchTestLibraryQuery, MapSearchTestLibraryQueryVariables>
export const MapSearchTestFavoritesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapSearchTestFavorites' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFilter' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapSort' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'currentUser' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'favoriteMaps' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'filter' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'sort' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'after' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'first' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
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
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'edges' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'cursor' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'addedAt' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'node' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'MapSearchTest_Map' },
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
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapSearchTest_Map' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapSearchTestFavoritesQuery, MapSearchTestFavoritesQueryVariables>
export const MapSearchTestMapDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapSearchTestMap' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
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
                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'MapSearchTest_Map' } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapSearchTest_Map' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapSearchTestMapQuery, MapSearchTestMapQueryVariables>
export const MapSearchTestAddFavoriteDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapSearchTestAddFavorite' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapAddFavorite' },
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
                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'MapSearchTest_Map' } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapSearchTest_Map' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  MapSearchTestAddFavoriteMutation,
  MapSearchTestAddFavoriteMutationVariables
>
export const MapSearchTestRemoveFavoriteDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapSearchTestRemoveFavorite' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapRemoveFavorite' },
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
                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'MapSearchTest_Map' } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapSearchTest_Map' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  MapSearchTestRemoveFavoriteMutation,
  MapSearchTestRemoveFavoriteMutationVariables
>
export const MapSpawnsTestMapsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapSpawnsTestMaps' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'maps' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '100' },
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
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'file' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'imageSpawnsBaked' },
                                  },
                                  { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'startLocations' },
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'y' } },
                                      ],
                                    },
                                  },
                                  { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
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
      },
    },
  ],
} as unknown as DocumentNode<MapSpawnsTestMapsQuery, MapSpawnsTestMapsQueryVariables>
export const MapSpawnsTestMapDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapSpawnsTestMap' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'startLocations' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'y' } },
                          ],
                        },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
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
} as unknown as DocumentNode<MapSpawnsTestMapQuery, MapSpawnsTestMapQueryVariables>
export const LocalKnownMapDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'LocalKnownMap' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'hashes' } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NonNullType',
                type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
              },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapsByHash' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'hashes' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'hashes' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<LocalKnownMapQuery, LocalKnownMapQueryVariables>
export const MapCatalogAllDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapCatalogAll' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFilter' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapSort' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'withCount' } },
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
            name: { kind: 'Name', value: 'maps' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'sort' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'after' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'totalCount' },
                  directives: [
                    {
                      kind: 'Directive',
                      name: { kind: 'Name', value: 'include' },
                      arguments: [
                        {
                          kind: 'Argument',
                          name: { kind: 'Name', value: 'if' },
                          value: { kind: 'Variable', name: { kind: 'Name', value: 'withCount' } },
                        },
                      ],
                    },
                  ],
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'edges' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'cursor' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'node' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
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
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'trendingScore' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'umsForces' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'teamId' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'players' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'playerId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isComputer' } },
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
} as unknown as DocumentNode<MapCatalogAllQuery, MapCatalogAllQueryVariables>
export const MapCatalogLibraryDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapCatalogLibrary' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFilter' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapSort' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'withCount' } },
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
            name: { kind: 'Name', value: 'currentUser' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapLibrary' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'filter' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'sort' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'after' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'first' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'totalCount' },
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
                                  name: { kind: 'Name', value: 'withCount' },
                                },
                              },
                            ],
                          },
                        ],
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
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'edges' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'cursor' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'addedAt' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'node' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                  {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
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
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'trendingScore' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'umsForces' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'teamId' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'players' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'playerId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isComputer' } },
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
} as unknown as DocumentNode<MapCatalogLibraryQuery, MapCatalogLibraryQueryVariables>
export const MapCatalogFavoritesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapCatalogFavorites' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFilter' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapSort' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'withCount' } },
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
            name: { kind: 'Name', value: 'currentUser' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'favoriteMaps' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'filter' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'filter' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'sort' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'sort' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'after' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'first' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'totalCount' },
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
                                  name: { kind: 'Name', value: 'withCount' },
                                },
                              },
                            ],
                          },
                        ],
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
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'edges' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'cursor' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'node' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                  {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
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
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'trendingScore' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'umsForces' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'teamId' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'players' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'playerId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isComputer' } },
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
} as unknown as DocumentNode<MapCatalogFavoritesQuery, MapCatalogFavoritesQueryVariables>
export const MapCompareDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapCompare' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'a' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'b' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapComparison' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'a' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'a' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'b' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'b' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'changes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'terrainSimilarity' } },
                { kind: 'Field', name: { kind: 'Name', value: 'terrainChanges' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'startLocations' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'bases' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'beforeIndex' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'afterIndex' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'changed' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'a' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'FragmentSpread', name: { kind: 'Name', value: 'MapCompare_Side' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'b' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'FragmentSpread', name: { kind: 'Name', value: 'MapCompare_Side' } },
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
      name: { kind: 'Name', value: 'MapCompare_Side' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
                { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
                { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'startLocations' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'y' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'analysis' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'triggerCount' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'umsActionKinds' } },
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
} as unknown as DocumentNode<MapCompareQuery, MapCompareQueryVariables>
export const MapDefaultNudgeDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapDefaultNudge' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
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
} as unknown as DocumentNode<MapDefaultNudgeQuery, MapDefaultNudgeQueryVariables>
export const MapDelistDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapDelist' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'note' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapDelist' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'note' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'note' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'publisher' },
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
                  name: { kind: 'Name', value: 'moderation' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'delistedAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'delistedKind' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'delistedNote' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'delistedBy' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<MapDelistMutation, MapDelistMutationVariables>
export const MapFamilyActionFamilyDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapFamilyActionFamily' },
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
            name: { kind: 'Name', value: 'mapFamily' },
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFamilyAction_FamilyFragment' },
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
      name: { kind: 'Name', value: 'MapFamilyAction_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'current' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'defaultMap' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'files' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                { kind: 'Field', name: { kind: 'Name', value: 'firstSeenAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'stats' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
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
} as unknown as DocumentNode<MapFamilyActionFamilyQuery, MapFamilyActionFamilyQueryVariables>
export const MapFamilyActionSimilarDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapFamilyActionSimilar' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'similarFiles' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'similarity' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'map' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'MapFamilySearch_FamilyFragment' },
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
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFamilySearch_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'files' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'current' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
} as unknown as DocumentNode<MapFamilyActionSimilarQuery, MapFamilyActionSimilarQueryVariables>
export const MapFamilySplitFileDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilySplitFile' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFamilySplitFile' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
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
                  name: { kind: 'Name', value: 'previousFamily' },
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
} as unknown as DocumentNode<MapFamilySplitFileMutation, MapFamilySplitFileMutationVariables>
export const MapFamilyMoveFileDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilyMoveFile' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
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
            name: { kind: 'Name', value: 'mapFamilyMoveFile' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
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
                  name: { kind: 'Name', value: 'previousFamily' },
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
} as unknown as DocumentNode<MapFamilyMoveFileMutation, MapFamilyMoveFileMutationVariables>
export const MapFamilyMergeDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilyMerge' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'UUID' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'intoFamilyId' } },
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
            name: { kind: 'Name', value: 'mapFamilyMerge' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'intoFamilyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'intoFamilyId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapFamilyMergeMutation, MapFamilyMergeMutationVariables>
export const MapFamilyReportFamilyDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapFamilyReportFamily' },
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
            name: { kind: 'Name', value: 'mapFamily' },
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'owner' },
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
                        name: { kind: 'Name', value: 'files' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'firstSeenAt' } },
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
} as unknown as DocumentNode<MapFamilyReportFamilyQuery, MapFamilyReportFamilyQueryVariables>
export const MapFamilyReportDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilyReport' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamilyReportInput' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFamilyReport' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapFamilyReportMutation, MapFamilyReportMutationVariables>
export const MapFamilySearchDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapFamilySearch' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'search' } },
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
            name: { kind: 'Name', value: 'maps' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'search' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'search' } },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '6' },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'nodes' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'MapFamilySearch_FamilyFragment' },
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
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFamilySearch_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'files' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'current' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
} as unknown as DocumentNode<MapFamilySearchQuery, MapFamilySearchQueryVariables>
export const MapFamilySearchByIdDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapFamilySearchById' },
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
            name: { kind: 'Name', value: 'mapFamily' },
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFamilySearch_FamilyFragment' },
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
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFamilySearch_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'files' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'current' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
} as unknown as DocumentNode<MapFamilySearchByIdQuery, MapFamilySearchByIdQueryVariables>
export const MapAddFavoriteDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapAddFavorite' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapAddFavorite' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
                { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'files' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
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
} as unknown as DocumentNode<MapAddFavoriteMutation, MapAddFavoriteMutationVariables>
export const MapRemoveFavoriteDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapRemoveFavorite' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapRemoveFavorite' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
                { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'files' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'favoriteCount' } },
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
} as unknown as DocumentNode<MapRemoveFavoriteMutation, MapRemoveFavoriteMutationVariables>
export const LocalAddToLibraryDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'LocalAddToLibrary' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapAddToLibrary' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<LocalAddToLibraryMutation, LocalAddToLibraryMutationVariables>
export const MapFamilySetDefaultDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilySetDefault' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFamilySetDefault' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
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
                  name: { kind: 'Name', value: 'defaultMap' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'defaultSetAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'defaultSetBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<MapFamilySetDefaultMutation, MapFamilySetDefaultMutationVariables>
export const MapOwnerClaimDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapOwnerClaim' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'UUID' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'note' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapOwnerClaim' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'note' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'note' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'granted' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'claim' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
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
      name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerSetAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapOwnerClaimMutation, MapOwnerClaimMutationVariables>
export const MapOwnerRelinquishDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapOwnerRelinquish' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
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
            name: { kind: 'Name', value: 'mapOwnerRelinquish' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerSetAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapOwnerRelinquishMutation, MapOwnerRelinquishMutationVariables>
export const MapFamilyRemoveOwnerDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilyRemoveOwner' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
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
            name: { kind: 'Name', value: 'mapFamilyRemoveOwner' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerSetAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapFamilyRemoveOwnerMutation, MapFamilyRemoveOwnerMutationVariables>
export const MapOwnerEditFamilyDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapOwnerEditFamily' },
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
            name: { kind: 'Name', value: 'mapFamily' },
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
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
      name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerSetAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapOwnerEditFamilyQuery, MapOwnerEditFamilyQueryVariables>
export const MapFamilySetOwnerDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilySetOwner' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'UUID' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFamilySetOwner' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerSetAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapFamilySetOwnerMutation, MapFamilySetOwnerMutationVariables>
export const MapFamilySetCreditDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilySetCredit' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'UUID' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'credit' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFamilySetCredit' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'credit' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'credit' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapOwner_FamilyOwnerFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'ownerSetAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapFamilySetCreditMutation, MapFamilySetCreditMutationVariables>
export const MapOwnerAddFileLibraryDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapOwnerAddFileLibrary' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
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
            name: { kind: 'Name', value: 'currentUser' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'mapLibrary' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'sort' },
                      value: { kind: 'EnumValue', value: 'NEWEST' },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'after' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'first' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
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
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'edges' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'cursor' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'node' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'publisher' },
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                      ],
                                    },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'moderation' },
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
                                              name: { kind: 'Name', value: 'canManageMaps' },
                                            },
                                          },
                                        ],
                                      },
                                    ],
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        {
                                          kind: 'Field',
                                          name: { kind: 'Name', value: 'delistedKind' },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'family' },
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
                                        {
                                          kind: 'Field',
                                          name: { kind: 'Name', value: 'owner' },
                                          selectionSet: {
                                            kind: 'SelectionSet',
                                            selections: [
                                              {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'id' },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          kind: 'Field',
                                          name: { kind: 'Name', value: 'files' },
                                          selectionSet: {
                                            kind: 'SelectionSet',
                                            selections: [
                                              {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'id' },
                                              },
                                            ],
                                          },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'file' },
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                                        { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                                        {
                                          kind: 'FragmentSpread',
                                          name: {
                                            kind: 'Name',
                                            value: 'MapFileImage_FileFragment',
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
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapOwnerAddFileLibraryQuery, MapOwnerAddFileLibraryQueryVariables>
export const MapOwnerAddFileUploadedDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapOwnerAddFileUploaded' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
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
            name: { kind: 'Name', value: 'map' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'publisher' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'moderation' },
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
                            name: { kind: 'Name', value: 'canManageMaps' },
                          },
                        },
                      ],
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'delistedKind' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'owner' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'files' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapOwnerAddFileUploadedQuery, MapOwnerAddFileUploadedQueryVariables>
export const MapOwnerAddFileLinkDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapOwnerAddFileLink' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
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
            name: { kind: 'Name', value: 'mapFileLink' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'previousFamily' },
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
} as unknown as DocumentNode<MapOwnerAddFileLinkMutation, MapOwnerAddFileLinkMutationVariables>
export const MapOwnerAddFilePublishDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapOwnerAddFilePublish' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'answer' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapPublishAnswerInput' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapPublish' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'answer' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'answer' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'heldForReview' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'publisher' },
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
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
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
      },
    },
  ],
} as unknown as DocumentNode<
  MapOwnerAddFilePublishMutation,
  MapOwnerAddFilePublishMutationVariables
>
export const MapLiveGamesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapLiveGames' },
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
                  kind: 'Field',
                  name: { kind: 'Name', value: 'map' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
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
            kind: 'Field',
            name: { kind: 'Name', value: 'currentRanks' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'seasonId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'points' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lifetimeGames' } },
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
} as unknown as DocumentNode<MapLiveGamesQuery, MapLiveGamesQueryVariables>
export const MapPageFilesUnlinkDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapPageFilesUnlink' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFileUnlink' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'previousFamily' },
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
} as unknown as DocumentNode<MapPageFilesUnlinkMutation, MapPageFilesUnlinkMutationVariables>
export const MapMatchupsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapMatchups' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'matchmakingType' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'MatchmakingType' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'seasonId' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'matchups' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'matchmakingType' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'matchmakingType' } },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'seasonId' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'seasonId' } },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'matchup' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'games' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'leftWins' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rightWins' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'medianLength' } },
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
} as unknown as DocumentNode<MapMatchupsQuery, MapMatchupsQueryVariables>
export const MapPageFamilyDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapPageFamily' },
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
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
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
            name: { kind: 'Name', value: 'mapFamily' },
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'files' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'owner' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'ownerKind' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'credit' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapPageStats_FamilyFragment' },
                      },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapPageFiles_FamilyFragment' },
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
      name: { kind: 'Name', value: 'MapPageFiles_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'firstSeenAt' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageStats_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'players90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'medianLength90d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lastPlayedAt' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'weeklyActivity' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'weeks' },
                value: { kind: 'IntValue', value: '26' },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'weekStart' } },
                { kind: 'Field', name: { kind: 'Name', value: 'lobbyGames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingGames' } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageFiles_FamilyFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamily' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'current' },
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
            name: { kind: 'Name', value: 'defaultMap' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'defaultSetBy' },
            directives: [
              {
                kind: 'Directive',
                name: { kind: 'Name', value: 'include' },
                arguments: [
                  {
                    kind: 'Argument',
                    name: { kind: 'Name', value: 'if' },
                    value: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
                  },
                ],
              },
            ],
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
            name: { kind: 'Name', value: 'owner' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'files' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPageFiles_FileFragment' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPageFamilyQuery, MapPageFamilyQueryVariables>
export const MapPageFileDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapPageFile' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
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
            name: { kind: 'Name', value: 'map' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
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
                  name: { kind: 'Name', value: 'stats' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                      },
                    ],
                  },
                },
                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'MapPage_HeaderFragment' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPage_ActionsFragment' },
                },
                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'MapPage_FactsFragment' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPage_HowToPlayFragment' },
                },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPageMatchups_MapFragment' },
                },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPageFiles_FileFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPage_HeaderFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'description' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
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
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'originalName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'originalDescription' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'moderation' },
            directives: [
              {
                kind: 'Directive',
                name: { kind: 'Name', value: 'include' },
                arguments: [
                  {
                    kind: 'Argument',
                    name: { kind: 'Name', value: 'if' },
                    value: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delistedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delistedKind' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delistedNote' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'delistedBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
      name: { kind: 'Name', value: 'MapPage_ActionsFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'moderation' },
            directives: [
              {
                kind: 'Directive',
                name: { kind: 'Name', value: 'include' },
                arguments: [
                  {
                    kind: 'Argument',
                    name: { kind: 'Name', value: 'if' },
                    value: { kind: 'Variable', name: { kind: 'Name', value: 'canManageMaps' } },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delistedKind' } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPage_FactsFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'umsForces' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'teamId' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'players' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'playerId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isComputer' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'analysis' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'baseCount' } },
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
      name: { kind: 'Name', value: 'MapPage_HowToPlayFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'originalDescription' } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageMatchups_MapFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'matchupSeasons' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'seasonId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games' } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPageFiles_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'firstSeenAt' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPageFileQuery, MapPageFileQueryVariables>
export const MapPageRelistDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapPageRelist' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapRelist' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'publisher' },
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
                  name: { kind: 'Name', value: 'moderation' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'delistedAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'delistedKind' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'delistedNote' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'delistedBy' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<MapPageRelistMutation, MapPageRelistMutationVariables>
export const MapPageFileUnlinkDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapPageFileUnlink' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFileUnlink' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'previousFamily' },
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
} as unknown as DocumentNode<MapPageFileUnlinkMutation, MapPageFileUnlinkMutationVariables>
export const MapPageClaimPreviewDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapPageClaimPreview' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
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
            name: { kind: 'Name', value: 'mapOwnerClaimPreview' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'blockedReason' } },
                { kind: 'Field', name: { kind: 'Name', value: 'instant' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'openClaim' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'status' } },
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
} as unknown as DocumentNode<MapPageClaimPreviewQuery, MapPageClaimPreviewQueryVariables>
export const MapPublishPreviewDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapPublishPreview' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapPublishPreview' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPublish_PreviewFragment' },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'publisher' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                    ],
                  },
                },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPublish_FileFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPublish_SuggestionFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapPublishSuggestion' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'similarity' } },
          { kind: 'Field', name: { kind: 'Name', value: 'sameKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'triggerSimilarity' } },
          { kind: 'Field', name: { kind: 'Name', value: 'sameResources' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
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
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
      name: { kind: 'Name', value: 'MapPublish_PreviewFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapPublishPreview' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'blockedReason' } },
          { kind: 'Field', name: { kind: 'Name', value: 'needsReview' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'existingMap' },
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
            name: { kind: 'Name', value: 'suggestions' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPublish_SuggestionFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPublish_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapPublishPreviewQuery, MapPublishPreviewQueryVariables>
export const MapLinkSuggestionsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapLinkSuggestions' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapLinkSuggestions' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPublish_SuggestionFragment' },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'map' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapPublish_FileFragment' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapPublish_SuggestionFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapPublishSuggestion' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'similarity' } },
          { kind: 'Field', name: { kind: 'Name', value: 'sameKind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'triggerSimilarity' } },
          { kind: 'Field', name: { kind: 'Name', value: 'sameResources' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
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
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'FragmentSpread',
                        name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
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
      name: { kind: 'Name', value: 'MapPublish_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapLinkSuggestionsQuery, MapLinkSuggestionsQueryVariables>
export const MapPublishDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapPublish' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'answer' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapPublishAnswerInput' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapPublish' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'answer' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'answer' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'heldForReview' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'publisher' },
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
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
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
      },
    },
  ],
} as unknown as DocumentNode<MapPublishMutation, MapPublishMutationVariables>
export const MapFileLinkDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFileLink' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
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
            name: { kind: 'Name', value: 'mapFileLink' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'familyId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'familyId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'file' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'previousFamily' },
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
} as unknown as DocumentNode<MapFileLinkMutation, MapFileLinkMutationVariables>
export const MapPublishOwnedMapsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapPublishOwnedMaps' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'owner' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'maps' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'owner' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'owner' } },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'sort' },
                value: { kind: 'EnumValue', value: 'NAME' },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '100' },
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
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'family' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
      },
    },
  ],
} as unknown as DocumentNode<MapPublishOwnedMapsQuery, MapPublishOwnedMapsQueryVariables>
export const MapPublishReviewApproveDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapPublishReviewApprove' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'reportId' } },
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
            name: { kind: 'Name', value: 'mapPublishReviewApprove' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'reportId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'reportId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'resolvedBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'map' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'publisher' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<
  MapPublishReviewApproveMutation,
  MapPublishReviewApproveMutationVariables
>
export const MapReportBarSetDefaultDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapReportBarSetDefault' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFamilySetDefault' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
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
                  name: { kind: 'Name', value: 'defaultMap' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'defaultSetAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'defaultSetBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<
  MapReportBarSetDefaultMutation,
  MapReportBarSetDefaultMutationVariables
>
export const MapReportBarDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapReportBar' },
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
            name: { kind: 'Name', value: 'mapFamilyReportById' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
                { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                { kind: 'Field', name: { kind: 'Name', value: 'fromPublish' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishAnswer' } },
                { kind: 'Field', name: { kind: 'Name', value: 'reportedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'reportedBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'resolvedBy' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'family' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'files' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'owner' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'map' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'firstSeenAt' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'family' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'stats' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'otherFamily' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'current' },
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
      },
    },
  ],
} as unknown as DocumentNode<MapReportBarQuery, MapReportBarQueryVariables>
export const MapFamilyReportSetStatusDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapFamilyReportSetStatus' },
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
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'status' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFamilyReportStatus' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapFamilyReportSetStatus' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'status' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'status' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                { kind: 'Field', name: { kind: 'Name', value: 'resolvedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'resolvedBy' },
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
} as unknown as DocumentNode<
  MapFamilyReportSetStatusMutation,
  MapFamilyReportSetStatusMutationVariables
>
export const MapUnpublishDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapUnpublish' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapUnpublish' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'fileId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'fileId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'publisher' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<MapUnpublishMutation, MapUnpublishMutationVariables>
export const MapUploadKnownMapDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MapUploadKnownMap' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'hashes' } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NonNullType',
                type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
              },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapsByHash' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'hashes' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'hashes' } },
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
} as unknown as DocumentNode<MapUploadKnownMapQuery, MapUploadKnownMapQueryVariables>
export const MapUploadAddToLibraryDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'MapUploadAddToLibrary' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMapId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'mapAddToLibrary' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'inLibrary' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MapUploadAddToLibraryMutation, MapUploadAddToLibraryMutationVariables>
export const NewsArchiveDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'NewsArchive' },
      variableDefinitions: [
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
            name: { kind: 'Name', value: 'newsPosts' },
            arguments: [
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
                            { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'translations' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                                  { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                                ],
                              },
                            },
                            { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
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
} as unknown as DocumentNode<NewsArchiveQuery, NewsArchiveQueryVariables>
export const NewsUpdatePostDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'NewsUpdatePost' },
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
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'updates' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'NewsPostUpdates' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'newsUpdatePost' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'updates' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'updates' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                { kind: 'Field', name: { kind: 'Name', value: 'content' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'translations' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'summary' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'content' } },
                    ],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'coverImagePath' } },
                { kind: 'Field', name: { kind: 'Name', value: 'coverImageUrl' } },
                { kind: 'Field', name: { kind: 'Name', value: 'coverImageSmallUrl' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<NewsUpdatePostMutation, NewsUpdatePostMutationVariables>
export const NewsDeletePostDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'NewsDeletePost' },
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
            name: { kind: 'Name', value: 'newsDeletePost' },
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
} as unknown as DocumentNode<NewsDeletePostMutation, NewsDeletePostMutationVariables>
export const NewsPostDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'NewsPost' },
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
            name: { kind: 'Name', value: 'newsPost' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                { kind: 'Field', name: { kind: 'Name', value: 'content' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'translations' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'language' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'content' } },
                    ],
                  },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'coverImageUrl' } },
                { kind: 'Field', name: { kind: 'Name', value: 'coverImageSmallUrl' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'author' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
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
} as unknown as DocumentNode<NewsPostQuery, NewsPostQueryVariables>
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
export const ConnectionSettingsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'ConnectionSettings' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'myTwitchConnection' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchUserId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'linkedAt' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ConnectionSettingsQuery, ConnectionSettingsQueryVariables>
export const ConnectionSettingsStartTwitchLinkDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'ConnectionSettingsStartTwitchLink' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'desktop' } },
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
            name: { kind: 'Name', value: 'twitchStartLink' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'desktop' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'desktop' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'url' } }],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ConnectionSettingsStartTwitchLinkMutation,
  ConnectionSettingsStartTwitchLinkMutationVariables
>
export const ConnectionSettingsCompleteTwitchLinkDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'ConnectionSettingsCompleteTwitchLink' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'code' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'state' } },
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
            name: { kind: 'Name', value: 'twitchCompleteLink' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'code' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'code' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'state' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'state' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchUserId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'linkedAt' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ConnectionSettingsCompleteTwitchLinkMutation,
  ConnectionSettingsCompleteTwitchLinkMutationVariables
>
export const ConnectionSettingsUnlinkTwitchDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'ConnectionSettingsUnlinkTwitch' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'twitchUnlink' } }],
      },
    },
  ],
} as unknown as DocumentNode<
  ConnectionSettingsUnlinkTwitchMutation,
  ConnectionSettingsUnlinkTwitchMutationVariables
>
export const LiveUserIdsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'LiveUserIds' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'liveStreamUserIds' } }],
      },
    },
  ],
} as unknown as DocumentNode<LiveUserIdsQuery, LiveUserIdsQueryVariables>
export const BlockStreamDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'BlockStream' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'blockStream' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<BlockStreamMutation, BlockStreamMutationVariables>
export const UnblockStreamDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'UnblockStream' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'unblockStream' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<UnblockStreamMutation, UnblockStreamMutationVariables>
export const LiveStreamsPageDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'LiveStreamsPage' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'FragmentSpread', name: { kind: 'Name', value: 'LiveStreams_FeedFragment' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'LiveStream' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
          { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
          { kind: 'Field', name: { kind: 'Name', value: 'title' } },
          { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'thumbnailUrl' } },
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
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'LiveStreams_FeedFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Query' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'liveStreams' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'LiveStreams_FeedEntryFragment' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<LiveStreamsPageQuery, LiveStreamsPageQueryVariables>
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
export const AdminChangeUserDisplayNameDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'AdminChangeUserDisplayName' },
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
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'newName' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'grantToken' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Boolean' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'reason' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userAdminChangeDisplayName' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'newName' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'newName' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'grantToken' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'grantToken' } },
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
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AdminChangeUserDisplayNameMutation,
  AdminChangeUserDisplayNameMutationVariables
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
                { kind: 'Field', name: { kind: 'Name', value: 'useDevelopmentClient' } },
                { kind: 'Field', name: { kind: 'Name', value: 'banUsers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLeagues' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMapPools' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmaking' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageGameReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageSignupCodes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLiveStreams' } },
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
                { kind: 'Field', name: { kind: 'Name', value: 'useDevelopmentClient' } },
                { kind: 'Field', name: { kind: 'Name', value: 'banUsers' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLeagues' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMapPools' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmaking' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingTimes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageMatchmakingSeasons' } },
                { kind: 'Field', name: { kind: 'Name', value: 'massDeleteMaps' } },
                { kind: 'Field', name: { kind: 'Name', value: 'moderateChatChannels' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageNews' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageBugReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageGameReports' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageRestrictedNames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageSignupCodes' } },
                { kind: 'Field', name: { kind: 'Name', value: 'manageLiveStreams' } },
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
export const UserProfileOwnedMapsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'UserProfileOwnedMaps' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'owner' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'maps' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'owner' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'owner' } },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'sort' },
                value: { kind: 'EnumValue', value: 'NEWEST' },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'after' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'after' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'first' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
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
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'edges' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'cursor' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'node' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
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
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'MapFile' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image256Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image512Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image1024Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'image2048Url' } },
          { kind: 'Field', name: { kind: 'Name', value: 'imageSpawnsBaked' } },
          { kind: 'Field', name: { kind: 'Name', value: 'width' } },
          { kind: 'Field', name: { kind: 'Name', value: 'height' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'startLocations' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'slot' } },
                { kind: 'Field', name: { kind: 'Name', value: 'x' } },
                { kind: 'Field', name: { kind: 'Name', value: 'y' } },
              ],
            },
          },
          { kind: 'Field', name: { kind: 'Name', value: 'umsContent' } },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'MapTile_SbMapFragment' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'SbMap' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'kind' } },
          { kind: 'Field', name: { kind: 'Name', value: 'playerCount' } },
          { kind: 'Field', name: { kind: 'Name', value: 'staffPick' } },
          { kind: 'Field', name: { kind: 'Name', value: 'listed' } },
          { kind: 'Field', name: { kind: 'Name', value: 'publishedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'isFavorited' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'publisher' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'family' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'current' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'stats' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games7d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'games28d' } },
                { kind: 'Field', name: { kind: 'Name', value: 'gamesTotal' } },
                { kind: 'Field', name: { kind: 'Name', value: 'trendingScore' } },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'file' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'MapFileImage_FileFragment' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'width' } },
                { kind: 'Field', name: { kind: 'Name', value: 'height' } },
                { kind: 'Field', name: { kind: 'Name', value: 'tileset' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isEud' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'umsForces' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'teamId' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'players' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'playerId' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'isComputer' } },
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
} as unknown as DocumentNode<UserProfileOwnedMapsQuery, UserProfileOwnedMapsQueryVariables>
export const UserProfileOwnsMapsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'UserProfileOwnsMaps' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'owner' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'maps' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'owner' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'owner' } },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '1' },
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
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'cursor' } }],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<UserProfileOwnsMapsQuery, UserProfileOwnsMapsQueryVariables>
export const UserProfileOverlayLiveDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'UserProfileOverlayLive' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
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
                { kind: 'Field', name: { kind: 'Name', value: 'commendCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'liveStream' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
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
} as unknown as DocumentNode<UserProfileOverlayLiveQuery, UserProfileOverlayLiveQueryVariables>
export const UserRankedModesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'UserRankedModes' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userRankedModes' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'totalGames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'wins' } },
                { kind: 'Field', name: { kind: 'Name', value: 'losses' } },
                { kind: 'Field', name: { kind: 'Name', value: 'rating' } },
                { kind: 'Field', name: { kind: 'Name', value: 'delta' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<UserRankedModesQuery, UserRankedModesQueryVariables>
export const UserRatingHistoryDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'UserRatingHistory' },
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
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'matchmakingType' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'MatchmakingType' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'userRatingHistory' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'userId' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'matchmakingType' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'matchmakingType' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'matchmakingType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'totalGames' } },
                { kind: 'Field', name: { kind: 'Name', value: 'downsampled' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'points' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'changeDate' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'rating' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'points' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'seasonId' } },
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
} as unknown as DocumentNode<UserRatingHistoryQuery, UserRatingHistoryQueryVariables>
export const UserProfileHeaderDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'UserProfileHeader' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'userId' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'SbUserId' } },
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
                { kind: 'Field', name: { kind: 'Name', value: 'commendCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'twitchChannel' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'twitchDisplayName' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'liveStream' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'twitchLogin' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'title' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'gameName' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'viewerCount' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'thumbnailUrl' } },
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
} as unknown as DocumentNode<UserProfileHeaderQuery, UserProfileHeaderQueryVariables>
