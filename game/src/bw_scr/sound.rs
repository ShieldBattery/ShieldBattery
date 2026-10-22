use hashbrown::HashMap;
use libc::c_void;
use parking_lot::Mutex;

use super::{BwScr, Value, scr};
use crate::bw;
use crate::bw_scr::scr::SafeBwString;

/// The game's sound table, entry points, and cached name lookups.
pub(super) struct Sound {
    /// Base of SC:R's loaded `rez/sfx.json` entry array (indexed by sound id). `None` if
    /// unlocated.
    sfx_data: Option<Value<*mut scr::SfxDataEntry>>,
    lookup_sound_id: unsafe extern "C" fn(*const scr::BwString) -> u32,
    play_sound: unsafe extern "C" fn(u32, f32, *mut c_void, *mut i32, *mut i32) -> u32,
    sound_id_cache: Mutex<HashMap<String, u32>>,
}

impl Sound {
    pub(super) fn new(
        sfx_data: Option<Value<*mut scr::SfxDataEntry>>,
        lookup_sound_id: unsafe extern "C" fn(*const scr::BwString) -> u32,
        play_sound: unsafe extern "C" fn(u32, f32, *mut c_void, *mut i32, *mut i32) -> u32,
    ) -> Self {
        Self {
            sfx_data,
            lookup_sound_id,
            play_sound,
            sound_id_cache: Mutex::new(HashMap::new()),
        }
    }

    pub(super) fn play_address(&self) -> usize {
        self.play_sound as usize
    }

    /// Look up the ID for a given sound. Note that unknown IDs will cause a crash.
    fn lookup_sound(&self, id: impl Into<String>) -> u32 {
        let id = id.into();
        let mut cache = self.sound_id_cache.lock();
        if let Some(sound_id) = cache.get(&id).copied() {
            return sound_id;
        }

        let result = unsafe {
            let mut id: SafeBwString = (&id).into();
            (self.lookup_sound_id)(id.borrow().as_ptr())
        };
        // NOTE(tec27): We could use this more as an LRU cache, but there's such a small number of
        // possible sounds that it doesn't really seem worth it to me.
        cache.insert(id, result);
        result
    }

    pub(super) fn fix_zoom_ignoring_effect_sounds(&self) {
        let Some(sfx_data) = self.sfx_data else {
            return;
        };
        let base = unsafe { sfx_data.resolve() };
        if base.is_null() {
            warn!("sfx_data is null, not fixing zoom-ignoring effect sounds");
            return;
        }
        for &(id, file_name) in ZOOM_IGNORING_EFFECT_SOUNDS {
            let index = self.lookup_sound(id) as usize;
            if index >= 0x1000 {
                warn!("Sound {id} has implausible index {index:#x}, skipping");
                continue;
            }
            unsafe {
                let entry = &mut *base.add(index);
                if !entry.file_path.is_plausible() {
                    warn!("Sound {id} (index {index}) has an implausible file path, skipping");
                    continue;
                }
                let path = entry.file_path.as_bytes();
                let actual_name = path
                    .rsplit(|&b| b == b'/' || b == b'\\')
                    .next()
                    .unwrap_or(&[]);
                if !actual_name.eq_ignore_ascii_case(file_name.as_bytes()) {
                    warn!(
                        "Sound {id} (index {index}) has file path {:?}, expected {file_name}, skipping",
                        String::from_utf8_lossy(path),
                    );
                    continue;
                }
                match entry.unit_speech {
                    0 => {}
                    1 => {
                        entry.unit_speech = 0;
                        debug!("Cleared unitSpeech on {id} (index {index})");
                    }
                    other => {
                        warn!("Sound {id} (index {index}) has unitSpeech = {other}, skipping");
                    }
                }
            }
        }
    }

