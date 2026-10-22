//! Selection state and transient sprite visuals around simulation snapshots.

use std::mem;
use std::ptr::null_mut;
#[cfg(debug_assertions)]
use std::sync::atomic::AtomicU32;
use std::sync::atomic::{AtomicBool, Ordering};

use libc::c_void;
use scr_analysis::{VirtualAddress, scarf};
use smallvec::SmallVec;

use crate::bw;

use super::{BwScr, Thiscall, Value, scr};

/// The selections tracked by the game and the visuals attached to the local selection.
pub(super) struct SelectionState {
    pub(super) client_selection: Value<*mut *mut bw::Unit>,
    /// What the person watching has selected, as `select_units` keeps it (`client_selection` is
    /// rebuilt from it). `None` if analysis could not find it, which only a game that rolls back
    /// needs.
    pub(super) local_selection: Option<Value<*mut *mut bw::Unit>>,
    /// Each player's selection as the simulation keeps it, a row of `selection_limit` units per
    /// player, which selection commands set. `None` if analysis could not find it, which only a
    /// game that rolls back needs.
    pub(super) simulated_selections: Option<Value<*mut *mut bw::Unit>>,
    /// Whether the rollback engine is changing the local selection itself, rather than the person
    /// watching.
    pub(super) engine_selecting: AtomicBool,
    // select_units(amount, pointers, play_selection_sound, send_selection_command). The command is
    // only worth sending for a player's own selection: a watcher's is local, and the other clients
    // drop a watcher's selection commands unrun.
    pub(super) select_units: unsafe extern "C" fn(usize, *const *mut bw::Unit, u32, u32),
    /// The pair of functions the game brackets a saved game write with, to take the selection
    /// circles and health bars off every sprite and put them back from the local selection, or
    /// `None` if analysis could not find both.
    pub(super) selection_visuals: Option<SelectionVisuals>,
    /// The pools selection circles and health bars come from, which take them off the sprites
    /// carrying them without visiting every sprite, or `None` if analysis could not find them (the
    /// game's own `selection_visuals` pass does it then).
    selection_visual_pools: Option<SelectionVisualPools>,
}

impl SelectionState {
    pub(super) fn new(
        client_selection: Value<*mut *mut bw::Unit>,
        local_selection: Option<Value<*mut *mut bw::Unit>>,
        simulated_selections: Option<Value<*mut *mut bw::Unit>>,
        select_units: unsafe extern "C" fn(usize, *const *mut bw::Unit, u32, u32),
        selection_visuals: Option<SelectionVisuals>,
        selection_visual_pools: Option<SelectionVisualPools>,
    ) -> Self {
        Self {
            client_selection,
            local_selection,
            simulated_selections,
            engine_selecting: AtomicBool::new(false),
            select_units,
            selection_visuals,
            selection_visual_pools,
        }
    }

    unsafe fn clear_visuals(&self) {
        unsafe {
            match (&self.selection_visual_pools, &self.local_selection) {
                (Some(pools), Some(local_selection)) => {
                    // The client selection is rebuilt from the local one, so the two hold the
                    // same units but for the moment between a change and the rebuild.
                    let local = std::slice::from_raw_parts(local_selection.resolve(), 12);
                    let client = std::slice::from_raw_parts(self.client_selection.resolve(), 12);
                    pools.clear(&[local, client]);
                }
                _ => {
                    if let Some(visuals) = &self.selection_visuals {
                        (visuals.clear)();
                    }
                }
            }
        }
    }

    unsafe fn rebuild_visuals(&self) {
        unsafe {
            if let Some(visuals) = &self.selection_visuals {
                (visuals.rebuild)();
            }
        }
    }

    unsafe fn select(&self, units: &[*mut bw::Unit]) {
        unsafe {
            self.engine_selecting.store(true, Ordering::Relaxed);
            (self.select_units)(units.len(), units.as_ptr(), 0, 0);
            self.engine_selecting.store(false, Ordering::Relaxed);
        }
    }
}

/// Every function the simulation calls on the observer UI, the object behind replay and observer
/// production panels. Each takes the observer UI object and the unit the notification is about,
/// and returns nothing.
pub(super) struct ObserverUiCallbacks {
    pub(super) track_building_unit: VirtualAddress,
    pub(super) track_research_or_upgrade: VirtualAddress,
    pub(super) remove_building_unit_record: VirtualAddress,
    pub(super) finish_research_or_upgrade: VirtualAddress,
}

impl ObserverUiCallbacks {
    /// Finds all four, or returns `None` (and says which is missing) if any of them is not found.
    pub(super) fn analyze(
        analysis: &mut scr_analysis::Analysis<'_>,
    ) -> Option<ObserverUiCallbacks> {
        let find = |name: &str, address: Option<VirtualAddress>| {
            if address.is_none() {
                warn!("Analysis could not find the observer UI's {name}");
            }
            address
        };
        Some(ObserverUiCallbacks {
            track_building_unit: find(
                "track_building_unit",
                analysis.observer_ui_track_building_unit(),
            )?,
            track_research_or_upgrade: find(
                "track_research_or_upgrade",
                analysis.observer_ui_track_research_or_upgrade(),
            )?,
            remove_building_unit_record: find(
                "remove_building_unit_record",
                analysis.observer_ui_remove_building_unit_record(),
            )?,
            finish_research_or_upgrade: find(
                "finish_research_or_upgrade",
                analysis.observer_ui_finish_research_or_upgrade(),
            )?,
        })
    }
}

