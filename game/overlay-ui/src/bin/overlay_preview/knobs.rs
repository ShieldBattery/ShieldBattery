//! The preview's persisted state: everything the knob panel can change.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::scenarios::{ScenarioKind, disconnect, netstat};
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

/// Every persisted knob. Each field defaults independently, so a knobs file written by an older
/// build still loads and only the fields it knows about are restored.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    pub scenario: ScenarioKind,
    pub screen: ScreenKnobs,
    /// Whether the minimap and console reserves are outlined over the emulated screen.
    pub show_guides: bool,
    /// Optional PNG backdrop behind the overlay; solid dark when absent.
    pub backdrop_path: Option<String>,
    pub disconnect: disconnect::Knobs,
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
