//! Skin selectors and sprite-to-unit associations stored outside the unit and sprite pools.
//! Pool slots are reused without generations in these keys, so seeks must restore all three maps.

use fxhash::FxHashSet;
use scr_analysis::{Analysis, scarf};

use super::skin_map::{self, PreparedMap, SkinMap, SpriteSkin};
use super::sprite_unit_map::{self, PreparedSpriteUnits, SpriteUnitMap};
use super::{BwScr, Value, scr};
use crate::bw::Bw;
use crate::bw::unit::Unit;
use crate::remembered_buildings::RememberedLook;

pub(super) struct ReplaySkins {
    units: Value<*mut SkinMap<u8>>,
    sprites: Value<*mut SkinMap<SpriteSkin>>,
    sprite_units: Value<*mut SpriteUnitMap>,
    sprite_pool: Value<*mut scr::BwVector>,
}

impl ReplaySkins {
    pub(super) fn new(
        analysis: &mut Analysis<'_>,
        ctx: &'static scarf::OperandContext<'static>,
    ) -> Option<Self> {
        Some(Self {
            units: Value::new(ctx, analysis.unit_skin_map()?),
            sprites: Value::new(ctx, analysis.sprite_skin_map()?),
            sprite_units: Value::new(ctx, analysis.sprite_unit_map()?),
            sprite_pool: Value::new(ctx, analysis.sprites()?),
        })
    }

    unsafe fn sprite_id(&self, sprite: *const scr::Sprite) -> u32 {
        unsafe {
            let pool = self.sprite_pool.resolve();
            let start = (*pool).data as usize;
            let offset = (sprite as usize)
                .checked_sub(start)
                .expect("sprite is in its pool");
            let index = offset / size_of::<scr::Sprite>();
            assert!(offset.is_multiple_of(size_of::<scr::Sprite>()) && index < (*pool).length);
            u32::try_from(index + 1).expect("sprite pool IDs fit in u32")
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct ReplaySkinSnapshot {
    units: Vec<(u32, u8)>,
    sprites: Vec<(u32, SpriteSkin)>,
    sprite_units: Vec<(u32, u32)>,
}

impl ReplaySkinSnapshot {
    pub(crate) fn heap_bytes(&self) -> usize {
        self.units.capacity() * size_of::<(u32, u8)>()
            + self.sprites.capacity() * size_of::<(u32, SpriteSkin)>()
            + self.sprite_units.capacity() * size_of::<(u32, u32)>()
    }

    /// All allocations are staged before any map changes. On failure, dropping the preparations
    /// releases only their new storage and leaves the engine's maps untouched.
    unsafe fn prepare<'a>(
        &'a self,
        units: *mut SkinMap<u8>,
        sprites: *mut SkinMap<SpriteSkin>,
        sprite_units: *mut SpriteUnitMap,
        allocator: *mut scr::Allocator,
    ) -> Option<PreparedReplaySkins<'a>> {
        unsafe {
            Some(PreparedReplaySkins {
                units: skin_map::prepare(units, self.units.len(), allocator)?,
                sprites: skin_map::prepare(sprites, self.sprites.len(), allocator)?,
                sprite_units: sprite_unit_map::prepare(
                    sprite_units,
                    self.sprite_units.len(),
                    allocator,
                )?,
                snapshot: self,
            })
        }
    }
}

pub(crate) struct PreparedReplaySkins<'a> {
    units: PreparedMap<u8>,
    sprites: PreparedMap<SpriteSkin>,
    sprite_units: PreparedSpriteUnits,
    snapshot: &'a ReplaySkinSnapshot,
}

impl PreparedReplaySkins<'_> {
    /// No engine operation on these maps may run between preparing and committing the restore.
    pub(crate) unsafe fn commit(self) {
        unsafe {
            self.units.commit(&self.snapshot.units);
            self.sprites.commit(&self.snapshot.sprites);
            self.sprite_units.commit(&self.snapshot.sprite_units);
        }
    }
}

impl BwScr {
    pub(crate) fn has_replay_skins(&self) -> bool {
        self.replay_skins.is_some()
    }

    /// Fog sprites have no live unit, even when their pool slot previously held a unit's sprite.
    pub(super) unsafe fn clear_fow_sprite_unit(&self, sprite: *const scr::Sprite) {
        unsafe {
            if let Some(skins) = &self.replay_skins {
                sprite_unit_map::remove(
                    skins.sprite_units.resolve(),
                    skins.sprite_id(sprite),
                    self.allocator.resolve(),
                );
            }
        }
    }

