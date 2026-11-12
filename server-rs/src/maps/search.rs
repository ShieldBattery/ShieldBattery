//! Searching, filtering and keyset-paginated listing of maps.
//!
//! Every listing is one statement built by [`MapSearchRepo::load_page`]. Sorts are expressed as a
//! list of keys that are compared as a single ascending row value (numeric keys that sort
//! descending are negated), so the `ORDER BY` and the cursor comparison always come from the same
//! list and can't disagree.

use async_graphql::{Enum, InputObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use data_encoding::HEXLOWER;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgRow;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder, Row};
use uuid::Uuid;

use crate::maps::{MapHash, SbMapId};
use crate::users::SbUserId;

pub const DEFAULT_PAGE_SIZE: usize = 40;
pub const MAX_PAGE_SIZE: usize = 100;
/// The longest search string accepted, in characters.
pub const MAX_SEARCH_LENGTH: usize = 200;
/// Normalized queries with fewer characters than this (not counting spaces) don't use fuzzy
/// matching: they have too few trigrams for similarity to mean anything.
const FUZZY_MIN_CHARS: usize = 4;
/// The minimum `word_similarity` for a fuzzy match.
const FUZZY_THRESHOLD: f64 = 0.5;
const CURSOR_VERSION: u32 = 1;

/// Which kind of maps to show.
#[derive(Enum, Copy, Clone, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum MapLens {
    /// Every map.
    #[default]
    All,
    /// Maps meant for regular melee games.
    Melee,
    /// Use Map Settings maps: custom games, scenarios and other non-melee maps.
    Ums,
}

/// A size class, by the larger of a map's width and height (in tiles).
#[derive(
    Enum, Copy, Clone, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize,
)]
pub enum MapSizeClass {
    /// Up to 64.
    Tiny,
    /// 65 to 96.
    Small,
    /// 97 to 128.
    Medium,
    /// 129 to 192.
    Large,
    /// Larger than 192.
    Huge,
}

impl MapSizeClass {
    /// The (exclusive lower, inclusive upper) bounds of this class's larger dimension.
    fn bounds(self) -> (Option<i32>, Option<i32>) {
        match self {
            MapSizeClass::Tiny => (None, Some(64)),
            MapSizeClass::Small => (Some(64), Some(96)),
            MapSizeClass::Medium => (Some(96), Some(128)),
            MapSizeClass::Large => (Some(128), Some(192)),
            MapSizeClass::Huge => (Some(192), None),
        }
    }
}

/// How to treat maps that use EUD triggers.
#[derive(Enum, Copy, Clone, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum EudFilter {
    /// Include EUD maps.
    #[default]
    Any,
    /// Leave EUD maps out.
    Exclude,
    /// Only show EUD maps.
    Only,
}

/// The order maps are listed in.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum MapSort {
    /// Best search matches first, then the most played in the last 28 days. Without a search, the
    /// same as `POPULAR_28D`.
    Relevance,
    /// Maps whose lobby play is rising fastest first, then the most played in the last 28 days.
    Trending,
    /// Most games in the last 7 days first.
    #[graphql(name = "POPULAR_7D")]
    Popular7d,
    /// Most games in the last 28 days first.
    #[graphql(name = "POPULAR_28D")]
    Popular28d,
    /// Most games in the last 90 days first.
    #[graphql(name = "POPULAR_90D")]
    Popular90d,
    /// Most games ever first.
    PopularAllTime,
    /// Most recently published (or, in a user's maps, favorites or a collection, most recently
    /// added) first.
    Newest,
    /// Most favorited first.
    MostFavorited,
    /// Alphabetical, ignoring leading player-count prefixes and bracketed tags.
    Name,
    /// Fewest player slots first.
    Players,
    /// A collection's own order: as its editor arranged it, or for a Starred collection, the most
    /// recently starred first. The default when listing a collection's maps; any other listing
    /// treats it as its own default sort.
    CollectionOrder,
}

/// Filters for map listings. Every filter that is set must match.
#[derive(InputObject, Clone, Debug, Default)]
pub struct MapFilter {
    /// Text to search for in map names (curated and original) and descriptions. Case,
    /// punctuation and spacing are ignored, and longer queries tolerate small typos.
    pub search: Option<String>,
    #[graphql(default)]
    pub lens: MapLens,
    /// Exact player counts to include.
    pub players: Option<Vec<i32>>,
    /// Only maps with at least this many player slots.
    pub min_players: Option<i32>,
    pub sizes: Option<Vec<MapSizeClass>>,
    /// Tileset ids to include.
    pub tilesets: Option<Vec<i32>>,
    #[graphql(default)]
    pub eud: EudFilter,
    /// Only maps published at or after this time.
    pub published_since: Option<DateTime<Utc>>,
    /// Only staff picks (`true`) or only maps that aren't staff picks (`false`).
    pub staff_pick: Option<bool>,
    /// Only maps (families) this user owns.
    pub owner: Option<SbUserId>,
    /// Only verified maps (`true`): staff picks, and maps whose ownership staff granted. With
    /// `false`, only the other maps.
    pub verified: Option<bool>,
}

/// Which set of maps a listing pages through.
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum MapScope {
    /// Every family with a listed file, each as its current file. Filters apply to the current
    /// file, except that a search matches any of the family's listed files and `publishedSince`
    /// matches the family's most recently published file.
    Listed,
    /// A user's library, listed or not.
    Library(SbUserId),
    /// The families a user has favorited (the maps in their Starred collection), listed or not,
    /// each as its current file.
    Favorites(SbUserId),
    /// The maps in a collection: each map entry as its map's current file, each exact-file entry
    /// as that file. With `listed_only`, only the entries whose map is listed.
    Collection { id: Uuid, listed_only: bool },
}

impl MapScope {
    fn cursor_tag(self) -> String {
        match self {
            MapScope::Listed => "listed".to_string(),
            MapScope::Library(user_id) => format!("library:{user_id}"),
            MapScope::Favorites(user_id) => format!("favorites:{user_id}"),
            MapScope::Collection { id, listed_only } => {
                format!(
                    "collection:{id}:{}",
                    if listed_only { "listed" } else { "all" }
                )
            }
        }
    }

    /// The sort used when none is requested, or when `CollectionOrder` is requested outside a
    /// collection.
    fn default_sort(self, filter: &NormalizedFilter) -> MapSort {
        match self {
            MapScope::Collection { .. } => MapSort::CollectionOrder,
            _ => filter.default_sort(),
        }
    }
}

/// Normalizes text for searching. This must produce the same output as the SQL function
/// `map_search_normalize`, which builds the stored search columns: lowercase, every run of
/// non-alphanumeric characters becomes one space, and leading/trailing spaces are trimmed.
pub fn normalize_search(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    // Postgres lowercases one character to one character. The only character whose Unicode
    // lowercase mapping is longer (U+0130, dotted capital I) maps to `i` plus a combining dot, and
    // that first character is what Postgres produces.
    for c in text.chars().filter_map(|c| c.to_lowercase().next()) {
        if is_search_alnum(c) {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
        } else {
            pending_space = true;
        }
    }
    out
}

/// Whether `c` is in Postgres's `[:alnum:]` class under the glibc `en_US.utf8` locale the database
/// uses: letters of every script (including Hangul, Han and kana, and letter-like numerals such as
/// `Ⅳ`) and decimal digits, but not other numeric symbols such as superscripts, fractions and
/// circled numbers.
fn is_search_alnum(c: char) -> bool {
    c.is_alphabetic() || (c.is_numeric() && !is_other_number(c))
}

