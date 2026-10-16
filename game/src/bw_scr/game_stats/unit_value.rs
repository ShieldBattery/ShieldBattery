//! What a unit is worth: the units.dat facts the stats read, and what a player spent to have one.

use bw_dat::{UnitId, unit};

/// The units.dat facts the stats are worked out from, behind a trait so they can be worked out from
/// a table made up for a test rather than from the game's own.
pub trait UnitCatalog {
    /// units.dat's flags word for `id`.
    fn flags(&self, id: UnitId) -> u32;
    /// What units.dat says one order of `id` costs, which for a kind that hatches in pairs is the
    /// price of the pair.
    fn mineral_cost(&self, id: UnitId) -> u32;
    fn gas_cost(&self, id: UnitId) -> u32;

    fn is_building(&self, id: UnitId) -> bool {
        self.flags(id) & 0x1 != 0
    }

    fn is_worker(&self, id: UnitId) -> bool {
        self.flags(id) & 0x8 != 0
    }

    fn is_subunit(&self, id: UnitId) -> bool {
        self.flags(id) & 0x10 != 0
    }

    /// Whether one egg of this kind hatches two units, so units.dat's cost is for both of them.
    fn hatches_in_pairs(&self, id: UnitId) -> bool {
        self.flags(id) & 0x400 != 0
    }

    fn is_powerup(&self, id: UnitId) -> bool {
        self.flags(id) & 0x800 != 0
    }

    fn is_town_hall(&self, id: UnitId) -> bool {
        self.flags(id) & 0x1000 != 0
    }
}

/// The game's own units.dat.
pub struct DatUnits;

impl UnitCatalog for DatUnits {
    fn flags(&self, id: UnitId) -> u32 {
        id.flags()
    }

    fn mineral_cost(&self, id: UnitId) -> u32 {
        id.mineral_cost()
    }

    fn gas_cost(&self, id: UnitId) -> u32 {
        id.gas_cost()
    }
}

/// Minerals and gas, counted in halves so that one of a pair is exact.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct HalfCost {
    pub minerals: u32,
    pub gas: u32,
}

impl HalfCost {
    pub fn add(self, other: HalfCost) -> HalfCost {
        HalfCost {
            minerals: self.minerals.saturating_add(other.minerals),
            gas: self.gas.saturating_add(other.gas),
        }
    }

    pub fn times(self, count: u32) -> HalfCost {
        HalfCost {
            minerals: self.minerals.saturating_mul(count),
            gas: self.gas.saturating_mul(count),
        }
    }

    /// Both resources together, still in halves.
    pub fn total(self) -> u32 {
        self.minerals.saturating_add(self.gas)
    }

    /// Whole minerals and gas, rounded down.
    pub fn whole(self) -> (u32, u32) {
        (self.minerals / 2, self.gas / 2)
    }
}

/// The units a kind is made out of, which units.dat cannot say: it prices a morph or a merge as the
/// step alone, so a lurker costs what turning a hydralisk into one costs and an archon costs
/// nothing.
fn consumed_units(id: UnitId) -> &'static [(UnitId, u32)] {
    match id {
        unit::LURKER => &[(unit::HYDRALISK, 1)],
        unit::GUARDIAN | unit::DEVOURER => &[(unit::MUTALISK, 1)],
        unit::ARCHON => &[(unit::HIGH_TEMPLAR, 2)],
        unit::DARK_ARCHON => &[(unit::DARK_TEMPLAR, 2)],
        _ => &[],
    }
}

/// What a player spent to have one unit of `id`, in halves: its own price, halved for a kind that
/// hatches in pairs, plus everything spent on the units it was made out of.
///
/// A lurker egg and a cocoon are valued as the hydralisk and the mutalisk inside them. Valued as
/// eggs, an army would drop by every unit that starts a morph and jump back when it finishes; the
/// price of the morph itself is only counted once the morph is.
pub fn invested_cost(catalog: &impl UnitCatalog, id: UnitId) -> HalfCost {
    match id {
        unit::LURKER_EGG => return invested_cost(catalog, unit::HYDRALISK),
        unit::COCOON => return invested_cost(catalog, unit::MUTALISK),
        _ => {}
    }
    let share = match catalog.hatches_in_pairs(id) {
        true => 1,
        false => 2,
    };
    let own = HalfCost {
        minerals: catalog.mineral_cost(id).saturating_mul(share),
        gas: catalog.gas_cost(id).saturating_mul(share),
    };
    consumed_units(id)
        .iter()
        .fold(own, |total, &(source, count)| {
            total.add(invested_cost(catalog, source).times(count))
        })
}