/// The game's own way of getting selection circles and health bars, which are images in the same
/// pool as the simulation's, out of a copy of the game state and back again.
pub(super) struct SelectionVisuals {
    clear: unsafe extern "C" fn(),
    rebuild: unsafe extern "C" fn(),
}

/// A selected unit, by what tells it apart from a later occupant of its slot in the unit pool.
#[derive(Copy, Clone)]
pub(crate) struct SelectedUnit {
    unit: *mut bw::Unit,
    /// Changes each time the slot is given to a new unit.
    generation: u8,
    /// A unit that changes owner leaves its old owner's selection.
    player: u8,
    /// What the unit was when selected. Not part of telling it apart: a unit stays the same one
    /// when it turns into another kind (a drone into a building, a larva into an egg).
    unit_id: u16,
}

// Only ever dereferenced on the game thread, and the unit pool it points into lasts the game.
unsafe impl Send for SelectedUnit {}

impl SelectedUnit {
    unsafe fn of(unit: *mut bw::Unit) -> SelectedUnit {
        unsafe {
            SelectedUnit {
                unit,
                generation: (*unit).minor_unique_index,
                player: (*unit).player,
                unit_id: (*unit).unit_id,
            }
        }
    }

    pub(crate) fn unit(&self) -> *mut bw::Unit {
        self.unit
    }

    /// Whether the unit's slot still holds this unit, with a sprite.
    pub(crate) unsafe fn is_current(&self) -> bool {
        unsafe {
            let now = SelectedUnit::of(self.unit);
            !(*self.unit).flingy.sprite.is_null()
                && now.generation == self.generation
                && now.player == self.player
        }
    }

    /// Whether the unit is still the kind it was when selected.
    unsafe fn is_same_kind(&self) -> bool {
        unsafe { (*self.unit).unit_id == self.unit_id }
    }
}

/// The sprite flag the game hides a unit's sprite with, as it does a unit inside a transport,
/// bunker or refinery.
const SPRITE_HIDDEN: u8 = 0x20;

/// Whether the game's selection UI puts `unit` in a selection of several units, as its own check
/// decides: not a building (beacons and flags among them), a powerup, a disabled unit, a spider
/// mine, an egg, a critter, or one of the few other kinds it singles out by id. Larvae, cocoons,
/// lurker eggs and hallucinations may all be selected with others.
pub(crate) unsafe fn can_be_group_selected(unit: *mut bw::Unit) -> bool {
    unsafe {
        let id = (*unit).unit_id;
        let type_flags = bw_dat::UnitId(id).flags();
        let excluded = (id < 0xe4 && type_flags & 0x1 != 0)
            || type_flags & 0x800 != 0
            || (*unit).flags & 0x400 != 0
            || (*unit).lockdown_timer != 0
            || (*unit).stasis_timer != 0
            || (*unit).maelstrom_timer != 0
            || (0xcb..=0xd5).contains(&id)
            || id == 0xd;
        let by_id = {
            let offset = id.wrapping_sub(0x24);
            (offset <= 0x3c && (0x1e60_0000_0000_0001u64 >> offset) & 1 != 0)
                || id == 0xca
                || id == 0x69
        };
        !excluded && !by_id
    }
}

/// How many images each of the building placement overlay pools holds: analysis only recognizes
/// a pool by the size it is cleared with at startup.
const PLACEMENT_POOL_LEN: usize = 0x40;

/// The static pools building placement takes its overlays from: the ghost and footprint it shows
/// over every unit the building being placed could go on (each geyser, for a refinery), with
/// their free lists. Like the selection circles, the pools are outside the rollback snapshot, but
/// their images get linked into the image lists of sprites inside it. Which units get them
/// depends on what the person watching is placing, and the simulation itself rebuilds them while a
/// placement is in progress (when a unit dies or is created).
pub(super) struct PlacementOverlayPools {
    images: Value<*mut bw::Image>,
    rects: Value<*mut bw::Image>,
    /// The first and last free entry of each pool.
    free_images: [Value<*mut bw::Image>; 2],
    free_rects: [Value<*mut bw::Image>; 2],
}

impl PlacementOverlayPools {
    pub(super) fn analyze(
        analysis: &mut scr_analysis::Analysis<'_>,
        ctx: scarf::OperandCtx<'static>,
    ) -> Option<PlacementOverlayPools> {
        let pools = (
            analysis.placement_images(),
            analysis.placement_rects(),
            analysis.first_free_placement_image(),
            analysis.last_free_placement_image(),
            analysis.first_free_placement_rect(),
            analysis.last_free_placement_rect(),
        );
        let (
            Some(images),
            Some(rects),
            Some(first_free_image),
            Some(last_free_image),
            Some(first_free_rect),
            Some(last_free_rect),
        ) = pools
        else {
            warn!("Analysis could not find the building placement overlay pools");
            return None;
        };
        let free = [
            first_free_image,
            last_free_image,
            first_free_rect,
            last_free_rect,
        ];
        if !free.iter().all(|&x| is_word_global(x)) {
            warn!("The building placement overlay free lists aren't plain globals: {free:?}");
            return None;
        }
        Some(PlacementOverlayPools {
            images: Value::new(ctx, images),
            rects: Value::new(ctx, rects),
            free_images: [
                Value::new(ctx, first_free_image),
                Value::new(ctx, last_free_image),
            ],
            free_rects: [
                Value::new(ctx, first_free_rect),
                Value::new(ctx, last_free_rect),
            ],
        })
    }