/// Whether `c` is in Unicode's "Other Number" (No) category, which glibc doesn't count as
/// alphanumeric. Only covers the Basic Multilingual Plane, where map names live in practice.
fn is_other_number(c: char) -> bool {
    const RANGES: &[(char, char)] = &[
        ('\u{00B2}', '\u{00B3}'),
        ('\u{00B9}', '\u{00B9}'),
        ('\u{00BC}', '\u{00BE}'),
        ('\u{09F4}', '\u{09F9}'),
        ('\u{0B72}', '\u{0B77}'),
        ('\u{0BF0}', '\u{0BF2}'),
        ('\u{0C78}', '\u{0C7E}'),
        ('\u{0D58}', '\u{0D5E}'),
        ('\u{0D70}', '\u{0D78}'),
        ('\u{0F2A}', '\u{0F33}'),
        ('\u{1369}', '\u{137C}'),
        ('\u{17F0}', '\u{17F9}'),
        ('\u{19DA}', '\u{19DA}'),
        ('\u{2070}', '\u{2070}'),
        ('\u{2074}', '\u{2079}'),
        ('\u{2080}', '\u{2089}'),
        ('\u{2150}', '\u{215F}'),
        ('\u{2189}', '\u{2189}'),
        ('\u{2460}', '\u{249B}'),
        ('\u{24EA}', '\u{24FF}'),
        ('\u{2776}', '\u{2793}'),
        ('\u{2CFD}', '\u{2CFD}'),
        ('\u{3192}', '\u{3195}'),
        ('\u{3220}', '\u{3229}'),
        ('\u{3248}', '\u{324F}'),
        ('\u{3251}', '\u{325F}'),
        ('\u{3280}', '\u{3289}'),
        ('\u{32B1}', '\u{32BF}'),
        ('\u{A830}', '\u{A835}'),
    ];
    RANGES
        .iter()
        .any(|&(start, end)| (start..=end).contains(&c))
}

/// A normalized search query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchQuery {
    normalized: String,
}

impl SearchQuery {
    /// Returns `None` if nothing searchable is left after normalization.
    pub fn new(raw: &str) -> Option<Self> {
        let normalized = normalize_search(raw);
        if normalized.is_empty() {
            None
        } else {
            Some(Self { normalized })
        }
    }

    pub fn normalized(&self) -> &str {
        &self.normalized
    }

    fn tokens(&self) -> impl Iterator<Item = &str> {
        self.normalized.split(' ')
    }

    fn compact(&self) -> String {
        self.normalized.replace(' ', "")
    }

    fn is_fuzzy(&self) -> bool {
        self.normalized.chars().filter(|&c| c != ' ').count() >= FUZZY_MIN_CHARS
    }
}

/// A [`MapFilter`] reduced to what affects the results, so equivalent filters behave (and hash)
/// identically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NormalizedFilter {
    #[serde(serialize_with = "serialize_search")]
    search: Option<SearchQuery>,
    lens: MapLens,
    players: Vec<i32>,
    min_players: Option<i32>,
    sizes: Vec<MapSizeClass>,
    tilesets: Vec<i32>,
    eud: EudFilter,
    published_since: Option<DateTime<Utc>>,
    staff_pick: Option<bool>,
    owner: Option<SbUserId>,
    verified: Option<bool>,
}

fn serialize_search<S: serde::Serializer>(
    search: &Option<SearchQuery>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    search
        .as_ref()
        .map(|s| s.normalized.as_str())
        .serialize(serializer)
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MapListingError {
    #[error("search must be at most {MAX_SEARCH_LENGTH} characters")]
    SearchTooLong,
    #[error("invalid cursor")]
    InvalidCursor,
    #[error("cursor does not match this query; start again without `after`")]
    CursorMismatch,
}

fn sorted_dedup<T: Ord>(values: Option<Vec<T>>) -> Vec<T> {
    let mut values = values.unwrap_or_default();
    values.sort();
    values.dedup();
    values
}

impl NormalizedFilter {
    pub fn new(filter: MapFilter) -> Result<Self, MapListingError> {
        let search = match filter.search.as_deref() {
            Some(s) if s.chars().count() > MAX_SEARCH_LENGTH => {
                return Err(MapListingError::SearchTooLong);
            }
            Some(s) => SearchQuery::new(s),
            None => None,
        };
        Ok(Self {
            search,
            lens: filter.lens,
            players: sorted_dedup(filter.players),
            min_players: filter.min_players,
            sizes: sorted_dedup(filter.sizes),
            tilesets: sorted_dedup(filter.tilesets),
            eud: filter.eud,
            published_since: filter.published_since,
            staff_pick: filter.staff_pick,
            owner: filter.owner,
            verified: filter.verified,
        })
    }

    /// The sort used when none is requested.
    pub fn default_sort(&self) -> MapSort {
        if self.search.is_some() {
            MapSort::Relevance
        } else {
            MapSort::Popular28d
        }
    }

    /// A hash of everything that determines which rows a listing contains, so a cursor can only
    /// continue the listing it came from.
    fn listing_hash(&self, scope: MapScope) -> String {
        let json = serde_json::to_vec(&(scope.cursor_tag(), self))
            .expect("normalized filters are always serializable");
        let digest = Sha256::digest(&json);
        HEXLOWER.encode(&digest[..16])
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
enum KeyKind {
    /// Bound and read as `bigint`.
    Int,
    Text,
    Uuid,
}

/// One component of a sort's row value. `expr` is evaluated over the candidate rows (aliased `c`)
/// and sorts ascending.
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
struct SortKey {
    expr: &'static str,
    kind: KeyKind,
}

const fn int_key(expr: &'static str) -> SortKey {
    SortKey {
        expr,
        kind: KeyKind::Int,
    }
}

const SORT_NAME: SortKey = SortKey {
    expr: "c.sort_name",
    kind: KeyKind::Text,
};
const ID: SortKey = SortKey {
    expr: "c.id",
    kind: KeyKind::Uuid,
};

fn sort_keys(sort: MapSort) -> &'static [SortKey] {
    const RELEVANCE: &[SortKey] = &[
        int_key("-c.rank"),
        int_key("-c.sort_games_28d"),
        SORT_NAME,
        ID,
    ];
    const TRENDING: &[SortKey] = &[
        int_key("-c.sort_trending_score"),
        int_key("-c.sort_games_28d"),
        SORT_NAME,
        ID,
    ];
    const POPULAR_7D: &[SortKey] = &[
        int_key("-c.sort_games_7d"),
        int_key("-c.sort_players_90d"),
        SORT_NAME,
        ID,
    ];
    const POPULAR_28D: &[SortKey] = &[
        int_key("-c.sort_games_28d"),
        int_key("-c.sort_players_90d"),
        SORT_NAME,
        ID,
    ];
    const POPULAR_90D: &[SortKey] = &[
        int_key("-c.sort_games_90d"),
        int_key("-c.sort_players_90d"),
        SORT_NAME,
        ID,
    ];
    const POPULAR_ALL_TIME: &[SortKey] = &[
        int_key("-c.sort_games_total"),
        int_key("-c.sort_players_90d"),
        SORT_NAME,
        ID,
    ];
    // Rows without a usable time sort after every dated row.
    const NEWEST_FIRST: SortKey = int_key(
        "CASE WHEN c.added_at IS NULL THEN 9223372036854775807 \
         ELSE -(extract(epoch FROM c.added_at) * 1000000) END",
    );
    const NEWEST: &[SortKey] = &[NEWEST_FIRST, ID];
    // Positions are unique within a collection except in a Starred one, where every entry has
    // position 0 and the newest is first.
    const COLLECTION_ORDER: &[SortKey] = &[int_key("c.sort_position"), NEWEST_FIRST, ID];
    const MOST_FAVORITED: &[SortKey] = &[
        int_key("-c.sort_favorites"),
        int_key("-c.sort_games_28d"),
        SORT_NAME,
        ID,
    ];
    const NAME: &[SortKey] = &[SORT_NAME, ID];
    const PLAYERS: &[SortKey] = &[int_key("c.player_count"), SORT_NAME, ID];

    match sort {
        MapSort::Relevance => RELEVANCE,
        MapSort::Trending => TRENDING,
        MapSort::Popular7d => POPULAR_7D,
        MapSort::Popular28d => POPULAR_28D,
        MapSort::Popular90d => POPULAR_90D,
        MapSort::PopularAllTime => POPULAR_ALL_TIME,
        MapSort::Newest => NEWEST,
        MapSort::MostFavorited => MOST_FAVORITED,
        MapSort::Name => NAME,
        MapSort::Players => PLAYERS,
        MapSort::CollectionOrder => COLLECTION_ORDER,
    }
}

/// A sort key's value, as carried in a cursor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CursorValue {
    Int(i64),
    Text(String),
}

/// The position after which a listing continues: the sort key values of the last row returned,
/// plus what is needed to check that the cursor belongs to the listing it is used with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapCursor {
    v: u32,
    sort: MapSort,
    keys: Vec<CursorValue>,
    /// [`NormalizedFilter::listing_hash`] of the listing this cursor came from.
    q: String,
}

/// A cursor's key values, checked against a sort's key list and ready to bind.
#[derive(Debug, Clone, PartialEq)]
enum BoundKey {
    Int(i64),
    Text(String),
    Uuid(Uuid),
}