/// Whether a unit is part of what a player would fight with.
///
/// Buildings are what an army is made in rather than part of it, workers have a panel of their own,
/// subunits are the turret half of a unit already counted, and larvae, eggs and scarabs do not
/// survive being counted: an egg is a unit on the way, which the production panel is already
/// showing. Lurker eggs and cocoons are the exception, as units already in the army changing shape
/// (see [`invested_cost`]). Overlords are a zerg's supply, as depots and pylons are the other
/// races', whatever else they can be put to.
pub fn counts_as_army(catalog: &impl UnitCatalog, id: UnitId) -> bool {
    if catalog.is_building(id)
        || catalog.is_worker(id)
        || catalog.is_subunit(id)
        || catalog.is_powerup(id)
    {
        return false;
    }
    !matches!(id, unit::LARVA | unit::EGG | unit::SCARAB | unit::OVERLORD)
}

#[cfg(test)]
pub mod tests {
    use std::collections::HashMap;

    use super::*;

    /// A units.dat made of only the entries a test names: `(flags, minerals, gas)` per kind, and
    /// nothing for everything else.
    #[derive(Default)]
    pub struct FakeUnits(pub HashMap<UnitId, (u32, u32, u32)>);

    impl FakeUnits {
        /// The game's own prices for the kinds the tests here use.
        pub fn standard() -> FakeUnits {
            let pair = 0x400;
            let building = 0x1;
            let worker = 0x8;
            let town_hall = 0x1000 | building;
            FakeUnits(HashMap::from([
                (unit::MARINE, (0, 50, 0)),
                (unit::SCV, (worker, 50, 0)),
                (unit::DRONE, (worker, 50, 0)),
                (unit::ZERGLING, (pair, 50, 0)),
                (unit::SCOURGE, (pair, 25, 75)),
                (unit::HYDRALISK, (0, 75, 25)),
                (unit::LURKER, (0, 50, 100)),
                (unit::MUTALISK, (0, 100, 100)),
                (unit::GUARDIAN, (0, 50, 100)),
                (unit::DEVOURER, (0, 150, 50)),
                (unit::HIGH_TEMPLAR, (0, 50, 150)),
                (unit::DARK_TEMPLAR, (0, 125, 100)),
                (unit::ARCHON, (0, 0, 0)),
                (unit::DARK_ARCHON, (0, 0, 0)),
                (unit::COMMAND_CENTER, (town_hall, 400, 0)),
                (unit::HATCHERY, (town_hall, 300, 0)),
                (unit::LAIR, (town_hall, 150, 100)),
                (unit::HIVE, (town_hall, 200, 150)),
                (unit::BARRACKS, (building, 150, 0)),
                (unit::SPIRE, (building, 200, 150)),
                (unit::GREATER_SPIRE, (building, 100, 150)),
            ]))
        }
    }

    impl UnitCatalog for FakeUnits {
        fn flags(&self, id: UnitId) -> u32 {
            self.0.get(&id).map_or(0, |entry| entry.0)
        }

        fn mineral_cost(&self, id: UnitId) -> u32 {
            self.0.get(&id).map_or(0, |entry| entry.1)
        }

        fn gas_cost(&self, id: UnitId) -> u32 {
            self.0.get(&id).map_or(0, |entry| entry.2)
        }
    }

    fn whole(id: UnitId) -> (u32, u32) {
        invested_cost(&FakeUnits::standard(), id).whole()
    }

    #[test]
    fn a_kind_that_hatches_in_pairs_costs_half_its_price_each() {
        let units = FakeUnits::standard();
        assert_eq!(
            invested_cost(&units, unit::ZERGLING).times(2).whole(),
            (50, 0)
        );
        assert_eq!(
            invested_cost(&units, unit::SCOURGE),
            HalfCost {
                minerals: 25,
                gas: 75,
            }
        );
        let mut flagged = FakeUnits::standard();
        flagged.0.insert(unit::MARINE, (0x400, 50, 0));
        assert_eq!(invested_cost(&flagged, unit::MARINE).whole(), (25, 0));
    }

    #[test]
    fn a_morph_costs_what_it_was_made_from_too() {
        assert_eq!(whole(unit::LURKER), (125, 125));
        assert_eq!(whole(unit::GUARDIAN), (150, 200));
        assert_eq!(whole(unit::DEVOURER), (250, 150));
        assert_eq!(whole(unit::ARCHON), (100, 300));
        assert_eq!(whole(unit::DARK_ARCHON), (250, 200));
    }

    #[test]
    fn a_unit_made_once_costs_its_price() {
        assert_eq!(whole(unit::MARINE), (50, 0));
    }

    #[test]
    fn a_morph_in_progress_is_worth_what_went_into_it() {
        assert_eq!(whole(unit::LURKER_EGG), whole(unit::HYDRALISK));
        assert_eq!(whole(unit::COCOON), whole(unit::MUTALISK));
        let units = FakeUnits::standard();
        assert!(counts_as_army(&units, unit::LURKER_EGG));
        assert!(counts_as_army(&units, unit::COCOON));
        assert!(!counts_as_army(&units, unit::EGG));
    }
}