    /// Each pool's images with the first and last entries of its free list, placement images
    /// first.
    unsafe fn pools(&self) -> [(*mut bw::Image, *mut *mut bw::Image, *mut *mut bw::Image); 2] {
        unsafe {
            [
                (
                    self.images.resolve(),
                    self.free_images[0].resolve_as_ptr(),
                    self.free_images[1].resolve_as_ptr(),
                ),
                (
                    self.rects.resolve(),
                    self.free_rects[0].resolve_as_ptr(),
                    self.free_rects[1].resolve_as_ptr(),
                ),
            ]
        }
    }
}

/// Whether `op` is a pointer-sized global, which a free list head has to be for the list to be
/// relinked through a pointer to it.
fn is_word_global(op: scarf::Operand<'_>) -> bool {
    use scr_analysis::scarf::{MemAccessSize, OperandType};
    let word = match cfg!(target_pointer_width = "64") {
        true => MemAccessSize::Mem64,
        false => MemAccessSize::Mem32,
    };
    matches!(op.ty(), OperandType::Memory(mem) if mem.size == word)
}

/// How many images the static selection circle pool holds.
const SELECTION_CIRCLE_POOL_LEN: usize = 0x50;
/// How many images the static health bar pool holds, one per unit the local selection can hold.
const HP_BAR_POOL_LEN: usize = 0xc;
/// Sprite flag: the sprite is in the local selection and shows a health bar.
const SPRITE_SELECTED: u8 = 0x8;
/// Sprite flag: the sprite shows a selection circle from images `SELECTION_CIRCLE_IMAGES`.
const SPRITE_SELECTION_CIRCLE: u8 = 0x1;
/// Sprite flags: how many teammates have the sprite selected, as a two-bit count; a sprite with
/// any shows one circle from images `TEAM_SELECTION_CIRCLE_IMAGES`.
const SPRITE_TEAM_SELECTION_COUNT: u8 = 0x6;
const SELECTION_CIRCLE_IMAGES: std::ops::RangeInclusive<u16> = 0x231..=0x23a;
const TEAM_SELECTION_CIRCLE_IMAGES: std::ops::RangeInclusive<u16> = 0x23b..=0x244;
/// The draw function of a health bar image.
const HP_BAR_DRAWFUNC: u8 = 0xb;

/// The static pools selection circles and health bars come from, with their free lists, and the
/// sprite pool whose sprites they get linked onto.
///
/// The game's own way of taking them off before a saved game write visits every sprite in the
/// pool, a few thousand of them strewn over a few hundred KiB, to find the dozen or so that carry
/// one. Only a sprite one of these pool images is linked onto, or the sprite of a unit in the
/// local selection, can carry one: the game sets a sprite's circle flags only along with linking
/// a circle onto it and clears them whenever it takes one off, and sets the selected flag only for
/// the local selection's units. So the flagged ones among those are the sprites visited, in pool
/// order, each exactly as the game does it.
pub(super) struct SelectionVisualPools {
    circles: Value<*mut bw::Image>,
    free_circles: [Value<*mut bw::Image>; 2],
    hp_bars: Value<*mut bw::Image>,
    free_hp_bars: [Value<*mut bw::Image>; 2],
    /// The `vector<bw::Sprite>` the sprite pool lives in.
    sprites: Value<*mut scr::BwVector>,
}

impl SelectionVisualPools {
    pub(super) fn analyze(
        analysis: &mut scr_analysis::Analysis<'_>,
        ctx: scarf::OperandCtx<'static>,
    ) -> Option<SelectionVisualPools> {
        let found = (
            analysis.selection_circles(),
            analysis.first_free_selection_circle(),
            analysis.last_free_selection_circle(),
            analysis.hp_bar_images(),
            analysis.first_free_hp_bar(),
            analysis.last_free_hp_bar(),
            analysis.sprites(),
        );
        let (
            Some(circles),
            Some(first_free_circle),
            Some(last_free_circle),
            Some(hp_bars),
            Some(first_free_hp_bar),
            Some(last_free_hp_bar),
            Some(sprites),
        ) = found
        else {
            warn!("Analysis could not find the selection circle and health bar pools");
            return None;
        };
        let free = [
            first_free_circle,
            last_free_circle,
            first_free_hp_bar,
            last_free_hp_bar,
        ];
        if !free.iter().all(|&x| is_word_global(x)) {
            warn!("The selection circle and health bar free lists aren't plain globals: {free:?}");
            return None;
        }
        Some(SelectionVisualPools {
            circles: Value::new(ctx, circles),
            free_circles: [
                Value::new(ctx, first_free_circle),
                Value::new(ctx, last_free_circle),
            ],
            hp_bars: Value::new(ctx, hp_bars),
            free_hp_bars: [
                Value::new(ctx, first_free_hp_bar),
                Value::new(ctx, last_free_hp_bar),
            ],
            sprites: Value::new(ctx, sprites),
        })
    }

