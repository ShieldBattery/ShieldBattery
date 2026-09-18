//! The overlay's translations.
//!
//! The in-game UI speaks the same catalogs the rest of ShieldBattery does: i18next JSON, one file
//! per language, with the game's strings in their own `game` namespace. `build.rs` embeds whichever
//! catalogs exist; [`tr!`](crate::tr) and [`tr_plural!`](crate::tr_plural) look a string up in them
//! at the call site, and the English default written beside the key is both what the extractor
//! collects into the catalog and the last-resort text, so a key that has not been translated — or
//! not yet extracted — still renders a sentence rather than a blank or a raw key.
//!
//! The active language is process-wide because the overlay's render fns are pure fns of their
//! view-models: threading a locale through every one of them would put a parameter on every screen
//! to serve a value that changes once, when the host applies its settings.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt::Display;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

/// A language the overlay can render in.
///
/// These are exactly the languages the app translates, named by their i18next tags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(
    feature = "preview",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "kebab-case")
)]
pub enum Locale {
    #[default]
    En,
    Es,
    Ko,
    Ru,
    ZhHans,
}

impl Locale {
    /// Every locale, in the order a language picker lists them.
    pub const ALL: [Locale; 5] = [
        Locale::En,
        Locale::Es,
        Locale::Ko,
        Locale::Ru,
        Locale::ZhHans,
    ];

    /// The i18next tag this locale is named by, which is also its catalog directory.
    pub fn tag(self) -> &'static str {
        match self {
            Locale::En => "en",
            Locale::Es => "es",
            Locale::Ko => "ko",
            Locale::Ru => "ru",
            Locale::ZhHans => "zh-Hans",
        }
    }

    /// The locale a language tag names, or `None` for a language the overlay has no catalog for.
    ///
    /// Region and script subtags beyond the ones we ship are dropped (`en-US` is `en`), because a
    /// host hands over whatever tag the user's preference resolved to and a regional variant of a
    /// language we translate is still that language.
    pub fn from_tag(tag: &str) -> Option<Locale> {
        let tag = tag.trim();
        let exact = Locale::ALL
            .into_iter()
            .find(|locale| locale.tag().eq_ignore_ascii_case(tag));
        if exact.is_some() {
            return exact;
        }
        let base = tag.split(['-', '_']).next().unwrap_or(tag);
        Locale::ALL
            .into_iter()
            .find(|locale| locale.tag().eq_ignore_ascii_case(base))
    }

    fn index(self) -> usize {
        Locale::ALL
            .iter()
            .position(|&locale| locale == self)
            .expect("ALL holds every variant")
    }

    fn from_index(index: u8) -> Locale {
        Locale::ALL
            .get(usize::from(index))
            .copied()
            .unwrap_or(Locale::En)
    }
}

include!(concat!(env!("OUT_DIR"), "/locales.rs"));

/// One language's strings, keyed by the `.`-joined path of the nested JSON they came from.
type Table = HashMap<String, String>;

/// The active locale, as an index into [`Locale::ALL`].
///
/// An atomic rather than a lock: every string the overlay draws reads this, once per string per
/// frame, from the thread that happens to be rendering, and it is written once when the host
/// applies its settings.
static ACTIVE: AtomicU8 = AtomicU8::new(0);

/// Sets the language every later [`translate`] resolves against.
pub fn set_locale(locale: Locale) {
    ACTIVE.store(locale.index() as u8, Ordering::Relaxed);
}

/// The language strings currently resolve in.
pub fn locale() -> Locale {
    Locale::from_index(ACTIVE.load(Ordering::Relaxed))
}

/// Looks up `key`, falling back to the current locale's catalog, then English's, then `default`,
/// and interpolates `{{name}}` placeholders from `args`.
///
/// Prefer the [`tr!`](crate::tr) macro, which is the form the extractor reads keys and defaults
/// out of.
pub fn translate(key: &str, default: &str, args: &[(&str, &dyn Display)]) -> String {
    interpolate(&template(key, default), args)
}

