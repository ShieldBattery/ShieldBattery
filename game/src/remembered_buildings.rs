//! What each player of a replay remembers of the other players' buildings, so that the remembered
//! buildings SC:R shows in fog (its fog sprites) can be rebuilt for whichever replay visions are
//! on.
//!
//! SC:R keeps one set of fog sprites, for the players whose vision the replay shows
//! (`local_visions`): a building gets one as it drops out of their sight, a frozen copy of how it
//! looked, and the copy goes once its spot is back in their sight, whether the building is still
//! there or not. Changing the visions doesn't rebuild that set, and a keyframe holds the set of
//! whatever visions were on when it was taken.
//!
//! This keeps the same thing for every player at once, from the visibility SC:R works out for
//! every player and sprite each frame whatever the replay visions are (shared vision included).
//! Each time players lose sight of a building it takes a copy, shared by every player who lost
//! sight on that frame, and notes which players still saw the building then and which have seen
//! the copy's spot since. SC:R's set for a combination of visions is then exactly the copies taken
//! when the last of those players to see the building lost sight of it, whose spot none of them
//! has seen since. The set is rebuilt from that whenever the visions change or a keyframe is
//! restored, and SC:R keeps it up from there.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};

use parking_lot::Mutex;
use smallvec::SmallVec;

use crate::bw::{self, Bw};
use crate::bw_scr::{BwScr, scr};
use crate::game_thread;

/// A frozen copy of a building's sprite and images, as SC:R's fog sprite of it holds them.
pub struct RememberedLook {
    pub unit_id: u16,
    pub sprite: scr::Sprite,
    pub images: SmallVec<[bw::Image; 4]>,
    /// Which of `images` is the sprite's main image.
    pub main_image: Option<usize>,
}

// SAFETY: the pointers in a look point at SC:R's game data, which only the game thread touches,
// and only the game thread reads or writes the record that holds looks.
unsafe impl Send for RememberedLook {}
unsafe impl Sync for RememberedLook {}

/// What every player remembers at one frame. Cloned into each replay keyframe, sharing the copies.
#[derive(Clone, Default)]
pub struct Record {
    copies: Vec<Remembered>,
}

#[derive(Clone)]
struct Remembered {
    copy: Arc<Copy>,
    /// Players who have seen the copy's spot since it was taken.
    seen_since: u8,
}

struct Copy {
    /// Players who lost sight of the building on the frame the copy was taken.
    lost: u8,
    /// Players who still saw the building on that frame.
    still_seen: u8,
    /// The tiles whose sight removes the copy.
    area: TileArea,
    look: RememberedLook,
}

/// A rectangle of map tiles, which may reach off the map.
#[derive(Copy, Clone)]
pub struct TileArea {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

impl TileArea {
    /// The tiles SC:R checks for a fog sprite of a `unit_id` drawn at `x`, `y`, both to see
    /// whether to remove it and, for the unit itself, whether it is in sight: the unit type's
    /// units.dat placement box, centered there.
    fn of_placement(unit_id: u16, position: (i16, i16)) -> TileArea {
        let placement = bw_dat::UnitId(unit_id).placement();
        TileArea::centered(placement.width, placement.height, position)
    }

    /// The tiles under a `width` by `height` pixel box centered at `x`, `y`, rounded the way SC:R
    /// rounds them: the corner divided down toward zero, the size up to whole tiles.
    fn centered(width: u16, height: u16, (x, y): (i16, i16)) -> TileArea {
        let (width, height) = (i32::from(width), i32::from(height));
        TileArea {
            left: (i32::from(x) - width / 2) / 32,
            top: (i32::from(y) - height / 2) / 32,
            width: (width + 31) / 32,
            height: (height + 31) / 32,
        }
    }
}

impl Remembered {
    /// Whether SC:R, showing the visions in `visions` since the replay began, would hold this copy
    /// as a fog sprite now.
    fn shown_to(&self, visions: u8) -> bool {
        self.copy.lost & visions != 0
            && self.copy.still_seen & visions == 0
            && self.seen_since & visions == 0
    }