    /// Takes the selection circles and health bars off every sprite that carries one, leaving
    /// the sprites, images and free lists as the game's own pass over every sprite would.
    /// `selections` are the local selection's unit arrays, each ending at its first null entry.
    unsafe fn clear(&self, selections: &[&[*mut bw::Unit]]) {
        unsafe {
            let vector = self.sprites.resolve();
            let first_sprite = (*vector).data as usize;
            let sprite_count = (*vector).length;
            let sprite_size = mem::size_of::<bw::Sprite>();
            let visual_flags =
                SPRITE_SELECTED | SPRITE_SELECTION_CIRCLE | SPRITE_TEAM_SELECTION_COUNT;
            let mut sprites: SmallVec<[*mut bw::Sprite; 32]> = SmallVec::new();
            // Visiting a sprite without the flags does nothing, so only flagged ones are kept.
            // The free lists aren't walked to tell the pool images in use from the free ones,
            // whose parent is whatever sprite they were last on: those reads would each wait on
            // the last, and the parents can all be read at once instead.
            let mut add = |sprite: *mut bw::Sprite| {
                let offset = (sprite as usize).wrapping_sub(first_sprite);
                if offset < sprite_count * sprite_size
                    && offset.is_multiple_of(sprite_size)
                    && (*sprite).flags & visual_flags != 0
                {
                    sprites.push(sprite);
                }
            };
            let pools = [
                (self.circles.resolve(), SELECTION_CIRCLE_POOL_LEN),
                (self.hp_bars.resolve(), HP_BAR_POOL_LEN),
            ];
            for (pool, len) in pools {
                for i in 0..len {
                    add((*pool.add(i)).parent);
                }
            }
            for &selection in selections {
                for &unit in selection.iter().take_while(|x| !x.is_null()) {
                    add((*unit).flingy.sprite);
                }
            }
            sprites.sort_unstable();
            sprites.dedup();

            let free_circles = (
                self.free_circles[0].resolve_as_ptr(),
                self.free_circles[1].resolve_as_ptr(),
            );
            let free_hp_bars = (
                self.free_hp_bars[0].resolve_as_ptr(),
                self.free_hp_bars[1].resolve_as_ptr(),
            );

            let free = |image: *mut bw::Image, (first, last): (_, _)| {
                let lists = &raw mut (*(*image).parent).version_specific.scr;
                unlink_image(
                    image,
                    &raw mut (*lists).first_image,
                    &raw mut (*lists).last_image,
                );
                push_free_image(image, first, last);
            };
            let last_with_id = |sprite: *mut bw::Sprite, ids: std::ops::RangeInclusive<u16>| {
                let mut image = (*sprite).version_specific.scr.last_image;
                while !image.is_null() && !ids.contains(&(*image).image_id) {
                    image = (*image).prev;
                }
                image
            };
            for sprite in sprites {
                if (*sprite).flags & SPRITE_SELECTED != 0 {
                    (*sprite).flags &= !SPRITE_SELECTED;
                    let mut image = (*sprite).version_specific.scr.first_image;
                    while !image.is_null() && (*image).drawfunc != HP_BAR_DRAWFUNC {
                        image = (*image).next;
                    }
                    if !image.is_null() {
                        free(image, free_hp_bars);
                    }
                }
                if (*sprite).flags & SPRITE_SELECTION_CIRCLE != 0 {
                    (*sprite).flags &= !SPRITE_SELECTION_CIRCLE;
                    let image = last_with_id(sprite, SELECTION_CIRCLE_IMAGES);
                    if !image.is_null() {
                        free(image, free_circles);
                    }
                }
                if (*sprite).flags & SPRITE_TEAM_SELECTION_COUNT != 0 {
                    (*sprite).flags &= !SPRITE_TEAM_SELECTION_COUNT;
                    let image = last_with_id(sprite, TEAM_SELECTION_CIRCLE_IMAGES);
                    if !image.is_null() {
                        free(image, free_circles);
                    }
                }
            }
            #[cfg(debug_assertions)]
            self.check_cleared(first_sprite, sprite_count);
        }
    }

    /// Checks, every so often, that no sprite in the pool is left carrying a selection visual.
    #[cfg(debug_assertions)]
    unsafe fn check_cleared(&self, first_sprite: usize, sprite_count: usize) {
        static CALLS: AtomicU32 = AtomicU32::new(0);
        const CHECK_INTERVAL: u32 = 64;
        if !CALLS
            .fetch_add(1, Ordering::Relaxed)
            .is_multiple_of(CHECK_INTERVAL)
        {
            return;
        }
        let visual_flags = SPRITE_SELECTED | SPRITE_SELECTION_CIRCLE | SPRITE_TEAM_SELECTION_COUNT;
        unsafe {
            let sprites = first_sprite as *const bw::Sprite;
            for i in 0..sprite_count {
                let flags = (*sprites.add(i)).flags;
                debug_assert!(
                    flags & visual_flags == 0,
                    "Sprite {i} still carries selection visual flags {flags:x}",
                );
            }
        }
    }
}

/// Image flag: the image has to be drawn again.
const IMAGE_REDRAW: u16 = 0x1;

/// The power fields of the pylons, which the local player's pylons show while one of them is
/// selected or a building is being placed. Each is a sprite in the simulation's pool, made when
/// its pylon finishes and kept with the pylon, but which ones are shown is up to the UI.
pub(super) struct PylonAuras {
    /// The newest finished pylon, the head of a list linked through `rally_pylon.pylon`.
    first_pylon: Value<*mut bw::Unit>,
    /// Whether the local player's power fields are shown, which a pylon that finishes reads to
    /// decide whether to show its own.
    shown: Value<u32>,
}