    /// Creates one fog sprite, reserving any needed skin node before changing the sprite pools.
    pub(super) unsafe fn create_fow_sprite_with_skin(
        &self,
        look: &RememberedLook,
    ) -> Option<*mut scr::Sprite> {
        unsafe {
            let Some(skins) = &self.replay_skins else {
                return self.create_fow_sprite_from(look);
            };
            let next = *self.free_sprites.resolve().start;
            if next.is_null() {
                return None;
            }
            let map = skins.sprites.resolve();
            let id = skins.sprite_id(next);
            // Most neutral sprites have no skin; avoid copying or rebuilding an unchanged map.
            if look.skin.is_none() && skin_map::get(map, id).is_none() {
                return self.create_fow_sprite_from(look);
            }
            let mut entries = skin_map::entries(map);
            reconcile_sprite_skins(&mut entries, &[(id, look.skin)]);
            let prepared = skin_map::prepare(map, entries.len(), self.allocator.resolve())?;
            let sprite = self.create_fow_sprite_from(look)?;
            prepared.commit(&entries);
            Some(sprite)
        }
    }

    pub(super) unsafe fn remembered_unit_skin(&self, unit: Unit) -> Option<SpriteSkin> {
        unsafe {
            let skins = self.replay_skins.as_ref()?;
            let id = self.unit_array()?.to_index(unit) + 1;
            skin_map::get(skins.units.resolve(), id)
                .map(|player| SpriteSkin::new((**unit).unit_id, player))
        }
    }

    #[cfg(debug_assertions)]
    pub(crate) unsafe fn remembered_sprite_skin(
        &self,
        sprite: *const scr::Sprite,
    ) -> Option<SpriteSkin> {
        unsafe {
            let skins = self.replay_skins.as_ref()?;
            skin_map::get(skins.sprites.resolve(), skins.sprite_id(sprite))
        }
    }

    pub(crate) unsafe fn replay_skin_snapshot(&self) -> Option<ReplaySkinSnapshot> {
        unsafe {
            let skins = self.replay_skins.as_ref()?;
            Some(ReplaySkinSnapshot {
                units: skin_map::entries(skins.units.resolve()),
                sprites: skin_map::entries(skins.sprites.resolve()),
                sprite_units: sprite_unit_map::entries(skins.sprite_units.resolve()),
            })
        }
    }

    pub(crate) unsafe fn prepare_replay_skin_restore<'a>(
        &self,
        snapshot: &'a ReplaySkinSnapshot,
    ) -> Option<PreparedReplaySkins<'a>> {
        unsafe {
            let skins = self.replay_skins.as_ref()?;
            snapshot.prepare(
                skins.units.resolve(),
                skins.sprites.resolve(),
                skins.sprite_units.resolve(),
                self.allocator.resolve(),
            )
        }
    }

    /// Replaces player fog sprites and their pool-slot skin mappings as one game-thread operation.
    /// Reserve map nodes before changing the pools, then commit only the sprites actually created.
    pub(crate) unsafe fn rebuild_player_fow_sprites<'a>(
        &self,
        looks: impl Iterator<Item = &'a RememberedLook> + Clone,
    ) -> bool {
        unsafe {
            let Some(skins) = &self.replay_skins else {
                return false;
            };
            let map = skins.sprites.resolve();
            let mut entries = skin_map::entries(map);
            let removed: FxHashSet<u32> = self
                .fow_sprites()
                .filter_map(|fow| {
                    let sprite = (*fow).sprite as *mut scr::Sprite;
                    ((*sprite).player < 8 && self.sprite_list_of(sprite).is_some())
                        .then(|| skins.sprite_id(sprite))
                })
                .collect();
            entries.retain(|(id, _)| !removed.contains(id));
            let capacity = entries.len() + looks.clone().filter(|x| x.skin.is_some()).count();
            let Some(prepared) = skin_map::prepare(map, capacity, self.allocator.resolve()) else {
                warn!("Couldn't allocate skin mappings for remembered buildings");
                return false;
            };
            let mut created = Vec::new();
            self.remove_player_fow_sprites();
            for look in looks {
                let Some(sprite) = self.create_fow_sprite_from(look) else {
                    warn!("Ran out of fog sprites rebuilding the remembered buildings");
                    break;
                };
                created.push((skins.sprite_id(sprite), look.skin));
            }
            reconcile_sprite_skins(&mut entries, &created);
            prepared.commit(&entries);
            true
        }
    }
}