    /// Whether some combination of visions still shows this copy: a player who lost sight of the
    /// building on its frame hasn't seen its spot since.
    fn remembered(&self) -> bool {
        self.copy.lost & !self.seen_since != 0
    }
}

impl Record {
    /// The heap memory this record holds, with each copy's split evenly between the records
    /// sharing it, so that the keyframes and the live record holding a copy add up to it once.
    pub fn heap_bytes(&self) -> usize {
        self.copies.capacity() * size_of::<Remembered>()
            + self
                .copies
                .iter()
                .map(|x| x.copy.heap_bytes() / Arc::strong_count(&x.copy))
                .sum::<usize>()
    }
}

impl Copy {
    fn heap_bytes(&self) -> usize {
        let images = match self.look.images.spilled() {
            true => self.look.images.capacity() * size_of::<bw::Image>(),
            false => 0,
        };
        size_of::<Copy>() + images
    }
}

/// The record of the replay being played, kept only while one is.
static RECORD: Mutex<Option<Record>> = Mutex::new(None);

/// Whether SC:R's visibility update is hooked, which is where the record takes its copies.
static HOOKED: AtomicBool = AtomicBool::new(false);

/// Whether the game being stepped keeps a record, as of the start of its latest step.
static KEEPS_RECORD: AtomicBool = AtomicBool::new(false);

/// The replay visions SC:R's fog sprites were last rebuilt for (see [`visions_key`]), or
/// [`NO_VISIONS`] before the first step.
static BUILT_FOR: AtomicU16 = AtomicU16::new(NO_VISIONS);

const NO_VISIONS: u16 = u16::MAX;

/// The replay visions as one value: the players' bits, and whether the entire map is shown.
fn visions_key(visions: &bw::ReplayVisions) -> u16 {
    u16::from(visions.players) | (u16::from(visions.show_entire_map) << 8)
}

pub fn set_hooked() {
    HOOKED.store(true, Ordering::Relaxed);
}

/// Starts the record over for the game being initialized.
pub fn reset_for_game_init() {
    *RECORD.lock() = None;
    KEEPS_RECORD.store(false, Ordering::Relaxed);
    BUILT_FOR.store(NO_VISIONS, Ordering::Relaxed);
}

/// Whether this game keeps a record: a replay, other than a Use Map Settings one, whose triggers
/// can change state the record doesn't follow.
fn keeps_record() -> bool {
    if !HOOKED.load(Ordering::Relaxed) || !game_thread::is_replay() || game_thread::is_ums() {
        return false;
    }
    // The rollback harness and bench play a replay as a stand-in for a live game.
    #[cfg(debug_assertions)]
    if crate::rollback_harness::armed() || crate::rollback_bench::armed() {
        return false;
    }
    true
}

/// Called as a game step begins. Catches up with a change of the replay visions that didn't come
/// through [`rebuild`], such as SC:R taking away the vision of a player who left.
pub unsafe fn begin_step(bw: &BwScr) {
    unsafe {
        let keeps_record = keeps_record();
        KEEPS_RECORD.store(keeps_record, Ordering::Relaxed);
        if !keeps_record {
            return;
        }
        let visions = visions_key(&bw.replay_visions());
        match BUILT_FOR.load(Ordering::Relaxed) {
            NO_VISIONS => BUILT_FOR.store(visions, Ordering::Relaxed),
            built if built != visions => rebuild(bw),
            _ => (),
        }
    }
}

/// The units SC:R gives a fog sprite besides landed buildings: the traps and doors.
const TRAPS_AND_DOORS: std::ops::RangeInclusive<u16> = 0xcb..=0xd5;

/// The sprite whose visibility the record follows for `unit`: that of a unit SC:R would give a fog
/// sprite on losing sight of it (a landed building, trap or door that isn't in the middle of
/// dying), drawn as one of the players a replay shows the vision of.
///
/// The sprite's player rather than the unit's: the buildings of a player who leaves turn neutral
/// but keep their player's sprite, and SC:R keeps giving them fog sprites.
unsafe fn followed_sprite(unit: *mut bw::Unit) -> Option<*const scr::Sprite> {
    unsafe {
        let unit = bw_dat::Unit::from_ptr(unit)?;
        if !(unit.is_landed_building() || TRAPS_AND_DOORS.contains(&unit.id().0))
            || (unit.order() == bw_dat::order::DIE && unit.order_state() == 1)
        {
            return None;
        }
        let sprite = (**unit).flingy.sprite as *const scr::Sprite;
        (!sprite.is_null() && (*sprite).player < 8).then_some(sprite)
    }
}

/// Which players saw `unit` before SC:R works out its visibility again, if the record follows it.
pub unsafe fn visibility_before_update(unit: *mut bw::Unit) -> Option<u8> {
    unsafe {
        if !KEEPS_RECORD.load(Ordering::Relaxed) {
            return None;
        }
        followed_sprite(unit).map(|sprite| (*sprite).visibility_mask)
    }
}

/// Takes a copy of `unit` if players lost sight of it as SC:R worked out its visibility again,
/// which is when SC:R copies a building the local visions lose sight of.
pub unsafe fn after_visibility_update(bw: &BwScr, unit: *mut bw::Unit, before: Option<u8>) {
    unsafe {
        let Some(before) = before else {
            return;
        };
        let Some(sprite) = followed_sprite(unit) else {
            return;
        };
        let now = (*sprite).visibility_mask;
        let lost = before & !now;
        if lost == 0 {
            return;
        }
        let Some(unit) = bw_dat::Unit::from_ptr(unit) else {
            return;
        };
        let look = bw.remembered_look(unit);
        let area = TileArea::of_placement(look.unit_id, bw.sprite_pixel_position(&look.sprite));
        RECORD
            .lock()
            .get_or_insert_default()
            .copies
            .push(Remembered {
                copy: Arc::new(Copy {
                    lost,
                    still_seen: now,
                    area,
                    look,
                }),
                seen_since: 0,
            });
    }
}

/// Notes whose sight fell on the copies' spots during a game step, and drops the copies nobody
/// remembers any more.
pub unsafe fn after_step(bw: &BwScr) {
    unsafe {
        if !KEEPS_RECORD.load(Ordering::Relaxed) {
            return;
        }
        let mut record = RECORD.lock();
        let record = record.get_or_insert_default();
        for remembered in &mut record.copies {
            remembered.seen_since |= bw.players_seeing_tiles(remembered.copy.area);
        }
        record.copies.retain(Remembered::remembered);
        #[cfg(debug_assertions)]
        check::after_step(bw, record);
    }
}

/// Replaces SC:R's fog sprites of players' buildings with the ones the visions shown now would
/// hold, had they been shown since the replay began. Called whenever the visions change, and
/// after a keyframe restore.
pub unsafe fn rebuild(bw: &BwScr) {
    unsafe {
        if !keeps_record() {
            return;
        }
        let visions = bw.replay_visions();
        BUILT_FOR.store(visions_key(&visions), Ordering::Relaxed);
        let record = RECORD.lock();
        let Some(record) = record.as_ref() else {
            return;
        };
        bw.remove_player_fow_sprites();
        if visions.show_entire_map {
            return;
        }
        for remembered in record.copies.iter().filter(|x| x.shown_to(visions.players)) {
            if bw.create_fow_sprite_from(&remembered.copy.look).is_none() {
                warn!("Ran out of fog sprites rebuilding the remembered buildings");
                return;
            }
        }
    }
}

/// The record as it is now, for a replay keyframe to hold.
pub fn snapshot() -> Option<Record> {
    RECORD.lock().clone()
}

/// Puts back the record a replay keyframe held, and rebuilds SC:R's fog sprites from it for the
/// visions shown now, as the keyframe's own are those of the visions shown when it was taken.
pub unsafe fn restore(bw: &BwScr, record: Option<Record>) {
    unsafe {
        *RECORD.lock() = record;
        rebuild(bw);
    }
}

/// `SB_DEBUG_REMEMBERED_BUILDINGS_CHECK=1`: every [`check::INTERVAL`] frames, compares the
/// copies the visions shown now get from the record with SC:R's own fog sprites, which are the
/// right ones whenever those visions have been shown since the replay began. Also logs a hash of
/// the copies other visions get (each player's alone, or the masks
/// `SB_DEBUG_REMEMBERED_BUILDINGS_VIEWS` lists), to compare with runs showing those from the start.
#[cfg(debug_assertions)]
mod check {
    use std::sync::atomic::{AtomicU8, Ordering};