/// Looks up the plural form of `key` that `count` takes in the current locale, falling back the way
/// [`translate`] does and ending at the call site's own `one` / `other` text. `{{count}}` is always
/// available to the interpolation, on top of `args`.
///
/// Prefer the [`tr_plural!`](crate::tr_plural) macro.
pub fn translate_plural(
    key: &str,
    count: i64,
    one: &str,
    other: &str,
    args: &[(&str, &dyn Display)],
) -> String {
    let template = plural_template(key, count, one, other);
    let mut all: Vec<(&str, &dyn Display)> = Vec::with_capacity(args.len() + 1);
    all.push(("count", &count));
    all.extend_from_slice(args);
    interpolate(&template, &all)
}

/// The text [`translate`] resolved to, before interpolation.
#[cfg(not(feature = "preview"))]
fn template<'a>(key: &str, default: &'a str) -> Cow<'a, str> {
    Cow::Borrowed(resolve(table(locale()), table(Locale::En), key, default))
}

/// The same, with the pseudolocale in the way. It stands in for a translation nobody has written
/// yet, so it expands the source text rather than whatever the active language happens to hold.
#[cfg(feature = "preview")]
fn template<'a>(key: &str, default: &'a str) -> Cow<'a, str> {
    if PSEUDOLOCALE.load(Ordering::Relaxed) {
        return Cow::Owned(pseudolocalize(resolve(
            table(Locale::En),
            None,
            key,
            default,
        )));
    }
    Cow::Borrowed(resolve(table(locale()), table(Locale::En), key, default))
}

/// The plural counterpart of [`template`].
#[cfg(not(feature = "preview"))]
fn plural_template<'a>(key: &str, count: i64, one: &'a str, other: &'a str) -> Cow<'a, str> {
    Cow::Borrowed(resolve_plural(
        table(locale()),
        locale(),
        table(Locale::En),
        key,
        count,
        one,
        other,
    ))
}

#[cfg(feature = "preview")]
fn plural_template<'a>(key: &str, count: i64, one: &'a str, other: &'a str) -> Cow<'a, str> {
    if PSEUDOLOCALE.load(Ordering::Relaxed) {
        let english = resolve_plural(table(Locale::En), Locale::En, None, key, count, one, other);
        return Cow::Owned(pseudolocalize(english));
    }
    Cow::Borrowed(resolve_plural(
        table(locale()),
        locale(),
        table(Locale::En),
        key,
        count,
        one,
        other,
    ))
}

/// The catalog for `locale`, parsed and flattened the first time it is asked for.
fn table(locale: Locale) -> Option<&'static Table> {
    static TABLES: [OnceLock<Option<Table>>; Locale::ALL.len()] =
        [const { OnceLock::new() }; Locale::ALL.len()];
    TABLES[locale.index()]
        .get_or_init(|| {
            let json = LOCALE_JSON
                .iter()
                .find(|(embedded, _)| *embedded == locale)
                .map(|(_, json)| *json)?;
            match serde_json::from_str::<serde_json::Value>(json) {
                Ok(value) => Some(flatten(&value)),
                Err(_) => None,
            }
        })
        .as_ref()
}

/// Flattens nested i18next JSON into `.`-joined keys, which is the shape a key is written in at a
/// call site. Anything that is not a string (a stray number, a null) is skipped rather than
/// stringified, so a malformed catalog costs one string rather than rendering `null`.
fn flatten(value: &serde_json::Value) -> Table {
    fn walk(prefix: &str, value: &serde_json::Value, out: &mut Table) {
        match value {
            serde_json::Value::Object(map) => {
                for (name, child) in map {
                    let key = if prefix.is_empty() {
                        name.clone()
                    } else {
                        format!("{prefix}.{name}")
                    };
                    walk(&key, child, out);
                }
            }
            serde_json::Value::String(text) => {
                out.insert(prefix.to_string(), text.clone());
            }
            _ => {}
        }
    }
    let mut out = Table::new();
    walk("", value, &mut out);
    out
}