impl MapCursor {
    /// Checks that this cursor continues the listing described by `sort` and `listing_hash`,
    /// returning its keys typed for binding.
    fn validate(
        &self,
        sort: MapSort,
        listing_hash: &str,
    ) -> Result<Vec<BoundKey>, MapListingError> {
        if self.v != CURSOR_VERSION || self.sort != sort || self.q != listing_hash {
            return Err(MapListingError::CursorMismatch);
        }
        let keys = sort_keys(sort);
        if keys.len() != self.keys.len() {
            return Err(MapListingError::InvalidCursor);
        }
        keys.iter()
            .zip(self.keys.iter())
            .map(|(key, value)| match (key.kind, value) {
                (KeyKind::Int, CursorValue::Int(v)) => Ok(BoundKey::Int(*v)),
                (KeyKind::Text, CursorValue::Text(v)) => Ok(BoundKey::Text(v.clone())),
                (KeyKind::Uuid, CursorValue::Text(v)) => v
                    .parse()
                    .map(BoundKey::Uuid)
                    .map_err(|_| MapListingError::InvalidCursor),
                _ => Err(MapListingError::InvalidCursor),
            })
            .collect()
    }
}

/// Whether the map (family) that `m` is in is a staff pick: Staff picks holds the map, or one of its
/// files. Must agree with the SQL function `map_family_is_staff_pick`, which Node and the legacy
/// `MapVisibility` of a file use. Listings use this inline form instead: the subquery doesn't refer
/// to `m`, so the planner runs it once per query (as a semi-join or a hashed subplan) rather than
/// once per row. Neither branch yields NULL, so `NOT` of it is never NULL either.
macro_rules! staff_pick_sql {
    () => {
        "m.family_id IN (\
         SELECT spm.family_id FROM collection_maps spm \
         JOIN collections spc ON spc.id = spm.collection_id AND spc.grants_staff_pick \
         WHERE spm.family_id IS NOT NULL \
         UNION ALL \
         SELECT spf.family_id FROM collection_maps spm \
         JOIN collections spc ON spc.id = spm.collection_id AND spc.grants_staff_pick \
         JOIN maps spf ON spf.id = spm.map_id)"
    };
}

/// See [`staff_pick_sql`].
const STAFF_PICK: &str = staff_pick_sql!();

/// The columns of [`DbSbMap`], read from `maps m` joined with [`DB_SB_MAP_JOINS`].
const DB_SB_MAP_COLUMNS: &str = concat!(
    "m.id, m.hash, m.name, m.family_id, \
    COALESCE(m.public_description, m.description) AS description, \
    m.kind::text AS kind, m.player_count, m.listed, ",
    staff_pick_sql!(),
    " AS staff_pick, \
    m.published_by, m.published_at, m.delisted_by, m.delisted_at, m.delisted_kind,     m.delisted_note, \
    s.map_id IS NOT NULL AS has_stats, \
    COALESCE(s.games_7d, 0) AS games_7d, \
    COALESCE(s.games_28d, 0) AS games_28d, \
    COALESCE(s.games_90d, 0) AS games_90d, \
    COALESCE(s.games_total, 0) AS games_total, \
    COALESCE(s.players_90d, 0) AS players_90d, \
    s.median_length_90d, s.last_played_at, \
    COALESCE(s.trending_score, 0) AS trending_score, \
    COALESCE(f.favorites, 0) AS favorites, m.first_seen_at"
);

/// The joins [`DB_SB_MAP_COLUMNS`] reads from, after `FROM maps m`.
const DB_SB_MAP_JOINS: &str = " LEFT JOIN map_stats s ON s.map_id = m.id \
    LEFT JOIN map_favorite_counts f ON f.family_id = m.family_id";

/// A map row as listings and the map loader read it: the map's own columns plus its play stats
/// and its family's favorite count.
#[derive(Debug, Clone, FromRow)]
pub struct DbSbMap {
    pub id: SbMapId,
    pub hash: MapHash,
    pub name: String,
    pub family_id: Uuid,
    pub description: String,
    pub kind: String,
    pub player_count: i32,
    pub listed: bool,
    /// Whether the map's family is in Staff picks.
    pub staff_pick: bool,
    /// Who most recently listed the map, kept after it is delisted.
    pub published_by: Option<SbUserId>,
    /// When the map was most recently listed, kept after it is delisted.
    pub published_at: Option<DateTime<Utc>>,
    pub delisted_by: Option<SbUserId>,
    pub delisted_at: Option<DateTime<Utc>>,
    /// `publisher` or `staff`, set exactly while the map is delisted.
    pub delisted_kind: Option<String>,
    pub delisted_note: Option<String>,
    pub has_stats: bool,
    pub games_7d: i32,
    pub games_28d: i32,
    pub games_90d: i32,
    pub games_total: i32,
    pub players_90d: i32,
    pub median_length_90d: Option<i32>,
    pub last_played_at: Option<DateTime<Utc>>,
    pub trending_score: i32,
    pub favorites: i32,
    pub first_seen_at: DateTime<Utc>,
}

/// One row of a listing page.
#[derive(Debug, Clone)]
pub struct MapListingRow {
    pub map: DbSbMap,
    /// When the map was added to the library or favorites being listed (for listed maps, when its
    /// family's most recently published file was published). `None` if that isn't known.
    pub added_at: Option<DateTime<Utc>>,
    pub cursor: MapCursor,
}

#[derive(Debug, Clone)]
pub struct MapListingPage {
    pub rows: Vec<MapListingRow>,
    pub has_next_page: bool,
}

/// A validated listing request.
#[derive(Debug, Clone)]
pub struct MapListingRequest {
    scope: MapScope,
    filter: NormalizedFilter,
    sort: MapSort,
    after: Option<Vec<BoundKey>>,
    listing_hash: String,
    count: usize,
}

impl MapListingRequest {
    pub fn new(
        scope: MapScope,
        filter: Option<MapFilter>,
        sort: Option<MapSort>,
        after: Option<&str>,
        first: Option<i32>,
    ) -> Result<Self, MapListingError> {
        use async_graphql::connection::{CursorType, OpaqueCursor};

        let filter = NormalizedFilter::new(filter.unwrap_or_default())?;
        let sort = match sort {
            Some(MapSort::CollectionOrder) | None => scope.default_sort(&filter),
            Some(sort) => sort,
        };
        let listing_hash = filter.listing_hash(scope);
        let after = after
            .map(|after| {
                OpaqueCursor::<MapCursor>::decode_cursor(after)
                    .map_err(|_| MapListingError::InvalidCursor)?
                    .validate(sort, &listing_hash)
            })
            .transpose()?;
        let count = first
            .map(|f| f.clamp(1, MAX_PAGE_SIZE as i32) as usize)
            .unwrap_or(DEFAULT_PAGE_SIZE);

        Ok(Self {
            scope,
            filter,
            sort,
            after,
            listing_hash,
            count,
        })
    }

    pub fn has_cursor(&self) -> bool {
        self.after.is_some()
    }

    fn build_query(&self) -> QueryBuilder<Postgres> {
        let mut qb = QueryBuilder::new("SELECT * FROM (SELECT c.*");
        let keys = sort_keys(self.sort);
        push_key_columns(&mut qb, keys);
        qb.push(" FROM (");
        push_rows(&mut qb, self.scope, &self.filter);
        qb.push(") c) p");
        push_sort_keys(&mut qb, keys, self.after.as_deref());
        qb.push(" LIMIT ");
        qb.push_bind((self.count + 1) as i64);
        qb
    }

    /// Counts every row of the listing, ignoring the cursor and page size.
    fn build_count_query(&self) -> QueryBuilder<Postgres> {
        let mut qb = QueryBuilder::new("SELECT count(*) FROM (");
        push_rows(&mut qb, self.scope, &self.filter);
        qb.push(") c");
        qb
    }

    fn cursor_for(&self, row: &PgRow) -> Result<MapCursor, sqlx::Error> {
        let keys = sort_keys(self.sort)
            .iter()
            .enumerate()
            .map(|(i, key)| {
                let alias = key_alias(i);
                Ok(match key.kind {
                    KeyKind::Int => CursorValue::Int(row.try_get::<i64, _>(alias.as_str())?),
                    KeyKind::Text => CursorValue::Text(row.try_get::<String, _>(alias.as_str())?),
                    KeyKind::Uuid => {
                        CursorValue::Text(row.try_get::<Uuid, _>(alias.as_str())?.to_string())
                    }
                })
            })
            .collect::<Result<_, sqlx::Error>>()?;
        Ok(MapCursor {
            v: CURSOR_VERSION,
            sort: self.sort,
            keys,
            q: self.listing_hash.clone(),
        })
    }
}

