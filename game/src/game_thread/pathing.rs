use crate::bw;

pub fn is_outside_map_coords(game: bw_dat::Game, pos: &bw::Point) -> bool {
    pos.x < 0
        || pos.y < 0
        || (pos.x as u16) >= game.map_width_pixels()
        || (pos.y as u16) >= game.map_height_pixels()
}

fn region_from_id(pathing: *mut bw::Pathing, region: u16) -> *mut bw::Region {
    unsafe { &raw mut (*pathing).regions[region as usize] }
}

pub fn is_at_unwalkable_region(pathing: *mut bw::Pathing, pos: &bw::Point) -> bool {
    unsafe {
        let region_id = match region_from_point(pathing, pos) {
            Some(s) => s,
            None => return false,
        };
        let region = region_from_id(pathing, region_id);
        (*region).walkability == 0x1ffd
    }
}

fn region_from_point(pathing: *mut bw::Pathing, pos: &bw::Point) -> Option<u16> {
    const FIRST_SPLIT_REGION: u16 = 0x2000;
    let region_id = tile_region_or_split(pathing, pos.x as u32 / 32, pos.y as u32 / 32)?;
    if region_id < FIRST_SPLIT_REGION {
        Some(region_id)
    } else {
        let index = (region_id - FIRST_SPLIT_REGION) as usize;
        let split = unsafe { (*pathing).split_regions[index] };
        let region_true = split.region_true;
        let region_false = split.region_false;
        let subtile_idx = (pos.x & 31) / 8 + ((pos.y & 31) / 8) * 4;
        if split.minitile_flags & (1 << subtile_idx) != 0 {
            Some(region_true)
        } else {
            Some(region_false)
        }
    }
}

fn tile_region_or_split(pathing: *mut bw::Pathing, x_tile: u32, y_tile: u32) -> Option<u16> {
    unsafe {
        let tile_pos = (x_tile.checked_add(y_tile.checked_mul(256)?)?) as usize;
        (*pathing).map_tile_regions.get(tile_pos).copied()
    }
}