/// Picks the text for `key`: the active catalog, then English's, then the call site's default.
fn resolve<'a>(
    active: Option<&'a Table>,
    english: Option<&'a Table>,
    key: &str,
    default: &'a str,
) -> &'a str {
    lookup(active, key)
        .or_else(|| lookup(english, key))
        .unwrap_or(default)
}

/// Picks the text for the plural form of `key` that `count` takes.
///
/// The active locale's own category is tried first, then its `other` — a catalog missing the exact
/// category is still the right language, which any English text is not. English is then tried for
/// the category *English* would use, since a Russian `many` has no meaning in an English catalog.
fn resolve_plural<'a>(
    active: Option<&'a Table>,
    active_locale: Locale,
    english: Option<&'a Table>,
    key: &str,
    count: i64,
    one: &'a str,
    other: &'a str,
) -> &'a str {
    let english_category = plural_category(Locale::En, count);
    lookup_plural(active, key, plural_category(active_locale, count))
        .or_else(|| lookup_plural(active, key, PluralCategory::Other))
        .or_else(|| lookup_plural(english, key, english_category))
        .or_else(|| lookup_plural(english, key, PluralCategory::Other))
        .unwrap_or(match english_category {
            PluralCategory::One => one,
            _ => other,
        })
}

fn lookup<'a>(table: Option<&'a Table>, key: &str) -> Option<&'a str> {
    table?.get(key).map(String::as_str)
}

fn lookup_plural<'a>(
    table: Option<&'a Table>,
    key: &str,
    category: PluralCategory,
) -> Option<&'a str> {
    lookup(table, &format!("{key}_{}", category.suffix()))
}

/// The CLDR cardinal categories the overlay's languages use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PluralCategory {
    One,
    Few,
    Many,
    Other,
}

impl PluralCategory {
    /// The suffix i18next gives this category's sibling key.
    fn suffix(self) -> &'static str {
        match self {
            PluralCategory::One => "one",
            PluralCategory::Few => "few",
            PluralCategory::Many => "many",
            PluralCategory::Other => "other",
        }
    }
}

/// The CLDR cardinal category `count` falls in for `locale`.
///
/// Written out rather than pulled from a CLDR library because the overlay ships five languages
/// whose integer rules fit in a dozen lines, and a plural table is not worth the megabytes of
/// locale data that a general implementation carries into an injected DLL.
fn plural_category(locale: Locale, count: i64) -> PluralCategory {
    let n = count.unsigned_abs();
    match locale {
        // Chinese and Korean have one form for every count.
        Locale::Ko | Locale::ZhHans => PluralCategory::Other,
        Locale::En => {
            if n == 1 {
                PluralCategory::One
            } else {
                PluralCategory::Other
            }
        }
        // Spanish splits `many` off for whole millions, which is the form a translator is given a
        // slot for even though the overlay counts nothing that large.
        Locale::Es => {
            if n == 1 {
                PluralCategory::One
            } else if n != 0 && n.is_multiple_of(1_000_000) {
                PluralCategory::Many
            } else {
                PluralCategory::Other
            }
        }
        Locale::Ru => {
            let tens = n % 10;
            let hundreds = n % 100;
            if tens == 1 && hundreds != 11 {
                PluralCategory::One
            } else if (2..=4).contains(&tens) && !(12..=14).contains(&hundreds) {
                PluralCategory::Few
            } else {
                PluralCategory::Many
            }
        }
    }
}