/// Even an unskinned replacement must erase any mapping for the slot it occupies.
fn reconcile_sprite_skins(
    entries: &mut Vec<(u32, SpriteSkin)>,
    created: &[(u32, Option<SpriteSkin>)],
) {
    let replaced: FxHashSet<u32> = created.iter().map(|x| x.0).collect();
    entries.retain(|(id, _)| !replaced.contains(id));
    entries.extend(
        created
            .iter()
            .filter_map(|&(id, skin)| skin.map(|skin| (id, skin))),
    );
    entries.sort_unstable_by_key(|x| x.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reused_slots_get_the_captured_skin_or_no_skin() {
        let old = SpriteSkin::new(106, 0);
        let remembered = SpriteSkin::new(154, 1);
        let neutral = SpriteSkin::new(188, 11);
        let mut entries = vec![(1, old), (2, old), (3, neutral)];
        reconcile_sprite_skins(&mut entries, &[(1, Some(remembered)), (2, None)]);
        assert_eq!(entries, [(1, remembered), (3, neutral)]);
    }

    #[test]
    fn restoring_a_keyframe_replaces_both_timelines_and_preserves_neutral_skins() {
        let (_vtable, mut mock) = skin_map::tests::allocator();
        let allocator = &mut mock.base as *mut scr::Allocator;
        let mut units = skin_map::tests::empty::<u8>();
        let mut sprites = skin_map::tests::empty::<SpriteSkin>();
        let mut sprite_units = sprite_unit_map::tests::empty();
        unsafe {
            skin_map::prepare(&mut *units, 2, allocator)
                .unwrap()
                .commit(&[(1, 0), (3, 11)]);
            let original = [(2, SpriteSkin::new(106, 0)), (4, SpriteSkin::new(188, 11))];
            skin_map::prepare(&mut *sprites, 2, allocator)
                .unwrap()
                .commit(&original);
            sprite_unit_map::prepare(&mut *sprite_units, 2, allocator)
                .unwrap()
                .commit(&[(1, 1), (3, 3)]);
            let snapshot = ReplaySkinSnapshot {
                units: skin_map::entries(&*units),
                sprites: skin_map::entries(&*sprites),
                sprite_units: sprite_unit_map::entries(&*sprite_units),
            };
            // Reusing IDs, deleting a neutral entry and adding later units must all be undone.
            skin_map::prepare(&mut *units, 2, allocator)
                .unwrap()
                .commit(&[(1, 1), (9, 2)]);
            skin_map::prepare(&mut *sprites, 2, allocator)
                .unwrap()
                .commit(&[(2, SpriteSkin::new(154, 1)), (10, SpriteSkin::new(131, 2))]);
            // A later unit can occupy a slot that held a fog sprite in the saved frame.
            sprite_unit_map::prepare(&mut *sprite_units, 2, allocator)
                .unwrap()
                .commit(&[(2, 9), (10, 1)]);
            snapshot
                .prepare(&mut *units, &mut *sprites, &mut *sprite_units, allocator)
                .unwrap()
                .commit();
            assert_eq!(skin_map::entries(&*units), [(1, 0), (3, 11)]);
            assert_eq!(skin_map::entries(&*sprites), original);
            assert_eq!(sprite_unit_map::entries(&*sprite_units), [(1, 1), (3, 3)]);
            assert!(snapshot.heap_bytes() >= 4 * size_of::<(u32, u32)>());
            // The saved values can be restored repeatedly after the engine frees all nodes.
            skin_map::prepare(&mut *units, 0, allocator)
                .unwrap()
                .commit(&[]);
            skin_map::prepare(&mut *sprites, 0, allocator)
                .unwrap()
                .commit(&[]);
            sprite_unit_map::prepare(&mut *sprite_units, 0, allocator)
                .unwrap()
                .commit(&[]);
            snapshot
                .prepare(&mut *units, &mut *sprites, &mut *sprite_units, allocator)
                .unwrap()
                .commit();
            assert_eq!(skin_map::entries(&*sprites), original);
            assert_eq!(sprite_unit_map::entries(&*sprite_units), [(1, 1), (3, 3)]);
            skin_map::prepare(&mut *units, 0, allocator)
                .unwrap()
                .commit(&[]);
            skin_map::prepare(&mut *sprites, 0, allocator)
                .unwrap()
                .commit(&[]);
            sprite_unit_map::prepare(&mut *sprite_units, 0, allocator)
                .unwrap()
                .commit(&[]);
            sprite_unit_map::tests::free_buckets(&mut sprite_units, allocator);
        }
        assert_eq!(mock.live, 0);
    }

    #[test]
    fn failed_keyframe_skin_preparation_does_not_partially_restore() {
        let (_vtable, mut mock) = skin_map::tests::allocator();
        let allocator = &mut mock.base as *mut scr::Allocator;
        let mut units = skin_map::tests::empty::<u8>();
        let mut sprites = skin_map::tests::empty::<SpriteSkin>();
        let mut sprite_units = sprite_unit_map::tests::empty();
        let snapshot = ReplaySkinSnapshot {
            units: vec![(1, 0), (2, 1)],
            sprites: vec![(3, SpriteSkin::new(106, 0)), (4, SpriteSkin::new(154, 1))],
            sprite_units: vec![(1, 1), (2, 2)],
        };
        unsafe {
            skin_map::prepare(&mut *units, 1, allocator)
                .unwrap()
                .commit(&[(1, 7)]);
            skin_map::prepare(&mut *sprites, 0, allocator)
                .unwrap()
                .commit(&[]);
            // Fail during either skin map, bucket allocation, or either association node.
            for remaining in 0..6 {
                mock.remaining = remaining;
                assert!(
                    snapshot
                        .prepare(&mut *units, &mut *sprites, &mut *sprite_units, allocator)
                        .is_none()
                );
                assert_eq!(mock.live, 1);
                assert_eq!(skin_map::entries(&*units), [(1, 7)]);
                assert!(skin_map::entries(&*sprites).is_empty());
                assert!(sprite_unit_map::entries(&*sprite_units).is_empty());
            }
            skin_map::prepare(&mut *units, 0, allocator)
                .unwrap()
                .commit(&[]);
        }
        assert_eq!(mock.live, 0);
    }
}