impl PylonAuras {
    pub(super) fn analyze(
        analysis: &mut scr_analysis::Analysis<'_>,
        ctx: scarf::OperandCtx<'static>,
    ) -> Option<PylonAuras> {
        let (Some(first_pylon), Some(shown)) =
            (analysis.first_pylon(), analysis.pylon_auras_visible())
        else {
            warn!("Analysis could not find the pylon power fields");
            return None;
        };
        Some(PylonAuras {
            first_pylon: Value::new(ctx, first_pylon),
            shown: Value::new(ctx, shown),
        })
    }
}

/// Sets which players `sprite` is visible to as the game does, marking its images to be drawn
/// again when it turns visible to a player the local view sees with.
unsafe fn set_sprite_visibility_mask(sprite: *mut bw::Sprite, mask: u8, local_visions: u8) {
    unsafe {
        let old = (*sprite).visibility_mask & local_visions;
        let new = mask & local_visions;
        if old != new && new != 0 {
            let mut image = (*sprite).version_specific.scr.first_image;
            while !image.is_null() {
                (*image).flags |= IMAGE_REDRAW;
                image = (*image).next;
            }
        }
        (*sprite).visibility_mask = mask;
    }
}

/// Building placement overlays taken off their units to snapshot or restore, with what each held,
/// to put back once that is done (see
/// [`rollback_detach_placement_overlays`](BwScr::rollback_detach_placement_overlays)).
pub(crate) struct DetachedPlacementOverlays {
    /// Each image and its contents, placement images before their footprints.
    images: Vec<(*mut bw::Image, bw::Image)>,
}

/// Takes `image` out of the doubly linked list running from `*first` to `*last`.
unsafe fn unlink_image(
    image: *mut bw::Image,
    first: *mut *mut bw::Image,
    last: *mut *mut bw::Image,
) {
    unsafe {
        let (prev, next) = ((*image).prev, (*image).next);
        match prev.is_null() {
            true => *first = next,
            false => (*prev).next = next,
        }
        match next.is_null() {
            true => *last = prev,
            false => (*next).prev = prev,
        }
    }
}

/// Puts `image` in a free list right after its first entry, where the game returns pool images.
unsafe fn push_free_image(
    image: *mut bw::Image,
    first: *mut *mut bw::Image,
    last: *mut *mut bw::Image,
) {
    unsafe {
        let head = *first;
        if head.is_null() {
            (*image).prev = null_mut();
            (*image).next = null_mut();
            *first = image;
            *last = image;
            return;
        }
        if *last == head {
            *last = image;
        }
        (*image).prev = head;
        (*image).next = (*head).next;
        if !(*head).next.is_null() {
            (*(*head).next).prev = image;
        }
        (*head).next = image;
    }
}

/// The functions a right click calls for its feedback: placing the order confirmation marker, and
/// making the clicked target's selection circle blink.
pub(super) struct ClickFeedback {
    pub(super) show_cursor_marker_at: VirtualAddress,
    pub(super) set_selection_flash_timer: VirtualAddress,
}

/// The sprite `set_sprite_selection_flash_timer` writes the blink into: the one its object (a unit
/// or a fog sprite, which keep it at the same offset) points at, without any check that there is
/// one.
pub(super) unsafe fn flash_target_sprite(object: *mut c_void) -> *mut c_void {
    unsafe {
        *object
            .cast::<u8>()
            .add(FLASH_TARGET_SPRITE_OFFSET)
            .cast::<*mut c_void>()
    }
}

const FLASH_TARGET_SPRITE_OFFSET: usize = mem::offset_of!(bw::Unit, flingy.sprite);
const _: () = assert!(mem::offset_of!(bw::FowSprite, sprite) == FLASH_TARGET_SPRITE_OFFSET);

impl ClickFeedback {
    pub(super) fn analyze(analysis: &mut scr_analysis::Analysis<'_>) -> Option<ClickFeedback> {
        let show = analysis.show_cursor_marker_at();
        let flash = analysis.set_sprite_selection_flash_timer();
        let (Some(show_cursor_marker_at), Some(set_selection_flash_timer)) = (show, flash) else {
            warn!(
                "Analysis could not find the click feedback functions (marker: {}, flash: {})",
                show.is_some(),
                flash.is_some(),
            );
            return None;
        };
        Some(ClickFeedback {
            show_cursor_marker_at,
            set_selection_flash_timer,
        })
    }
}

impl SelectionVisuals {
    pub(super) fn analyze(analysis: &mut scr_analysis::Analysis<'_>) -> Option<SelectionVisuals> {
        let clear = analysis.clear_transient_sprite_state_for_save();
        let rebuild = analysis.rebuild_selection_visuals_after_save();
        let (Some(clear), Some(rebuild)) = (clear, rebuild) else {
            warn!(
                "Analysis could not find the selection visual functions (clear: {}, rebuild: {})",
                clear.is_some(),
                rebuild.is_some(),
            );
            return None;
        };
        unsafe {
            Some(SelectionVisuals {
                clear: mem::transmute::<usize, unsafe extern "C" fn()>(clear.0 as usize),
                rebuild: mem::transmute::<usize, unsafe extern "C" fn()>(rebuild.0 as usize),
            })
        }
    }
}