    use super::*;

    pub const INTERVAL: u32 = 240;

    /// 0 unread, 1 off, 2 on.
    static ENABLED: AtomicU8 = AtomicU8::new(0);

    fn enabled() -> bool {
        match ENABLED.load(Ordering::Relaxed) {
            0 => {
                let on =
                    std::env::var("SB_DEBUG_REMEMBERED_BUILDINGS_CHECK").is_ok_and(|x| x == "1");
                ENABLED.store(if on { 2 } else { 1 }, Ordering::Relaxed);
                on
            }
            x => x == 2,
        }
    }

    /// What tells two fog sprites apart: the building type, where it is, and how it looks (main
    /// image, its frame and draw function, and the sprite's elevation).
    type Key = (u16, i16, i16, u16, u16, u8, u8);

    unsafe fn key_of(
        bw: &BwScr,
        unit_id: u16,
        sprite: *const scr::Sprite,
        main: *const bw::Image,
    ) -> Key {
        unsafe {
            let (x, y) = bw.sprite_pixel_position(sprite);
            let (image_id, frame, drawfunc) = match main.is_null() {
                true => (0, 0, 0),
                false => ((*main).image_id, (*main).frame, (*main).drawfunc),
            };
            (
                unit_id,
                x,
                y,
                image_id,
                frame,
                drawfunc,
                (*sprite).elevation_level,
            )
        }
    }

