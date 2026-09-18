//! Embeds the in-game UI's translation catalogs into the binary.
//!
//! The catalogs are the app's own i18next JSON files (`server/public/locales/<lang>/game.json`):
//! the English one is generated from the `tr!` / `tr_plural!` calls in the Rust sources, the rest
//! by the translation tooling. Any of them may be absent — a language nobody has translated yet
//! simply isn't embedded, and the overlay falls back to English — so a missing file is never a
//! build error.

use std::path::{Path, PathBuf};

/// Every language the overlay can be built with, as the `Locale` variant and the i18next tag whose
/// directory holds its catalog.
const LOCALES: [(&str, &str); 5] = [
    ("En", "en"),
    ("Es", "es"),
    ("Ko", "ko"),
    ("Ru", "ru"),
    ("ZhHans", "zh-Hans"),
];

/// The namespace the in-game UI's strings live in, which is also the catalog's file stem.
const NAMESPACE: &str = "game";

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("cargo always sets CARGO_MANIFEST_DIR"),
    );
    let locales_dir = manifest_dir.join("../../server/public/locales");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("cargo always sets OUT_DIR"));

    let mut entries = String::new();
    for (variant, tag) in LOCALES {
        let language_dir = locales_dir.join(tag);
        let catalog = language_dir.join(format!("{NAMESPACE}.json"));
        // The directory is watched as well as the file: a catalog that does not exist yet has no
        // mtime to compare against, so only its directory can tell cargo that it appeared.
        rerun_if_changed(&language_dir);
        rerun_if_changed(&catalog);
        if !catalog.is_file() {
            continue;
        }
        // Copied into OUT_DIR so `include_str!` can name it relatively, which keeps the generated
        // file free of absolute paths and their escaping.
        let embedded_name = format!("{tag}.json");
        std::fs::copy(&catalog, out_dir.join(&embedded_name))
            .unwrap_or_else(|err| panic!("could not stage {}: {err}", catalog.display()));
        entries.push_str(&format!(
            "    (Locale::{variant}, include_str!(\"{embedded_name}\")),\n"
        ));
    }

    let generated = format!(
        "/// Every catalog that existed at build time, as raw i18next JSON.\n\
         pub static LOCALE_JSON: &[(Locale, &str)] = &[\n{entries}];\n"
    );
    let generated_path = out_dir.join("locales.rs");
    std::fs::write(&generated_path, generated)
        .unwrap_or_else(|err| panic!("could not write {}: {err}", generated_path.display()));
}

fn rerun_if_changed(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
}