fn key_alias(index: usize) -> String {
    format!("k{index}")
}

/// Selects each sort key's value as `k0`, `k1`, ... so the cursor carries exactly the values the
/// database compared.
fn push_key_columns(qb: &mut QueryBuilder<Postgres>, keys: &[SortKey]) {
    for (i, key) in keys.iter().enumerate() {
        qb.push(", (");
        qb.push(key.expr);
        qb.push(")");
        if key.kind == KeyKind::Int {
            qb.push("::bigint");
        }
        qb.push(" AS ");
        qb.push(key_alias(i));
    }
}

/// Emits the cursor comparison (if continuing after a cursor) and the `ORDER BY`, both over the
/// same key list. `after` must come from [`MapCursor::validate`] for the same keys.
fn push_sort_keys(qb: &mut QueryBuilder<Postgres>, keys: &[SortKey], after: Option<&[BoundKey]>) {
    let aliases = (0..keys.len())
        .map(key_alias)
        .collect::<Vec<_>>()
        .join(", ");
    if let Some(after) = after {
        qb.push(" WHERE (");
        qb.push(&aliases);
        qb.push(") > (");
        for (i, value) in after.iter().enumerate() {
            if i > 0 {
                qb.push(", ");
            }
            match value {
                BoundKey::Int(v) => qb.push_bind(*v).push("::bigint"),
                BoundKey::Text(v) => qb.push_bind(v.clone()).push("::text"),
                BoundKey::Uuid(v) => qb.push_bind(*v).push("::uuid"),
            };
        }
        qb.push(")");
    }
    qb.push(" ORDER BY ");
    qb.push(&aliases);
}

/// Emits the listing's rows, before sorting: the candidates that match the search.
fn push_rows(qb: &mut QueryBuilder<Postgres>, scope: MapScope, filter: &NormalizedFilter) {
    qb.push("SELECT c.* FROM (");
    push_candidates(qb, scope, filter);
    qb.push(") c");
    if filter.search.is_some() {
        qb.push(" WHERE c.rank > 0");
    }
}

/// The columns sort keys read, from the file's own stats and its family's favorites.
const MAP_SORT_COLUMNS: &str = "COALESCE(s.games_7d, 0) AS sort_games_7d, \
    COALESCE(s.games_28d, 0) AS sort_games_28d, \
    COALESCE(s.games_90d, 0) AS sort_games_90d, \
    COALESCE(s.games_total, 0) AS sort_games_total, \
    COALESCE(s.players_90d, 0) AS sort_players_90d, \
    COALESCE(s.trending_score, 0) AS sort_trending_score, \
    COALESCE(f.favorites, 0) AS sort_favorites";

/// The columns sort keys read for a family shown as its current file: the family's stats, falling
/// back to the file's own for families of one file (or too new to have stats). Reads
/// [`FAMILY_JOINS`].
const FAMILY_SORT_COLUMNS: &str = "COALESCE(fs.games_7d, s.games_7d, 0) AS sort_games_7d, \
    COALESCE(fs.games_28d, s.games_28d, 0) AS sort_games_28d, \
    COALESCE(fs.games_90d, s.games_90d, 0) AS sort_games_90d, \
    COALESCE(fs.games_total, s.games_total, 0) AS sort_games_total, \
    COALESCE(fs.players_90d, s.players_90d, 0) AS sort_players_90d, \
    COALESCE(fs.trending_score, s.trending_score, 0) AS sort_trending_score, \
    COALESCE(f.favorites, 0) AS sort_favorites";

/// The joins of a listing of families, each as its current file `m`: the family `fam` and its
/// stats `fs`.
const FAMILY_JOINS: &str = " JOIN map_families fam ON fam.id = m.family_id \
    AND fam.current_map_id = m.id \
    LEFT JOIN map_family_stats fs ON fs.family_id = fam.id";

/// When a listed family's most recently published file was published.
const FAMILY_PUBLISHED_AT: &str = "(SELECT max(lm.published_at) FROM maps lm \
    WHERE lm.family_id = fam.id AND lm.listed)";

/// The joins of a collection's maps, after `FROM collection_maps cm`: the map `m` each entry shows
/// (its map's current file, or its exact file), that file's family `fam`, and for map entries the
/// family's stats `fs`. Exact-file entries have no `fs`, so their sort columns read the file's own
/// stats.
const COLLECTION_JOINS: &str = " JOIN maps m ON m.id = COALESCE(cm.map_id, \
    (SELECT efam.current_map_id FROM map_families efam WHERE efam.id = cm.family_id)) \
    JOIN map_families fam ON fam.id = m.family_id \
    LEFT JOIN map_family_stats fs ON fs.family_id = fam.id AND cm.family_id IS NOT NULL";

/// Emits the candidate rows: every map in `scope` that passes `filter`, with the columns of
/// [`DbSbMap`] plus `sort_name`, `rank`, `added_at`, `sort_position` and the popularity columns
/// sort keys read (`sort_*`).
fn push_candidates(qb: &mut QueryBuilder<Postgres>, scope: MapScope, filter: &NormalizedFilter) {
    let families = matches!(
        scope,
        MapScope::Listed | MapScope::Favorites(_) | MapScope::Collection { .. }
    );
    let added_at = match scope {
        MapScope::Listed => FAMILY_PUBLISHED_AT,
        MapScope::Library(_) => "l.added_at",
        MapScope::Favorites(_) => "fm.added_at",
        MapScope::Collection { .. } => "cm.added_at",
    };
    qb.push("SELECT ");
    qb.push(DB_SB_MAP_COLUMNS);
    qb.push(", ");
    qb.push(if families {
        FAMILY_SORT_COLUMNS
    } else {
        MAP_SORT_COLUMNS
    });
    qb.push(", COALESCE(m.sort_name, m.name, '') AS sort_name, ");
    qb.push(format_args!(
        "CASE WHEN isfinite({added_at}) THEN {added_at} END AS added_at, "
    ));
    qb.push(match scope {
        MapScope::Collection { .. } => "cm.position AS sort_position, ",
        _ => "0 AS sort_position, ",
    });
    match (&filter.search, scope) {
        (Some(search), MapScope::Listed) => {
            // A family matches as well as its best matching listed file.
            qb.push("(SELECT COALESCE(max(");
            push_search_rank(qb, "sm", search);
            qb.push("), 0) FROM maps sm WHERE sm.family_id = fam.id AND sm.listed)");
        }
        (Some(search), _) => push_search_rank(qb, "m", search),
        (None, _) => {
            qb.push("0");
        }
    }
    qb.push(" AS rank");

    match scope {
        MapScope::Listed => {
            qb.push(" FROM maps m");
            qb.push(DB_SB_MAP_JOINS);
            qb.push(FAMILY_JOINS);
        }
        MapScope::Library(user_id) => {
            qb.push(" FROM maps m JOIN map_library l ON l.map_id = m.id AND l.user_id = ");
            qb.push_bind(user_id.0);
            qb.push(DB_SB_MAP_JOINS);
        }
        MapScope::Favorites(user_id) => {
            qb.push(
                " FROM maps m JOIN collection_maps fm ON fm.family_id = m.family_id \
                 JOIN collections fc ON fc.id = fm.collection_id AND fc.kind = 'starred' \
                 AND fc.owner_id = ",
            );
            qb.push_bind(user_id.0);
            qb.push(DB_SB_MAP_JOINS);
            qb.push(FAMILY_JOINS);
        }
        MapScope::Collection { .. } => {
            qb.push(" FROM collection_maps cm");
            qb.push(COLLECTION_JOINS);
            qb.push(DB_SB_MAP_JOINS);
        }
    }

    qb.push(" WHERE ");
    match scope {
        // Listings of every map only ever show listed maps (a listed family's current file is
        // always listed); a user's own library and favorites include the unlisted maps they hold.
        MapScope::Listed => {
            qb.push("fam.listed AND m.listed");
        }
        MapScope::Library(_) | MapScope::Favorites(_) => {
            qb.push("TRUE");
        }
        MapScope::Collection { id, listed_only } => {
            qb.push("cm.collection_id = ");
            qb.push_bind(id);
            if listed_only {
                qb.push(" AND fam.listed");
            }
        }
    }
    let published_at = match scope {
        MapScope::Listed => FAMILY_PUBLISHED_AT,
        MapScope::Library(_) | MapScope::Favorites(_) | MapScope::Collection { .. } => {
            "m.published_at"
        }
    };
    push_filters(qb, filter, published_at);
}