impl BwScr {
    /// Makes a write the UI made into the simulation's memory again, through the same function the
    /// UI called.
    pub(crate) unsafe fn rollback_replay_ui_write(
        &self,
        write: crate::rollback::ui_writes::UiWrite,
    ) {
        use crate::rollback::ui_writes::UiWrite;
        unsafe {
            let Some(feedback) = &self.click_feedback else {
                return;
            };
            match write {
                UiWrite::CursorMarker { x, y } => {
                    let show = mem::transmute::<usize, unsafe extern "C" fn(i32, i32)>(
                        feedback.show_cursor_marker_at.0 as usize,
                    );
                    show(x, y);
                }
                UiWrite::SelectionFlash {
                    object,
                    sprite,
                    timer,
                } => {
                    let object = object as *mut c_void;
                    if sprite != 0 && flash_target_sprite(object) as usize == sprite {
                        let flash = Thiscall::<unsafe extern "C" fn(*mut c_void, u32)>::foreign(
                            feedback.set_selection_flash_timer.0 as usize,
                        );
                        flash.call2(object, timer);
                    }
                }
            }
        }
    }

    /// Takes the selection circles and health bars off every sprite.
    pub(crate) unsafe fn rollback_clear_selection_visuals(&self) {
        unsafe { self.selection.clear_visuals() };
    }

    /// Puts the selection circles and health bars back on the units the person watching has
    /// selected.
    pub(crate) unsafe fn rollback_rebuild_selection_visuals(&self) {
        unsafe { self.selection.rebuild_visuals() };
    }

    /// Whether the local player's pylon power fields are shown.
    pub(crate) unsafe fn rollback_pylon_auras_shown(&self) -> bool {
        unsafe {
            self.pylon_auras
                .as_ref()
                .is_some_and(|auras| auras.shown.resolve() != 0)
        }
    }

    /// Shows the local player's pylon power fields and hides every other, or hides them all, as
    /// selecting a pylon or something else does. A pylon left without one by a full sprite pool
    /// stays without, where the game would try again to make one: that would take a sprite from
    /// the simulation's pool between steps.
    pub(crate) unsafe fn rollback_set_pylon_auras_shown(&self, shown: bool) {
        unsafe {
            let Some(auras) = &self.pylon_auras else {
                return;
            };
            let show_local = shown && self.is_replay.resolve() == 0;
            let local_player = self.local_player_id.resolve();
            let local_visions = self.local_visions.resolve();
            let mut pylon = auras.first_pylon.resolve();
            while !pylon.is_null() {
                let aura = (*pylon).unit_specific2.pylon.aura;
                if !aura.is_null() {
                    if show_local && u32::from((*pylon).player) == local_player {
                        (*aura).flags &= !SPRITE_HIDDEN;
                        set_sprite_visibility_mask(aura, local_visions, local_visions);
                    } else {
                        (*aura).flags |= SPRITE_HIDDEN;
                        set_sprite_visibility_mask(aura, 0, local_visions);
                    }
                }
                pylon = (*pylon).rally_pylon.pylon.next;
            }
            auras.shown.write(u32::from(shown));
        }
    }

    /// Takes every building placement overlay off the sprite it is shown on and back to its pool,
    /// as the game does when a placement ends, and returns what it took off. The pools are outside
    /// the snapshot, so this has to happen before taking one (which would otherwise hold sprites
    /// linked to pool images that the pool can hand out again before it is restored) and before
    /// restoring one (which would otherwise replace the image lists the images are linked into,
    /// leaving them taken from their pool for good).
    pub(crate) unsafe fn rollback_detach_placement_overlays(&self) -> DetachedPlacementOverlays {
        unsafe {
            let mut images = Vec::new();
            let Some(pools) = &self.placement_overlays else {
                return DetachedPlacementOverlays { images };
            };
            for (pool, first_free, last_free) in pools.pools() {
                for i in 0..PLACEMENT_POOL_LEN {
                    let image = pool.add(i);
                    let sprite = (*image).parent;
                    if sprite.is_null() {
                        continue;
                    }
                    images.push((image, std::ptr::read(image)));
                    let lists = &raw mut (*sprite).version_specific.scr;
                    unlink_image(
                        image,
                        &raw mut (*lists).first_image,
                        &raw mut (*lists).last_image,
                    );
                    push_free_image(image, first_free, last_free);
                    (*image).parent = null_mut();
                }
            }
            DetachedPlacementOverlays { images }
        }
    }

    /// Puts back the overlays [`rollback_detach_placement_overlays`] took off, in front of the
    /// images of the sprites they were on, where the game puts them. An overlay only goes back
    /// onto a sprite that still has images, which a sprite a restore freed doesn't.
    ///
    /// [`rollback_detach_placement_overlays`]: Self::rollback_detach_placement_overlays
    pub(crate) unsafe fn rollback_reattach_placement_overlays(
        &self,
        detached: DetachedPlacementOverlays,
    ) {
        unsafe {
            let Some(pools) = &self.placement_overlays else {
                return;
            };
            let pools = pools.pools();
            for (image, contents) in detached.images {
                let lists = &raw mut (*contents.parent).version_specific.scr;
                let first = (*lists).first_image;
                if first.is_null() {
                    continue;
                }
                let Some(&(_, first_free, last_free)) = pools
                    .iter()
                    .find(|&&(pool, ..)| image >= pool && image < pool.add(PLACEMENT_POOL_LEN))
                else {
                    continue;
                };
                unlink_image(image, first_free, last_free);
                std::ptr::write(image, contents);
                (*image).prev = null_mut();
                (*image).next = first;
                (*first).prev = image;
                (*lists).first_image = image;
            }
        }
    }

