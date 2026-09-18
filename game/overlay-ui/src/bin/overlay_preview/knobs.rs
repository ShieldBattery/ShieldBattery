//! The preview's persisted state: everything the knob panel can change.

use std::path::PathBuf;

use overlay_ui::i18n::Locale;
use serde::{Deserialize, Serialize};

use crate::scenarios::{ScenarioKind, disconnect, kitchen_sink, netstat};
use crate::virtual_screen::{ResolutionPreset, ScaleMode};

/// How the emulated screen is set up.
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ScreenKnobs {
    pub preset: ResolutionPreset,
    pub scale_mode: ScaleMode,
    /// The design's opt-in compact ramp, which divides the scale so the overlay takes less of a
    /// high-resolution screen.
    pub compact_ramp: bool,
}

/// What is drawn behind the overlay on the emulated screen.
#[derive(Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Backdrop {
    /// A frame of real gameplay from the crate's `backdrops/` directory, so an overlay is judged
    /// over what it actually covers rather than over a flat fill. Falls back to the solid fill when
    /// no capture has been dropped there.
    #[default]
    Gameplay,
    /// A plain dark fill, for reading a color or an edge without a scene under it.
    SolidDark,
    /// A PNG from disk, stretched to the emulated screen.
    File(String),
}

impl Backdrop {
    /// How this backdrop names itself in a message about it.
    pub fn describe(&self) -> String {
        match self {
            Backdrop::Gameplay => "the gameplay frame in `backdrops/`".to_string(),
            Backdrop::SolidDark => "a solid fill".to_string(),
            Backdrop::File(path) => format!("`{path}`"),
        }
    }
}

/// Every persisted knob. Each field defaults independently, so a knobs file written by an older
/// build still loads and only the fields it knows about are restored.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    pub scenario: ScenarioKind,
    pub screen: ScreenKnobs,
    /// Whether the minimap and console reserves are outlined over the emulated screen.
    pub show_guides: bool,
    /// What is drawn behind the overlay.
    pub backdrop: Backdrop,
    /// The language the overlay speaks. Applied before every pass, so switching it re-lays out the
    /// live screen the way a player with that language set would see it.
    pub language: Locale,
    /// Draws every string accented, bracketed and padded out to roughly 135% of its English length,
    /// which is what a layout has to survive before any translator has written a word of it.
    pub pseudolocale: bool,
    pub disconnect: disconnect::Knobs,
    pub kitchen_sink: kitchen_sink::Knobs,
    pub netstat: netstat::Knobs,
}

/// Where the persisted knobs live: next to the built binary, so a checkout's `target/` carries them.
fn path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.with_file_name("overlay-preview-knobs.json"))
}

pub fn load() -> Knobs {
    let Some(path) = path() else {
        return Knobs::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|err| {
            eprintln!("overlay-preview: ignoring unreadable knobs file ({err})");
            Knobs::default()
        }),
        Err(_) => Knobs::default(),
    }
}

pub fn save(knobs: &Knobs) {
    let Some(path) = path() else {
        return;
    };
    match serde_json::to_string_pretty(knobs) {
        Ok(text) => {
            if let Err(err) = std::fs::write(&path, text) {
                eprintln!("overlay-preview: could not save knobs ({err})");
            }
        }
        Err(err) => eprintln!("overlay-preview: could not serialize knobs ({err})"),
    }
}
