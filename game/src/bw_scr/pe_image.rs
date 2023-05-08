//! Helpers for creating scarf::BinaryFile from a image loaded in memory

use scr_analysis::scarf::{BinarySection};
use scr_analysis::VirtualAddress;

pub unsafe fn get_pe_header(base: *const u8) -> BinarySection<VirtualAddress> {
    let header_block_size = 0x400;
    let header = std::slice::from_raw_parts(base, header_block_size as usize);
    BinarySection {
        name: {
            let mut name = [0; 8];
            for (&c, out) in b"(header)".iter().zip(name.iter_mut()) {
                *out = c;
            }
            name
        },
        virtual_address: VirtualAddress(base as _),
        virtual_size: header_block_size,
        data: header.into(),
    }
}

pub unsafe fn sections_ptr(base: *const u8) -> (*const u8, usize) {
    let pe_header_offset = read_u32(base, 0x3c);
    let pe_header = base.offset(pe_header_offset as isize);
    let section_count = read_u16(pe_header, 6) as usize;
    let opt_header_size = read_u16(pe_header, 0x14) as usize;
    (pe_header.add(0x18 + opt_header_size), section_count)
}

pub unsafe fn get_section(base: *const u8, name: &[u8; 8]) -> Option<BinarySection<VirtualAddress>> {
    let (sections, section_count) = sections_ptr(base);

    (0..section_count).flat_map(|i| {
        let section = sections.add(0x28 * i);
        let section_name = std::slice::from_raw_parts(section, 8);
        if section_name == name {
            let base = VirtualAddress(base as _);
            let address = base + read_u32(section, 0xc);
            let size = read_u32(section, 0x8);
            let physical_size = read_u32(section, 0x10);
            // samase_scarf doesn't require the zero-initialized data, and one
            // function there in fact doesn't even work with it (We don't use it right
            // now though). However, virtual_size has still to be set to the section's
            // virtual size even if the readable bytes won't include all of it.
            let section =
                std::slice::from_raw_parts(address.0 as *const u8, physical_size as usize);
            Some(BinarySection {
                name: *name,
                virtual_address: address,
                virtual_size: size as u32,
                data: section.into(),
            })
        } else {
            None
        }
    }).next()
}

/// Exe hash for SDF cache etc.
///
/// Hashes section header data, assuming that no meaningful
/// recompilation of game gives exact same section sizes.
pub unsafe fn hash_pe_header(base: *const u8) -> u32 {
    let (sections, section_count) = sections_ptr(base);
    let section_headers = std::slice::from_raw_parts(sections, section_count as usize * 0x28);
    fxhash::hash32(section_headers)
}

unsafe fn read_u32(base: *const u8, offset: usize) -> u32 {
    (base.add(offset) as *const u32).read_unaligned()
}

unsafe fn read_u16(base: *const u8, offset: usize) -> u16 {
    (base.add(offset) as *const u16).read_unaligned()
}