/// Replaces every `{{name}}` in `template` with the matching argument.
///
/// A placeholder with no argument is left exactly as written: it says on screen which name the call
/// site failed to pass, where dropping it would leave a sentence with a hole in it that reads like
/// a translation bug.
fn interpolate(template: &str, args: &[(&str, &dyn Display)]) -> String {
    if !template.contains("{{") {
        return template.to_string();
    }
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            // An unterminated placeholder is text like any other.
            out.push_str(&rest[start..]);
            return out;
        };
        let name = after[..end].trim();
        match args.iter().find(|(arg, _)| *arg == name) {
            Some((_, value)) => out.push_str(&value.to_string()),
            None => out.push_str(&rest[start..start + 2 + end + 2]),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

/// Whether the preview's pseudolocale is on. Compiled out of the game DLL, which has no way to turn
/// it on and no reason to test for it on every string.
#[cfg(feature = "preview")]
static PSEUDOLOCALE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Turns the pseudolocale on or off.
///
/// It exists so a layout is judged against text longer than English before any translator has
/// written any: every string comes back accented, bracketed and padded, which makes both an
/// overflow and an untranslated string visible at a glance.
#[cfg(feature = "preview")]
pub fn set_pseudolocale(on: bool) {
    PSEUDOLOCALE.store(on, Ordering::Relaxed);
}

/// Accents every Latin letter, brackets the result and pads it out to roughly 135% of its length.
///
/// `{{name}}` placeholders pass through untouched: they are replaced by real values (a name, a
/// number) whose length the pseudolocale has no business inventing, and accenting them would stop
/// them resolving at all.
#[cfg(feature = "preview")]
fn pseudolocalize(template: &str) -> String {
    let mut out = String::with_capacity(template.len() * 2 + 8);
    out.push('[');
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        push_accented(&mut out, &rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}") {
            Some(end) => {
                out.push_str(&rest[start..start + 2 + end + 2]);
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
                break;
            }
        }
    }
    push_accented(&mut out, rest);
    // The padding is what makes an expansion-sensitive layout fail here rather than in Russian.
    let letters = template.chars().count();
    let padding = (letters * 35).div_ceil(100).max(1);
    for _ in 0..padding {
        out.push('~');
    }
    out.push(']');
    out
}

#[cfg(feature = "preview")]
fn push_accented(out: &mut String, text: &str) {
    for c in text.chars() {
        out.push(accented(c));
    }
}

/// The accented look-alike of a Latin letter, or the character itself.
///
/// Only Latin-1 and Latin Extended-A stand-ins are used, since those are the ones the overlay's own
/// faces carry: a letter whose look-alike would render as a missing-glyph box (b, f, m, q, v, x)
/// keeps its plain form rather than turning the pseudolocale into a row of tofu.
#[cfg(feature = "preview")]
fn accented(c: char) -> char {
    const LOWER: [char; 26] = [
        'á', 'b', 'ç', 'đ', 'é', 'f', 'ğ', 'ĥ', 'í', 'ĵ', 'ķ', 'ł', 'm', 'ń', 'ó', 'þ', 'q', 'ř',
        'š', 'ţ', 'ú', 'v', 'ŵ', 'x', 'ý', 'ž',
    ];
    const UPPER: [char; 26] = [
        'Á', 'B', 'Ç', 'Đ', 'É', 'F', 'Ğ', 'Ĥ', 'Í', 'Ĵ', 'Ķ', 'Ł', 'M', 'Ń', 'Ó', 'Þ', 'Q', 'Ř',
        'Š', 'Ţ', 'Ú', 'V', 'Ŵ', 'X', 'Ý', 'Ž',
    ];
    match c {
        'a'..='z' => LOWER[c as usize - 'a' as usize],
        'A'..='Z' => UPPER[c as usize - 'A' as usize],
        other => other,
    }
}

/// Looks a string up in the catalogs, falling back to the English default written at the call site.
///
/// ```ignore
/// tr!("disconnect.title", "Waiting for players");
/// tr!("disconnect.state", "Reconnecting to {{name}}", name = player.name);
/// ```
///
/// The key and the default must be literals: the extractor that fills the catalogs reads them
/// statically out of the source, so a computed key would ship a string no translator ever sees.
#[macro_export]
macro_rules! tr {
    ($key:literal, $default:literal $(,)?) => {
        $crate::i18n::translate($key, $default, &[])
    };
    ($key:literal, $default:literal, $($name:ident = $value:expr),+ $(,)?) => {
        $crate::i18n::translate(
            $key,
            $default,
            &[$((stringify!($name), &$value as &dyn ::std::fmt::Display)),+],
        )
    };
}