    fn hash(keys: &[Key]) -> u64 {
        keys.iter().fold(
            0u64,
            |acc, &(unit_id, x, y, image_id, frame, drawfunc, elevation)| {
                let key = (u64::from(unit_id) << 48)
                    ^ (u64::from(x as u16) << 32)
                    ^ (u64::from(y as u16) << 16)
                    ^ u64::from(image_id)
                    ^ (u64::from(frame) << 56)
                    ^ (u64::from(drawfunc) << 40)
                    ^ (u64::from(elevation) << 24);
                acc.wrapping_add(key.wrapping_mul(0x9e37_79b9_7f4a_7c15).rotate_left(23))
            },
        )
    }

    unsafe fn record_keys(bw: &BwScr, record: &Record, visions: u8) -> Vec<Key> {
        unsafe {
            let mut keys = record
                .copies
                .iter()
                .filter(|x| x.shown_to(visions))
                .map(|x| {
                    let look = &x.copy.look;
                    let main = look
                        .main_image
                        .map_or(std::ptr::null(), |i| &raw const look.images[i]);
                    key_of(bw, look.unit_id, &look.sprite, main)
                })
                .collect::<Vec<_>>();
            keys.sort_unstable();
            keys
        }
    }

    pub unsafe fn after_step(bw: &BwScr, record: &Record) {
        unsafe {
            let frame = (*bw.game()).frame_count;
            if !frame.is_multiple_of(INTERVAL) || !enabled() {
                return;
            }
            let visions = bw.replay_visions();
            if visions.show_entire_map {
                return;
            }
            let mut game = bw
                .fow_sprites()
                .filter_map(|fow| {
                    let sprite = (*fow).sprite as *const scr::Sprite;
                    ((*sprite).player < 8)
                        .then(|| key_of(bw, (*fow).unit_id, sprite, (*sprite).main_image))
                })
                .collect::<Vec<_>>();
            game.sort_unstable();
            let ours = record_keys(bw, record, visions.players);
            // Each player's vision alone, or the masks `SB_DEBUG_REMEMBERED_BUILDINGS_VIEWS` lists
            // (hex, comma-separated).
            let masks = std::env::var("SB_DEBUG_REMEMBERED_BUILDINGS_VIEWS")
                .ok()
                .map(|x| {
                    x.split(',')
                        .filter_map(|x| {
                            u8::from_str_radix(x.trim().trim_start_matches("0x"), 16).ok()
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| (0..8).map(|player| 1 << player).collect());
            let singles = masks
                .iter()
                .map(|&mask| format!("{mask:02x}={:016x}", hash(&record_keys(bw, record, mask))))
                .collect::<Vec<_>>();
            if ours == game {
                info!(
                    "Remembered buildings check frame {frame}: {} match for visions {:#04x}, game \
                     hash {:016x}, view hashes {singles:?}, {} copies kept",
                    game.len(),
                    visions.players,
                    hash(&game),
                    record.copies.len(),
                );
            } else {
                let missing = game
                    .iter()
                    .filter(|x| !ours.contains(x))
                    .collect::<Vec<_>>();
                let extra = ours
                    .iter()
                    .filter(|x| !game.contains(x))
                    .collect::<Vec<_>>();
                warn!(
                    "Remembered buildings check frame {frame}: MISMATCH for visions {:#04x}: \
                     game has {} and the record {}; only in the game {missing:?}, only in the \
                     record {extra:?}; view hashes {singles:?}",
                    visions.players,
                    game.len(),
                    ours.len(),
                );
            }
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn copy(lost: u8, still_seen: u8) -> Arc<Copy> {
        Arc::new(Copy {
            lost,
            still_seen,
            area: TileArea::centered(128, 96, (64, 48)),
            // SAFETY: plain data, never drawn or dereferenced here.
            look: RememberedLook {
                unit_id: 0,
                sprite: unsafe { std::mem::zeroed() },
                images: SmallVec::new(),
                main_image: None,
            },
        })
    }

    fn remembered(lost: u8, still_seen: u8, seen_since: u8) -> Remembered {
        Remembered {
            copy: copy(lost, still_seen),
            seen_since,
        }
    }

    #[test]
    fn a_copy_shows_to_visions_that_lost_the_building_on_its_frame() {
        let x = remembered(0b0011, 0, 0);
        assert!(x.shown_to(0b0001));
        assert!(x.shown_to(0b0011));
        assert!(x.shown_to(0b0111));
        assert!(!x.shown_to(0b0100));
    }

    #[test]
    fn a_copy_doesnt_show_while_another_shown_vision_still_saw_the_building() {
        let x = remembered(0b0001, 0b0010, 0);
        assert!(x.shown_to(0b0001));
        assert!(!x.shown_to(0b0011));
    }

    #[test]
    fn a_copy_doesnt_show_to_visions_that_have_seen_its_spot_since() {
        let x = remembered(0b0011, 0, 0b0001);
        assert!(!x.shown_to(0b0001));
        assert!(x.shown_to(0b0010));
        assert!(!x.shown_to(0b0011));
        assert!(x.remembered());
        assert!(!remembered(0b0011, 0, 0b0111).remembered());
    }

    #[test]
    fn records_sharing_copies_split_their_memory() {
        let alone = Record {
            copies: vec![remembered(1, 0, 0)],
        };
        let alone_bytes = alone.heap_bytes();
        let shared = alone.clone();
        let share = alone.copies[0].copy.heap_bytes() / 2;
        assert_eq!(alone.heap_bytes(), alone_bytes - share);
        assert_eq!(shared.heap_bytes(), alone.heap_bytes());
    }

    #[test]
    fn tile_areas_round_like_scr() {
        let area = TileArea::centered(128, 96, (64, 48));
        assert_eq!((area.left, area.top, area.width, area.height), (0, 0, 4, 3));
        let area = TileArea::centered(64, 64, (100, 31));
        assert_eq!((area.left, area.top, area.width, area.height), (2, 0, 2, 2));
        // Off the map's top left the corner divides toward zero, as SC:R's does.
        let area = TileArea::centered(128, 96, (16, 16));
        assert_eq!(
            (area.left, area.top, area.width, area.height),
            (-1, -1, 4, 3)
        );
    }
}