    /// The units the person watching has selected.
    pub(crate) unsafe fn rollback_local_selection(&self) -> [Option<SelectedUnit>; 12] {
        unsafe {
            let mut out = [None; 12];
            let Some(local_selection) = &self.selection.local_selection else {
                return out;
            };
            let selection = local_selection.resolve();
            for (i, item) in out.iter_mut().enumerate() {
                let unit = *selection.add(i);
                if unit.is_null() {
                    break;
                }
                *item = Some(SelectedUnit::of(unit));
            }
            out
        }
    }

    /// Takes out of the local selection, right after a restore and before anything reads the
    /// units it holds, each unit that isn't the one `before` (the selection before the restore)
    /// held in its slot any more. Rebuilding the selection visuals, the game's own deselecting
    /// when it next changes the selection, and the steps after the restore all read the units it
    /// holds; a slot that was free when the snapshot was taken holds whatever its last unit left
    /// there, such as a turret pointing at no tank. Changes only which units the selection holds:
    /// selecting the ones left (see [`rollback_settle_local_selection`] and
    /// [`crate::rollback::selection::undo_after`]) brings the rest of the selection UI in line.
    pub(crate) unsafe fn rollback_drop_stale_local_selection(
        &self,
        before: &[Option<SelectedUnit>; 12],
    ) {
        unsafe {
            let Some(local_selection) = &self.selection.local_selection else {
                return;
            };
            let selection = local_selection.resolve();
            let mut kept = 0;
            for i in 0..12 {
                let unit = *selection.add(i);
                if unit.is_null() {
                    break;
                }
                if before
                    .iter()
                    .flatten()
                    .find(|x| x.unit == unit)
                    .is_some_and(|x| x.is_current())
                {
                    *selection.add(kept) = unit;
                    kept += 1;
                }
            }
            for i in kept..12 {
                *selection.add(i) = null_mut();
            }
        }
    }

    /// Settles the local selection after a tick that restored and simulated again, against
    /// `before`, the selection as it was before the restore.
    ///
    /// The selection stays out of the snapshot, so a restore leaves it pointing at whatever the
    /// restored state has in each unit's slot: nothing, if the unit was created after the snapshot
    /// and the re-simulation didn't create it again, or a different unit. The game deselects a
    /// unit when it dies or changes owner, but a restore does neither, and the selection UI reads
    /// the sprite of a unit it holds without checking for one; so each unit that isn't the one
    /// `before` held in its slot any more goes. The restore already took those out of the units
    /// the selection holds ([`rollback_drop_stale_local_selection`]), and settling selects the
    /// units left whenever they aren't the ones `before` held, which brings the rest of the
    /// selection UI in line with them.
    ///
    /// The other way round, a unit the restore took out (`dropped`) can end the tick just as it
    /// was before the restore: one created after the snapshot that the re-simulation created
    /// again, such as a tank selected as it left its factory, or one that changed owner after the
    /// snapshot that the re-simulation put under that owner again. The person can't change the
    /// selection during a tick, so such a unit goes back where it was, as long as the game would
    /// have kept it selected: it isn't dying, hidden in a transport, out of sight or another kind
    /// of unit than it was, and can be selected together with the rest. Nothing the re-simulation
    /// took out itself goes back. The game takes a unit out of the selection for reasons the
    /// selection UI depends on: a drone that became a building leaves a selection of several
    /// units, and the UI can't draw a building among them.
    pub(crate) unsafe fn rollback_settle_local_selection(
        &self,
        before: &[Option<SelectedUnit>; 12],
        dropped: &[SelectedUnit],
    ) {
        unsafe {
            let Some(local_selection) = &self.selection.local_selection else {
                return;
            };
            let selection = local_selection.resolve();
            let mut kept = [null_mut(); 12];
            let mut kept_count = 0;
            let mut changed = false;
            for i in 0..kept.len() {
                let unit = *selection.add(i);
                if unit.is_null() {
                    break;
                }
                let same = match before.iter().flatten().find(|x| x.unit == unit) {
                    Some(old) => old.is_current(),
                    None => !(*unit).flingy.sprite.is_null(),
                };
                if same {
                    kept[kept_count] = unit;
                    kept_count += 1;
                } else {
                    changed = true;
                }
            }
            let mut kept = kept[..kept_count].to_vec();
            let local_visions = self.local_visions.resolve();
            let mut given_back = 0;
            for (index, old) in before.iter().flatten().enumerate() {
                if kept.len() < 12
                    && !kept.contains(&old.unit)
                    && dropped.iter().any(|x| x.unit == old.unit)
                    && old.is_current()
                    && old.is_same_kind()
                    && (*old.unit).order != bw_dat::order::DIE.0
                    && (*(*old.unit).flingy.sprite).flags & SPRITE_HIDDEN == 0
                    && (*(*old.unit).flingy.sprite).visibility_mask & local_visions != 0
                    && (kept.is_empty()
                        || std::iter::once(&old.unit)
                            .chain(&kept)
                            .all(|&x| can_be_group_selected(x)))
                {
                    kept.insert(index.min(kept.len()), old.unit);
                    given_back += 1;
                }
            }
            if given_back != 0 {
                debug!(
                    "Settling the local selection gave back {given_back} units the restore took out"
                );
            }
            if given_back != 0
                || changed
                || !kept
                    .iter()
                    .copied()
                    .eq(before.iter().flatten().map(|x| x.unit))
            {
                self.engine_select(&kept);
            }
        }
    }