/// The plural counterpart of [`tr!`]: picks the form `count` takes in the active language.
///
/// ```ignore
/// tr_plural!("disconnect.waiting", waiting, one = "{{count}} player", other = "{{count}} players");
/// ```
///
/// `{{count}}` is always interpolated; further `name = expr` arguments follow the forms.
#[macro_export]
macro_rules! tr_plural {
    ($key:literal, $count:expr, one = $one:literal, other = $other:literal $(,)?) => {
        $crate::i18n::translate_plural($key, ($count) as i64, $one, $other, &[])
    };
    (
        $key:literal, $count:expr, one = $one:literal, other = $other:literal,
        $($name:ident = $value:expr),+ $(,)?
    ) => {
        $crate::i18n::translate_plural(
            $key,
            ($count) as i64,
            $one,
            $other,
            &[$((stringify!($name), &$value as &dyn ::std::fmt::Display)),+],
        )
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_of(pairs: &[(&str, &str)]) -> Table {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn nested_objects_flatten_to_dotted_keys() {
        let json = serde_json::json!({
            "disconnect": {
                "title": "Waiting for players",
                "waiting_one": "{{count}} player",
                "waiting_other": "{{count}} players",
            },
            "netstat": { "columns": { "age": "age" } },
            "notAString": 7,
        });
        let table = flatten(&json);
        assert_eq!(
            table.get("disconnect.title").map(String::as_str),
            Some("Waiting for players")
        );
        assert_eq!(
            table.get("disconnect.waiting_other").map(String::as_str),
            Some("{{count}} players")
        );
        assert_eq!(
            table.get("netstat.columns.age").map(String::as_str),
            Some("age")
        );
        assert!(!table.contains_key("notAString"));
    }

    #[test]
    fn lookup_falls_back_through_english_to_the_default() {
        let spanish = table_of(&[("a", "es a")]);
        let english = table_of(&[("a", "en a"), ("b", "en b")]);

        assert_eq!(
            resolve(Some(&spanish), Some(&english), "a", "default a"),
            "es a"
        );
        assert_eq!(
            resolve(Some(&spanish), Some(&english), "b", "default b"),
            "en b"
        );
        assert_eq!(
            resolve(Some(&spanish), Some(&english), "c", "default c"),
            "default c"
        );
        assert_eq!(resolve(None, None, "a", "default a"), "default a");
    }

    #[test]
    fn placeholders_take_their_argument_and_unknown_ones_stay_put() {
        let name = "Rhynso";
        let seconds = 31;
        assert_eq!(
            interpolate(
                "{{name}} left after {{seconds}}s",
                &[
                    ("name", &name as &dyn Display),
                    ("seconds", &seconds as &dyn Display),
                ]
            ),
            "Rhynso left after 31s"
        );
        assert_eq!(
            interpolate("hi {{ name }}", &[("name", &name as &dyn Display)]),
            "hi Rhynso"
        );
        assert_eq!(
            interpolate("hi {{who}}", &[("name", &name as &dyn Display)]),
            "hi {{who}}"
        );
        assert_eq!(interpolate("nothing here", &[]), "nothing here");
        assert_eq!(interpolate("{{unclosed", &[]), "{{unclosed");
    }

    #[test]
    fn english_and_spanish_split_one_from_everything_else() {
        for locale in [Locale::En, Locale::Es] {
            assert_eq!(plural_category(locale, 1), PluralCategory::One);
            assert_eq!(plural_category(locale, -1), PluralCategory::One);
            assert_eq!(plural_category(locale, 0), PluralCategory::Other);
            assert_eq!(plural_category(locale, 21), PluralCategory::Other);
        }
        // Spanish alone carries a `many` form, and only for whole millions.
        assert_eq!(
            plural_category(Locale::En, 2_000_000),
            PluralCategory::Other
        );
        assert_eq!(plural_category(Locale::Es, 2_000_000), PluralCategory::Many);
        assert_eq!(
            plural_category(Locale::Es, 1_500_000),
            PluralCategory::Other
        );
    }

    #[test]
    fn korean_and_chinese_have_one_form() {
        for locale in [Locale::Ko, Locale::ZhHans] {
            for count in [0, 1, 2, 5, 11, 21, 101] {
                assert_eq!(plural_category(locale, count), PluralCategory::Other);
            }
        }
    }

    #[test]
    fn russian_follows_the_cldr_teens_exceptions() {
        let expected = [
            (0, PluralCategory::Many),
            (1, PluralCategory::One),
            (2, PluralCategory::Few),
            (4, PluralCategory::Few),
            (5, PluralCategory::Many),
            (11, PluralCategory::Many),
            (12, PluralCategory::Many),
            (14, PluralCategory::Many),
            (21, PluralCategory::One),
            (22, PluralCategory::Few),
            (25, PluralCategory::Many),
            (111, PluralCategory::Many),
            (121, PluralCategory::One),
        ];
        for (count, category) in expected {
            assert_eq!(
                plural_category(Locale::Ru, count),
                category,
                "count {count}"
            );
        }
    }

    #[test]
    fn plural_lookup_prefers_the_language_then_english_then_the_call_site() {
        let russian = table_of(&[
            ("slots_one", "{{count}} слот"),
            ("slots_few", "{{count}} слота"),
            ("slots_other", "{{count}} слотов"),
        ]);
        let english = table_of(&[
            ("slots_one", "{{count}} slot"),
            ("slots_other", "{{count}} slots"),
            ("only_en_other", "{{count}} others"),
        ]);

        let pick = |count| {
            resolve_plural(
                Some(&russian),
                Locale::Ru,
                Some(&english),
                "slots",
                count,
                "one",
                "other",
            )
        };
        assert_eq!(pick(1), "{{count}} слот");
        assert_eq!(pick(3), "{{count}} слота");
        // Russian `many` is missing, so the language's own `other` is used before English is.
        assert_eq!(pick(7), "{{count}} слотов");

        // A key only English carries falls through to it, in English's own category.
        assert_eq!(
            resolve_plural(
                Some(&russian),
                Locale::Ru,
                Some(&english),
                "only_en",
                3,
                "one",
                "other"
            ),
            "{{count}} others"
        );
        // A key nobody carries ends at the call site's text.
        assert_eq!(
            resolve_plural(None, Locale::Ru, None, "missing", 1, "one", "other"),
            "one"
        );
        assert_eq!(
            resolve_plural(None, Locale::Ru, None, "missing", 5, "one", "other"),
            "other"
        );
    }

    #[test]
    fn language_tags_resolve_including_regional_variants() {
        assert_eq!(Locale::from_tag("en"), Some(Locale::En));
        assert_eq!(Locale::from_tag("EN"), Some(Locale::En));
        assert_eq!(Locale::from_tag("zh-Hans"), Some(Locale::ZhHans));
        assert_eq!(Locale::from_tag("zh-hans"), Some(Locale::ZhHans));
        assert_eq!(Locale::from_tag("ko-KR"), Some(Locale::Ko));
        assert_eq!(Locale::from_tag("es-419"), Some(Locale::Es));
        assert_eq!(Locale::from_tag("zh-Hant"), None);
        assert_eq!(Locale::from_tag("de"), None);
        assert_eq!(Locale::from_tag(""), None);
    }

    #[test]
    fn every_locale_round_trips_through_its_index() {
        for locale in Locale::ALL {
            assert_eq!(Locale::from_index(locale.index() as u8), locale);
            assert_eq!(Locale::from_tag(locale.tag()), Some(locale));
        }
    }

    #[cfg(feature = "preview")]
    #[test]
    fn the_pseudolocale_expands_text_and_leaves_placeholders_alone() {
        let text = pseudolocalize("Drop {{name}}");
        assert!(text.starts_with('['), "{text}");
        assert!(text.ends_with(']'), "{text}");
        assert!(text.contains("{{name}}"), "{text}");
        assert!(text.contains("Đřóþ"), "{text}");
        assert!(
            text.chars().filter(|&c| c == '~').count() >= 4,
            "expected ~35% padding: {text}"
        );
    }
}