    /// Plays the specified sound. These IDs can be found in rez/sfx.json in the game files.
    /// Unknown sound IDs will cause a crash.
    pub(super) fn play_sound(&self, id: impl Into<String>) {
        unsafe {
            (self.play_sound)(
                self.lookup_sound(id),
                1.0, // volume
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
        }
    }

    /// Asks BW to play a sound effect for `unit` at its current position, or without a unit at a
    /// map position, or unpositioned when `position` is `None`, through the same entry point the
    /// simulation's own sound requests take.
    pub(super) unsafe fn rollback_play_sound(
        &self,
        sound_id: u32,
        volume: f32,
        position: Option<(i32, i32)>,
        unit: Option<*mut bw::Unit>,
    ) -> u32 {
        unsafe {
            let mut coords = position.unwrap_or_default();
            let (x, y) = match position {
                Some(_) => (&raw mut coords.0, &raw mut coords.1),
                None => (std::ptr::null_mut(), std::ptr::null_mut()),
            };
            let unit = unit.map_or(std::ptr::null_mut(), |x| x as *mut c_void);
            (self.play_sound)(sound_id, volume, unit, x, y)
        }
    }
}

/// (sfx.json ID, file name) of every iscript-played effect whose `rez/sfx.json` entry has
/// `unitSpeech` set: the zealot, queen and critter deaths and the yamato cannon. Every other unit
/// death is unflagged. See [`BwScr::fix_zoom_ignoring_effect_sounds`].
const ZOOM_IGNORING_EFFECT_SOUNDS: &[(&str, &str)] = &[
    ("SND_ZEALOT_DEAD", "PZeDth00.WAV"),
    ("SND_FIRST_QUEEN_DEAD", "ZQuDth00.WAV"),
    ("SND_QUEEN_DEAD_1", "ZQuDth01.WAV"),
    ("SND_LAST_QUEEN_DEAD", "ZQuDth02.WAV"),
    ("SND_JUNGLE_CRITTER_DEATH", "JCrDth00.wav"),
    ("SND_LAVA_CRITTER_DEATH", "LCrDth00.wav"),
    ("SND_BADLANDS_CRITTER_DEATH", "BCrDth00.wav"),
    ("SND_ICE_CRITTER_DEATH", "PBDeath01.wav"),
    ("SND_DESERT_CRITTER_DEATH", "ScDeath01.wav"),
    ("SND_TWILIGHT_CRITTER_DEATH", "TerDeath01.wav"),
    ("SND_YAMATO_CHARGE", "tBaYam01.wav"),
    ("SND_YAMATO_BLAST", "tBaYam02.wav"),
];

impl BwScr {
    /// Clears the `unitSpeech` flag on the ordinary positional effects that carry it in
    /// `rez/sfx.json` (see [`ZOOM_IGNORING_EFFECT_SOUNDS`]).
    ///
    /// SC:R's positional volume calculation scales by the camera zoom factor unless the sound is
    /// flagged as unit speech, so selection/acknowledgement lines stay at full volume however far
    /// out an observer or replay viewer zooms. The effects in that list are flagged the same way,
    /// so they play at full volume while every other effect fades with the zoom. They are only
    /// ever played from iscripts, without a unit context, so the flag's other role (one speech
    /// line per unit type at a time) never applies to them and clearing it changes nothing else.
    ///
    /// Every entry is checked against its expected file name before being written, so a layout
    /// change in a future game patch leaves the table untouched instead of corrupting it.
    pub fn fix_zoom_ignoring_effect_sounds(&self) {
        self.sound.fix_zoom_ignoring_effect_sounds();
    }

    /// Plays the specified sound. These IDs can be found in rez/sfx.json in the game files.
    /// Unknown sound IDs will cause a crash.
    pub fn play_sound(&self, id: impl Into<String>) {
        self.sound.play_sound(id);
    }

    /// Asks BW to play a sound effect for `unit` at its current position, or without a unit at a
    /// map position, or unpositioned when `position` is `None`, through the same entry point the
    /// simulation's own sound requests take.
    pub(crate) unsafe fn rollback_play_sound(
        &self,
        sound_id: u32,
        volume: f32,
        position: Option<(i32, i32)>,
        unit: Option<*mut bw::Unit>,
    ) -> u32 {
        unsafe {
            self.sound
                .rollback_play_sound(sound_id, volume, position, unit)
        }
    }
}