    /// Makes `units` the local selection, without the selection response or a selection command,
    /// as the game itself deselects a unit that dies: the selection the simulation keeps for each
    /// player is in the snapshot and re-simulated along with it.
    pub(crate) unsafe fn rollback_select_local(&self, units: &[SelectedUnit]) {
        unsafe {
            let units = units.iter().map(|x| x.unit).collect::<Vec<_>>();
            self.engine_select(&units);
        }
    }

    pub(super) unsafe fn engine_select(&self, units: &[*mut bw::Unit]) {
        unsafe { self.selection.select(units) };
    }

    /// What the simulation has the person watching selecting, or nothing for an observer, who has
    /// no selection there.
    pub(crate) unsafe fn rollback_simulated_selection(&self) -> Vec<SelectedUnit> {
        unsafe {
            let Some(selections) = &self.selection.simulated_selections else {
                return Vec::new();
            };
            let player = self.local_unique_player_id.resolve() as usize;
            if player >= 8 {
                return Vec::new();
            }
            let row = selections.resolve().add(player * 12);
            (0..12)
                .map(|i| *row.add(i))
                .take_while(|unit| !unit.is_null())
                .map(|unit| SelectedUnit::of(unit))
                .collect()
        }
    }

    /// Makes some of `player`'s units the local selection, as a person selecting them would but
    /// without the selection response or a selection command, and only as the game's selection UI
    /// allows (its status panel can't draw anything else): one egg, which half the time is what
    /// it selects when there is one, or one unit of any other kind, or up to twelve units that can
    /// be selected together (see [`can_be_group_selected`]). `random` picks them. Returns how many
    /// units it selected and whether they are an egg.
    #[cfg(debug_assertions)]
    pub(crate) unsafe fn rollback_select_for_harness(
        &self,
        player: u8,
        mut random: impl FnMut() -> u32,
    ) -> (usize, bool) {
        unsafe {
            let (eggs, others): (Vec<_>, Vec<_>) = self
                .harness_selectable_units(player)
                .into_iter()
                .partition(|&unit| (*unit).unit_id == bw_dat::unit::EGG.0);
            let groupable = others
                .iter()
                .copied()
                .filter(|&unit| can_be_group_selected(unit))
                .collect::<Vec<_>>();
            let selection = if !eggs.is_empty() && (others.is_empty() || random().is_multiple_of(2))
            {
                vec![eggs[random() as usize % eggs.len()]]
            } else if !others.is_empty() {
                let count = 1 + random() as usize % 12;
                if count == 1 || groupable.len() < 2 {
                    vec![others[random() as usize % others.len()]]
                } else {
                    let mut selection = Vec::new();
                    for _ in 0..count {
                        let unit = groupable[random() as usize % groupable.len()];
                        if !selection.contains(&unit) {
                            selection.push(unit);
                        }
                    }
                    selection
                }
            } else {
                return (0, false);
            };
            self.engine_select(&selection);
            let egg = (*selection[0]).unit_id == bw_dat::unit::EGG.0;
            (selection.len(), egg)
        }
    }

    /// Selects one of `player`'s units that has appeared since the last call, as a person
    /// selecting a unit the moment it leaves its factory would, half the time that there is one:
    /// on its own, or added to the local selection when they can be selected together. `seen`
    /// holds the units the last call saw, and `random` picks. Returns how many units it selected,
    /// if it selected any.
    #[cfg(debug_assertions)]
    pub(crate) unsafe fn rollback_select_new_for_harness(
        &self,
        player: u8,
        seen: &mut Vec<SelectedUnit>,
        mut random: impl FnMut() -> u32,
    ) -> Option<usize> {
        unsafe {
            let now = self
                .harness_selectable_units(player)
                .into_iter()
                .map(|unit| SelectedUnit::of(unit))
                .collect::<Vec<_>>();
            let new = now
                .iter()
                .filter(|x| {
                    !seen
                        .iter()
                        .any(|old| old.unit == x.unit && old.generation == x.generation)
                })
                .map(|x| x.unit)
                .collect::<Vec<_>>();
            let first_call = seen.is_empty();
            *seen = now;
            if first_call || new.is_empty() || random().is_multiple_of(2) {
                return None;
            }
            let unit = new[random() as usize % new.len()];
            let mut selection = self
                .rollback_local_selection()
                .into_iter()
                .flatten()
                .map(|x| x.unit)
                .collect::<Vec<_>>();
            let add = selection.len() < 12
                && random().is_multiple_of(2)
                && std::iter::once(&unit)
                    .chain(&selection)
                    .all(|&x| can_be_group_selected(x));
            if !add {
                selection.clear();
            }
            selection.push(unit);
            self.engine_select(&selection);
            Some(selection.len())
        }
    }

    /// The units of `player` the harness selects from: alive, not inside anything, and not the
    /// turret of another unit.
    #[cfg(debug_assertions)]
    pub(super) unsafe fn harness_selectable_units(&self, player: u8) -> Vec<*mut bw::Unit> {
        unsafe {
            let units = self.units.resolve();
            let unit_ptr = (*units).data as *mut bw::Unit;
            (0..(*units).length)
                .map(|i| unit_ptr.add(i))
                .filter(|&unit| {
                    let sprite = (*unit).flingy.sprite;
                    !sprite.is_null()
                        && (*unit).player == player
                        && (*unit).order != bw_dat::order::DIE.0
                        && (*sprite).flags & SPRITE_HIDDEN == 0
                        && !bw_dat::UnitId((*unit).unit_id).is_subunit()
                })
                .collect()
        }
    }
}
