//! Emits the Rust ABI anchors consumed by `verify-wire.py`.
//!
//! This is intentionally a standalone `rustc` fixture rather than a Cargo target: it imports
//! the production declarations directly and can be compiled for x86 and x64 independently.

#[path = "../../game/src/bwapi/wire.rs"]
mod wire;

use std::mem::{offset_of, size_of};
use wire::*;

macro_rules! record {
    ($type:ty) => {
        print!("\"{}\":{},", stringify!($type), size_of::<$type>())
    };
}

macro_rules! field {
    ($type:ty, $field:ident) => {
        print!(
            "\"{}.{}\":{},",
            stringify!($type),
            stringify!($field),
            offset_of!($type, $field),
        )
    };
}

fn main() {
    print!("{{");
    record!(GameInstance);
    record!(GameTable);
    record!(ForceData);
    record!(PlayerData);
    record!(UnitData);
    record!(BulletData);
    record!(RegionData);
    record!(Event);
    record!(Shape);
    record!(Command);
    record!(UnitCommand);
    record!(UnitFinder);
    record!(GameData);
    field!(GameData, client_version);
    field!(GameData, players);
    field!(GameData, units);
    field!(GameData, is_walkable);
    field!(GameData, events);
    field!(GameData, strings);
    field!(GameData, commands);
    field!(GameData, unit_commands);
    println!("\"end\":0}}");
}