/// Emits the search rank of `m` for `search`, which is 0 when it doesn't match. Ranks are
/// integers so they compare exactly in cursors:
///
/// - 1000: the normalized name is the query
/// - 800: the searchable name (curated name, then file title) starts with the query
/// - 600-700: every query token appears in the searchable name, plus similarity
/// - 500: the query without spaces appears in the searchable name without spaces
/// - 300-400: fuzzy match against the searchable name (queries of 4+ characters)
/// - 200: every query token appears in the description
///
/// `m` is the alias of the map being ranked.
fn push_search_rank(qb: &mut QueryBuilder<Postgres>, m: &str, search: &SearchQuery) {
    // Substring tests use strpos rather than LIKE, so no character in the query has special
    // meaning.
    fn push_all_tokens_in(qb: &mut QueryBuilder<Postgres>, column: &str, search: &SearchQuery) {
        qb.push("(");
        for (i, token) in search.tokens().enumerate() {
            if i > 0 {
                qb.push(" AND ");
            }
            qb.push(format_args!("strpos({column}, "));
            qb.push_bind(token.to_string());
            qb.push(") > 0");
        }
        qb.push(")");
    }

    let q = search.normalized().to_string();
    qb.push(format_args!("CASE WHEN map_search_normalize({m}.name) = "));
    qb.push_bind(q.clone());
    qb.push(format_args!(
        " THEN 1000 WHEN starts_with({m}.search_name, "
    ));
    qb.push_bind(q.clone());
    qb.push(") THEN 800 WHEN ");
    push_all_tokens_in(qb, &format!("{m}.search_name"), search);
    qb.push(format_args!(
        " THEN 600 + (100 * similarity({m}.search_name, "
    ));
    qb.push_bind(q.clone());
    qb.push(format_args!("))::int WHEN strpos({m}.search_compact, "));
    qb.push_bind(search.compact());
    qb.push(") > 0 THEN 500");
    if search.is_fuzzy() {
        qb.push(" WHEN word_similarity(");
        qb.push_bind(q.clone());
        qb.push(format_args!(", {m}.search_name) >= "));
        qb.push_bind(FUZZY_THRESHOLD);
        qb.push(" THEN 300 + (100 * word_similarity(");
        qb.push_bind(q);
        qb.push(format_args!(", {m}.search_name))::int"));
    }
    qb.push(" WHEN ");
    push_all_tokens_in(qb, &format!("{m}.search_description"), search);
    qb.push(" THEN 200 ELSE 0 END");
}

/// Appends ` AND <condition>` for every filter that is set. `published_at` is the expression
/// `publishedSince` compares with.
fn push_filters(qb: &mut QueryBuilder<Postgres>, filter: &NormalizedFilter, published_at: &str) {
    match filter.lens {
        MapLens::All => {}
        MapLens::Melee => {
            qb.push(" AND m.kind = 'melee'");
        }
        MapLens::Ums => {
            qb.push(" AND m.kind = 'ums'");
        }
    }
    if !filter.players.is_empty() {
        qb.push(" AND m.player_count = ANY(");
        qb.push_bind(filter.players.clone());
        qb.push(")");
    }
    if let Some(min_players) = filter.min_players {
        qb.push(" AND m.player_count >= ");
        qb.push_bind(min_players);
    }
    if !filter.sizes.is_empty() {
        qb.push(" AND (");
        for (i, size) in filter.sizes.iter().enumerate() {
            if i > 0 {
                qb.push(" OR ");
            }
            let (lower, upper) = size.bounds();
            qb.push("(TRUE");
            if let Some(lower) = lower {
                qb.push(format_args!(" AND greatest(m.width, m.height) > {lower}"));
            }
            if let Some(upper) = upper {
                qb.push(format_args!(" AND greatest(m.width, m.height) <= {upper}"));
            }
            qb.push(")");
        }
        qb.push(")");
    }
    if !filter.tilesets.is_empty() {
        qb.push(" AND m.tileset = ANY(");
        qb.push_bind(filter.tilesets.clone());
        qb.push(")");
    }
    match filter.eud {
        EudFilter::Any => {}
        EudFilter::Exclude => {
            qb.push(" AND NOT m.is_eud");
        }
        EudFilter::Only => {
            qb.push(" AND m.is_eud");
        }
    }
    if let Some(published_since) = filter.published_since {
        qb.push(format_args!(" AND {published_at} >= "));
        qb.push_bind(published_since);
    }
    match filter.staff_pick {
        None => {}
        Some(true) => {
            qb.push(" AND ").push(STAFF_PICK);
        }
        Some(false) => {
            qb.push(" AND NOT ").push(STAFF_PICK);
        }
    }
    // Read through the file's family rather than `fam`, which only listings of families join
    if let Some(owner) = filter.owner {
        qb.push(
            " AND m.family_id IN (SELECT ofam.id FROM map_families ofam WHERE ofam.owner_id = ",
        );
        qb.push_bind(owner.0);
        qb.push(")");
    }
    if let Some(verified) = filter.verified {
        qb.push(if verified { " AND " } else { " AND NOT " });
        qb.push(VERIFIED);
    }
}

/// Whether the map `m` is in is verified: it's a staff pick, or staff granted its ownership.
const VERIFIED: &str = concat!(
    "(",
    staff_pick_sql!(),
    " OR EXISTS (SELECT 1 FROM map_families vfam \
     WHERE vfam.id = m.family_id AND vfam.owner_kind = 'staff'))"
);

/// Loads pages of map listings.
#[derive(Clone)]
pub struct MapSearchRepo {
    db: PgPool,
}

impl MapSearchRepo {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    pub fn db(&self) -> &PgPool {
        &self.db
    }

    /// Loads the maps with the given canonical ids. Missing ids are left out.
    pub async fn load_maps(&self, ids: &[SbMapId]) -> eyre::Result<Vec<DbSbMap>> {
        // Built at runtime rather than checked by `query_as!`: sqlx infers the nullability of
        // columns read through outer joins from the query plan, which differs between Postgres
        // versions, so a checked query here produces different offline metadata on different
        // databases.
        let mut query = QueryBuilder::<Postgres>::new("SELECT ");
        query
            .push(DB_SB_MAP_COLUMNS)
            .push(" FROM maps m")
            .push(DB_SB_MAP_JOINS)
            .push(" WHERE m.id = ANY(")
            .push_bind(ids.iter().map(|id| id.0).collect::<Vec<_>>())
            .push(")");
        query
            .build_query_as::<DbSbMap>()
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load maps")
    }

    pub async fn load_page(&self, request: &MapListingRequest) -> eyre::Result<MapListingPage> {
        let mut query = request.build_query();
        let rows = query
            .build()
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load map listing")?;

        let has_next_page = rows.len() > request.count;
        let rows = rows
            .iter()
            .take(request.count)
            .map(|row| {
                Ok(MapListingRow {
                    map: DbSbMap::from_row(row)?,
                    added_at: row.try_get("added_at")?,
                    cursor: request.cursor_for(row)?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()
            .wrap_err("Failed to read map listing rows")?;

        Ok(MapListingPage {
            rows,
            has_next_page,
        })
    }

    /// Counts the maps in the listing `request` pages through.
    pub async fn count(&self, request: &MapListingRequest) -> eyre::Result<i64> {
        let mut query = request.build_count_query();
        query
            .build_query_scalar::<i64>()
            .fetch_one(&self.db)
            .await
            .wrap_err("Failed to count map listing")
    }
}

#[cfg(test)]
mod tests {
    use async_graphql::connection::{CursorType, OpaqueCursor};

    use super::*;

    const ALL_SORTS: [MapSort; 11] = [
        MapSort::Relevance,
        MapSort::Trending,
        MapSort::Popular7d,
        MapSort::Popular28d,
        MapSort::Popular90d,
        MapSort::PopularAllTime,
        MapSort::Newest,
        MapSort::MostFavorited,
        MapSort::Name,
        MapSort::Players,
        MapSort::CollectionOrder,
    ];

    const COLLECTION: MapScope = MapScope::Collection {
        id: Uuid::from_u128(7),
        listed_only: false,
    };

    #[test]
    fn normalize_lowercases_and_collapses_punctuation() {
        assert_eq!(normalize_search("(4)Lights Out1.6e"), "4 lights out1 6e");
        assert_eq!(normalize_search("Polypoid 1.75"), "polypoid 1 75");
        assert_eq!(
            normalize_search("  --Fighting  Spirit--  "),
            "fighting spirit"
        );
        assert_eq!(normalize_search("[EUD]왕의기사"), "eud 왕의기사");
        assert_eq!(normalize_search("| iCCup | Blue Storm"), "iccup blue storm");
        assert_eq!(normalize_search("line\r\nbreak\ttab"), "line break tab");
    }

    #[test]
    fn normalize_keeps_hangul_and_han() {
        assert_eq!(normalize_search("투혼 1.4"), "투혼 1 4");
        assert_eq!(normalize_search("마린 키우기"), "마린 키우기");
        assert_eq!(
            normalize_search("EUD 3:3 빠른무한 컴까기"),
            "eud 3 3 빠른무한 컴까기"
        );
        assert_eq!(normalize_search("大陸"), "大陸");
    }

    #[test]
    fn normalize_treats_like_metacharacters_as_separators() {
        assert_eq!(normalize_search("100%_\\done"), "100 done");
        assert_eq!(normalize_search("%_\\"), "");
        assert_eq!(SearchQuery::new("%_\\ "), None);
    }

    #[test]
    fn normalize_matches_postgres() {
        // Outputs of `map_search_normalize` on Postgres 17 with the en_US.utf8 (glibc) collation,
        // including mojibake names (CP949 bytes decoded as Latin-1).
        let cases = [
            ("Blue Holic ºü¸¥¹«ÇÑ 2.0", "blue holic ºü çñ 2 0"),
            ("ÇÇ¾Æ³ë ¸¶½ºÅÍv5.3A", "çç æ ë ºåív5 3a"),
            ("Ⅳ²³½", "ⅳ"),
            ("İstanbul", "istanbul"),
            ("ß", "ß"),
            ("ㅌㅎ", "ㅌㅎ"),
            ("ｆｕｌｌ", "ｆｕｌｌ"),
            ("① ٣ ３ ¼ ⁴ ₂ ª º", "٣ ３ ª º"),
            ("㈠ ㉑ ❶ 〇 ௰ ፲ Ⅻ ⅰ", "〇 ⅻ ⅰ"),
            ("ˆ ´ \u{308} ・ ー 々 ゝ ｰ", "ˆ ー 々 ゝ ｰ"),
        ];
        for (input, expected) in cases {
            assert_eq!(normalize_search(input), expected, "{input:?}");
        }
    }

    #[test]
    fn search_query_parts() {
        let q = SearchQuery::new("Lost Temple 2.4").unwrap();
        assert_eq!(q.normalized(), "lost temple 2 4");
        assert_eq!(q.tokens().collect::<Vec<_>>(), ["lost", "temple", "2", "4"]);
        assert_eq!(q.compact(), "losttemple24");
        assert!(q.is_fuzzy());
        assert!(!SearchQuery::new("투혼").unwrap().is_fuzzy());
        assert!(!SearchQuery::new("b.g.h").unwrap().is_fuzzy());
    }

    #[test]
    fn default_sort_depends_on_search() {
        let filter = NormalizedFilter::new(MapFilter::default()).unwrap();
        assert_eq!(filter.default_sort(), MapSort::Popular28d);
        let filter = NormalizedFilter::new(MapFilter {
            search: Some("bound".into()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(filter.default_sort(), MapSort::Relevance);
        let filter = NormalizedFilter::new(MapFilter {
            search: Some(" !! ".into()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(filter.default_sort(), MapSort::Popular28d);
    }

    #[test]
    fn rejects_long_searches() {
        let result = NormalizedFilter::new(MapFilter {
            search: Some("a".repeat(MAX_SEARCH_LENGTH + 1)),
            ..Default::default()
        });
        assert_eq!(result, Err(MapListingError::SearchTooLong));
    }

    #[test]
    fn equivalent_filters_hash_the_same() {
        let a = NormalizedFilter::new(MapFilter {
            search: Some("Lost  Temple!".into()),
            players: Some(vec![4, 2, 4]),
            ..Default::default()
        })
        .unwrap();
        let b = NormalizedFilter::new(MapFilter {
            search: Some("lost temple".into()),
            players: Some(vec![2, 4]),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            a.listing_hash(MapScope::Listed),
            b.listing_hash(MapScope::Listed)
        );
        assert_ne!(
            a.listing_hash(MapScope::Listed),
            a.listing_hash(MapScope::Favorites(SbUserId(1)))
        );
        assert_ne!(
            a.listing_hash(MapScope::Library(SbUserId(1))),
            a.listing_hash(MapScope::Library(SbUserId(2)))
        );
    }

    fn sample_cursor(sort: MapSort, filter: &NormalizedFilter, scope: MapScope) -> MapCursor {
        let keys = sort_keys(sort)
            .iter()
            .map(|key| match key.kind {
                KeyKind::Int => CursorValue::Int(-42),
                KeyKind::Text => CursorValue::Text("lost temple".into()),
                KeyKind::Uuid => CursorValue::Text(Uuid::nil().to_string()),
            })
            .collect();
        MapCursor {
            v: CURSOR_VERSION,
            sort,
            keys,
            q: filter.listing_hash(scope),
        }
    }

    #[test]
    fn cursor_round_trips() {
        let filter = NormalizedFilter::new(MapFilter {
            search: Some("lost".into()),
            ..Default::default()
        })
        .unwrap();
        for sort in ALL_SORTS {
            let scope = if sort == MapSort::CollectionOrder {
                COLLECTION
            } else {
                MapScope::Listed
            };
            let cursor = sample_cursor(sort, &filter, scope);
            let encoded = OpaqueCursor(cursor.clone()).encode_cursor();
            let decoded = OpaqueCursor::<MapCursor>::decode_cursor(&encoded).unwrap();
            assert_eq!(decoded.0, cursor);

            let request = MapListingRequest::new(
                scope,
                Some(MapFilter {
                    search: Some("LOST".into()),
                    ..Default::default()
                }),
                Some(sort),
                Some(&encoded),
                Some(3),
            )
            .unwrap();
            let bound = request.after.unwrap();
            assert_eq!(bound.len(), sort_keys(sort).len());
            assert_eq!(*bound.last().unwrap(), BoundKey::Uuid(Uuid::nil()));
        }
    }

    #[test]
    fn cursor_rejects_mismatched_arguments() {
        let filter = NormalizedFilter::new(MapFilter::default()).unwrap();
        let cursor = sample_cursor(MapSort::Popular28d, &filter, MapScope::Listed);
        let encoded = OpaqueCursor(cursor.clone()).encode_cursor();
        let request = |scope, filter: Option<MapFilter>, sort| {
            MapListingRequest::new(scope, filter, sort, Some(&encoded), None).map(|_| ())
        };

        assert_eq!(request(MapScope::Listed, None, None), Ok(()));
        assert_eq!(
            request(MapScope::Listed, None, Some(MapSort::Popular7d)),
            Err(MapListingError::CursorMismatch)
        );
        assert_eq!(
            request(
                MapScope::Listed,
                Some(MapFilter {
                    eud: EudFilter::Exclude,
                    ..Default::default()
                }),
                None
            ),
            Err(MapListingError::CursorMismatch)
        );
        assert_eq!(
            request(
                MapScope::Listed,
                Some(MapFilter {
                    search: Some("bound".into()),
                    ..Default::default()
                }),
                Some(MapSort::Popular28d)
            ),
            Err(MapListingError::CursorMismatch)
        );
        assert_eq!(
            request(MapScope::Favorites(SbUserId(1)), None, None),
            Err(MapListingError::CursorMismatch)
        );

        let mut old_version = cursor.clone();
        old_version.v = CURSOR_VERSION + 1;
        assert_eq!(
            old_version.validate(MapSort::Popular28d, &cursor.q),
            Err(MapListingError::CursorMismatch)
        );
    }

    #[test]
    fn cursor_rejects_malformed_keys() {
        let filter = NormalizedFilter::new(MapFilter::default()).unwrap();
        let hash = filter.listing_hash(MapScope::Listed);
        let base = sample_cursor(MapSort::Name, &filter, MapScope::Listed);

        let mut short = base.clone();
        short.keys.pop();
        assert_eq!(
            short.validate(MapSort::Name, &hash),
            Err(MapListingError::InvalidCursor)
        );

        let mut wrong_kind = base.clone();
        wrong_kind.keys[0] = CursorValue::Int(1);
        assert_eq!(
            wrong_kind.validate(MapSort::Name, &hash),
            Err(MapListingError::InvalidCursor)
        );

        let mut bad_uuid = base.clone();
        bad_uuid.keys[1] = CursorValue::Text("not-a-uuid".into());
        assert_eq!(
            bad_uuid.validate(MapSort::Name, &hash),
            Err(MapListingError::InvalidCursor)
        );

        assert_eq!(
            MapListingRequest::new(MapScope::Listed, None, None, Some("!!!"), None).map(|_| ()),
            Err(MapListingError::InvalidCursor)
        );
    }

    #[test]
    fn page_size_is_clamped() {
        let count = |first| {
            MapListingRequest::new(MapScope::Listed, None, None, None, first)
                .unwrap()
                .count
        };
        assert_eq!(count(None), DEFAULT_PAGE_SIZE);
        assert_eq!(count(Some(0)), 1);
        assert_eq!(count(Some(-5)), 1);
        assert_eq!(count(Some(3)), 3);
        assert_eq!(count(Some(1000)), MAX_PAGE_SIZE);
    }

    #[test]
    fn every_sort_ends_in_a_unique_key() {
        for sort in ALL_SORTS {
            assert_eq!(sort_keys(sort).last(), Some(&ID), "{sort:?}");
        }
    }

    #[test]
    fn sort_keys_emit_matching_order_and_comparison() {
        let cases: [(MapSort, &str); 4] = [
            (
                MapSort::Relevance,
                ", (-c.rank)::bigint AS k0, (-c.sort_games_28d)::bigint AS k1, \
                 (c.sort_name) AS k2, (c.id) AS k3",
            ),
            (
                MapSort::Popular90d,
                ", (-c.sort_games_90d)::bigint AS k0, (-c.sort_players_90d)::bigint AS k1, \
                 (c.sort_name) AS k2, (c.id) AS k3",
            ),
            (MapSort::Name, ", (c.sort_name) AS k0, (c.id) AS k1"),
            (
                MapSort::Players,
                ", (c.player_count)::bigint AS k0, (c.sort_name) AS k1, (c.id) AS k2",
            ),
        ];
        for (sort, expected_columns) in cases {
            let keys = sort_keys(sort);
            let mut qb = QueryBuilder::<Postgres>::new("");
            push_key_columns(&mut qb, keys);
            assert_eq!(qb.sql().as_str(), expected_columns, "{sort:?}");
        }

        for sort in ALL_SORTS {
            let keys = sort_keys(sort);
            let aliases = (0..keys.len())
                .map(|i| format!("k{i}"))
                .collect::<Vec<_>>()
                .join(", ");

            let mut qb = QueryBuilder::<Postgres>::new("");
            push_sort_keys(&mut qb, keys, None);
            assert_eq!(qb.sql().as_str(), format!(" ORDER BY {aliases}"));

            let filter = NormalizedFilter::new(MapFilter::default()).unwrap();
            let cursor = sample_cursor(sort, &filter, MapScope::Listed);
            let bound = cursor
                .validate(sort, &filter.listing_hash(MapScope::Listed))
                .unwrap();
            let mut qb = QueryBuilder::<Postgres>::new("");
            push_sort_keys(&mut qb, keys, Some(&bound));
            let placeholders = keys
                .iter()
                .enumerate()
                .map(|(i, key)| {
                    let cast = match key.kind {
                        KeyKind::Int => "bigint",
                        KeyKind::Text => "text",
                        KeyKind::Uuid => "uuid",
                    };
                    format!("${}::{cast}", i + 1)
                })
                .collect::<Vec<_>>()
                .join(", ");
            assert_eq!(
                qb.sql().as_str(),
                format!(" WHERE ({aliases}) > ({placeholders}) ORDER BY {aliases}"),
                "{sort:?}"
            );
        }
    }

    #[test]
    fn listed_scope_always_requires_listed() {
        for filter in [
            MapFilter::default(),
            MapFilter {
                search: Some("bound".into()),
                lens: MapLens::Ums,
                players: Some(vec![4]),
                min_players: Some(2),
                sizes: Some(vec![MapSizeClass::Huge, MapSizeClass::Tiny]),
                tilesets: Some(vec![1, 2]),
                eud: EudFilter::Exclude,
                published_since: Some(Utc::now()),
                staff_pick: Some(true),
                owner: Some(SbUserId(1)),
                verified: Some(true),
            },
        ] {
            let request =
                MapListingRequest::new(MapScope::Listed, Some(filter), None, None, None).unwrap();
            let sql = request.build_query().sql();
            assert!(
                sql.as_str().contains(" WHERE fam.listed AND m.listed"),
                "{}",
                sql.as_str()
            );
        }

        let request =
            MapListingRequest::new(MapScope::Library(SbUserId(1)), None, None, None, None).unwrap();
        let sql = request.build_query().sql();
        assert!(sql.as_str().contains(" WHERE TRUE"), "{}", sql.as_str());
        assert!(
            sql.as_str().contains("JOIN map_library l"),
            "{}",
            sql.as_str()
        );
    }

    #[test]
    fn size_filters_cover_every_dimension() {
        let filter = NormalizedFilter::new(MapFilter {
            sizes: Some(vec![MapSizeClass::Huge, MapSizeClass::Tiny]),
            ..Default::default()
        })
        .unwrap();
        let mut qb = QueryBuilder::<Postgres>::new("");
        push_filters(&mut qb, &filter, "m.published_at");
        assert_eq!(
            qb.sql().as_str(),
            " AND ((TRUE AND greatest(m.width, m.height) <= 64) OR \
             (TRUE AND greatest(m.width, m.height) > 192))"
        );

        let classes = [
            MapSizeClass::Tiny,
            MapSizeClass::Small,
            MapSizeClass::Medium,
            MapSizeClass::Large,
            MapSizeClass::Huge,
        ];
        for dimension in [1, 64, 65, 96, 97, 128, 129, 192, 193, 256] {
            let matching = classes
                .iter()
                .filter(|c| {
                    let (lower, upper) = c.bounds();
                    lower.is_none_or(|l| dimension > l) && upper.is_none_or(|u| dimension <= u)
                })
                .count();
            assert_eq!(matching, 1, "{dimension}");
        }
    }

    #[test]
    fn staff_pick_filter_matches_either_way() {
        for (staff_pick, expected) in [
            (None, String::new()),
            (Some(true), format!(" AND {STAFF_PICK}")),
            (Some(false), format!(" AND NOT {STAFF_PICK}")),
        ] {
            let filter = NormalizedFilter::new(MapFilter {
                staff_pick,
                ..Default::default()
            })
            .unwrap();
            let mut qb = QueryBuilder::<Postgres>::new("");
            push_filters(&mut qb, &filter, "m.published_at");
            assert_eq!(qb.sql().as_str(), expected);
        }
    }

    #[test]
    fn owner_and_verified_filters_read_the_family_in_every_scope() {
        let filter = MapFilter {
            owner: Some(SbUserId(7)),
            verified: Some(true),
            ..Default::default()
        };
        for scope in [
            MapScope::Listed,
            MapScope::Library(SbUserId(1)),
            MapScope::Favorites(SbUserId(1)),
            COLLECTION,
        ] {
            let request =
                MapListingRequest::new(scope, Some(filter.clone()), None, None, None).unwrap();
            let sql = request.build_query().sql().as_str().to_string();
            assert!(
                sql.contains(
                    " AND m.family_id IN (SELECT ofam.id FROM map_families ofam \
                     WHERE ofam.owner_id = $"
                ),
                "{sql}"
            );
            assert!(sql.contains(&format!(" AND {VERIFIED}")), "{sql}");
        }

        for (verified, expected) in [
            (None, String::new()),
            (Some(true), format!(" AND {VERIFIED}")),
            (Some(false), format!(" AND NOT {VERIFIED}")),
        ] {
            let filter = NormalizedFilter::new(MapFilter {
                verified,
                ..Default::default()
            })
            .unwrap();
            let mut qb = QueryBuilder::<Postgres>::new("");
            push_filters(&mut qb, &filter, "m.published_at");
            assert_eq!(qb.sql().as_str(), expected);
        }
    }

    #[test]
    fn owner_and_verified_filters_change_the_listing_hash() {
        let any = NormalizedFilter::new(MapFilter::default()).unwrap();
        let hashes: Vec<String> = [
            MapFilter {
                owner: Some(SbUserId(1)),
                ..Default::default()
            },
            MapFilter {
                owner: Some(SbUserId(2)),
                ..Default::default()
            },
            MapFilter {
                verified: Some(true),
                ..Default::default()
            },
            MapFilter {
                verified: Some(false),
                ..Default::default()
            },
        ]
        .into_iter()
        .map(|f| {
            NormalizedFilter::new(f)
                .unwrap()
                .listing_hash(MapScope::Listed)
        })
        .collect();
        for (i, hash) in hashes.iter().enumerate() {
            assert_ne!(hash, &any.listing_hash(MapScope::Listed));
            assert!(!hashes[i + 1..].contains(hash));
        }
    }

    #[test]
    fn staff_pick_filter_changes_the_listing_hash() {
        let any = NormalizedFilter::new(MapFilter::default()).unwrap();
        let staff_pick = NormalizedFilter::new(MapFilter {
            staff_pick: Some(true),
            ..Default::default()
        })
        .unwrap();
        assert_ne!(
            any.listing_hash(MapScope::Listed),
            staff_pick.listing_hash(MapScope::Listed)
        );
    }

    #[test]
    fn count_covers_the_same_rows_as_the_listing() {
        let filter = MapFilter {
            search: Some("bound".into()),
            lens: MapLens::Ums,
            staff_pick: Some(false),
            ..Default::default()
        };
        for scope in [
            MapScope::Listed,
            MapScope::Library(SbUserId(1)),
            MapScope::Favorites(SbUserId(1)),
            COLLECTION,
        ] {
            let request =
                MapListingRequest::new(scope, Some(filter.clone()), None, None, None).unwrap();
            let listing = request.build_query().sql().as_str().to_string();
            let count = request.build_count_query().sql().as_str().to_string();

            let mut candidates = QueryBuilder::<Postgres>::new("");
            push_candidates(&mut candidates, scope, &request.filter);
            let candidates = candidates.sql().as_str().to_string();
            assert!(listing.contains(&candidates), "{listing}");
            assert!(count.contains(&candidates), "{count}");
            assert!(count.contains(") c WHERE c.rank > 0"), "{count}");
            assert!(!count.contains("LIMIT"), "{count}");
        }
    }

    #[test]
    fn listed_and_favorite_maps_list_families() {
        let sql = |scope, search: Option<&str>| {
            let filter = MapFilter {
                search: search.map(str::to_string),
                ..Default::default()
            };
            MapListingRequest::new(scope, Some(filter), None, None, None)
                .unwrap()
                .build_query()
                .sql()
                .as_str()
                .to_string()
        };
        for families in [
            sql(MapScope::Listed, None),
            sql(MapScope::Favorites(SbUserId(1)), None),
        ] {
            assert!(
                families.contains("AND fam.current_map_id = m.id"),
                "{families}"
            );
            assert!(
                families.contains("LEFT JOIN map_family_stats fs"),
                "{families}"
            );
        }
        let library = sql(MapScope::Library(SbUserId(1)), None);
        assert!(!library.contains("map_families"), "{library}");
        assert!(!library.contains("map_family_stats"), "{library}");

        // A search ranks a listed family by its best matching listed file
        let searched = sql(MapScope::Listed, Some("fighting spirit"));
        assert!(
            searched.contains("FROM maps sm WHERE sm.family_id = fam.id AND sm.listed"),
            "{searched}"
        );
        let searched = sql(MapScope::Favorites(SbUserId(1)), Some("fighting spirit"));
        assert!(!searched.contains("FROM maps sm"), "{searched}");
    }

    #[test]
    fn published_since_reads_the_family_in_the_listed_scope() {
        let filter = MapFilter {
            published_since: Some(Utc::now()),
            ..Default::default()
        };
        let sql = |scope| {
            MapListingRequest::new(scope, Some(filter.clone()), None, None, None)
                .unwrap()
                .build_query()
                .sql()
                .as_str()
                .to_string()
        };
        let listed = sql(MapScope::Listed);
        assert!(
            listed.contains(&format!(" AND {FAMILY_PUBLISHED_AT} >= ")),
            "{listed}"
        );
        let library = sql(MapScope::Library(SbUserId(1)));
        assert!(library.contains(" AND m.published_at >= "), "{library}");
    }

    #[test]
    fn collection_order_is_the_default_only_in_a_collection() {
        let sort = |scope, filter: Option<MapFilter>, sort| {
            MapListingRequest::new(scope, filter, sort, None, None)
                .unwrap()
                .sort
        };
        let search = || {
            Some(MapFilter {
                search: Some("bound".into()),
                ..Default::default()
            })
        };
        assert_eq!(sort(COLLECTION, None, None), MapSort::CollectionOrder);
        assert_eq!(sort(COLLECTION, search(), None), MapSort::CollectionOrder);
        assert_eq!(sort(COLLECTION, None, Some(MapSort::Name)), MapSort::Name);
        for scope in [
            MapScope::Listed,
            MapScope::Library(SbUserId(1)),
            MapScope::Favorites(SbUserId(1)),
        ] {
            assert_eq!(
                sort(scope, None, Some(MapSort::CollectionOrder)),
                MapSort::Popular28d
            );
            assert_eq!(
                sort(scope, search(), Some(MapSort::CollectionOrder)),
                MapSort::Relevance
            );
        }

        // A cursor from a listing that asked for `COLLECTION_ORDER` outside a collection continues
        // it, whether or not the sort is asked for again
        let filter = NormalizedFilter::new(MapFilter::default()).unwrap();
        let cursor = sample_cursor(MapSort::Popular28d, &filter, MapScope::Listed);
        let encoded = OpaqueCursor(cursor).encode_cursor();
        for requested in [Some(MapSort::CollectionOrder), None] {
            assert!(
                MapListingRequest::new(MapScope::Listed, None, requested, Some(&encoded), None)
                    .is_ok()
            );
        }
    }

    #[test]
    fn collection_scope_lists_entries_of_one_collection() {
        let sql = |scope| {
            MapListingRequest::new(scope, None, None, None, None)
                .unwrap()
                .build_query()
                .sql()
                .as_str()
                .to_string()
        };
        let all = sql(COLLECTION);
        assert!(all.contains(" FROM collection_maps cm"), "{all}");
        assert!(all.contains(COLLECTION_JOINS), "{all}");
        assert!(all.contains(" WHERE cm.collection_id = $"), "{all}");
        assert!(!all.contains("fam.listed"), "{all}");
        assert!(all.contains("cm.position AS sort_position"), "{all}");
        assert!(all.contains("CASE WHEN isfinite(cm.added_at)"), "{all}");

        let listed = sql(MapScope::Collection {
            id: Uuid::from_u128(7),
            listed_only: true,
        });
        assert!(listed.contains(" AND fam.listed"), "{listed}");
        assert!(!listed.contains("AND m.listed"), "{listed}");

        // Who's looking changes the rows, so cursors can't cross between the two
        assert_ne!(
            NormalizedFilter::new(MapFilter::default())
                .unwrap()
                .listing_hash(COLLECTION),
            NormalizedFilter::new(MapFilter::default())
                .unwrap()
                .listing_hash(MapScope::Collection {
                    id: Uuid::from_u128(7),
                    listed_only: true,
                })
        );

        let favorites = sql(MapScope::Favorites(SbUserId(1)));
        assert!(
            favorites.contains(
                "JOIN collection_maps fm ON fm.family_id = m.family_id \
                 JOIN collections fc ON fc.id = fm.collection_id AND fc.kind = 'starred'"
            ),
            "{favorites}"
        );
    }

    #[test]
    fn fuzzy_matching_only_for_longer_queries() {
        let mut qb = QueryBuilder::<Postgres>::new("");
        push_search_rank(&mut qb, "m", &SearchQuery::new("polypod").unwrap());
        assert!(qb.sql().as_str().contains("word_similarity"));

        let mut qb = QueryBuilder::<Postgres>::new("");
        push_search_rank(&mut qb, "m", &SearchQuery::new("투혼").unwrap());
        assert!(!qb.sql().as_str().contains("word_similarity"));
    }
}
