//! Helpers for creating scarf::BinaryFile from a image loaded in memory

use samase_scarf::scarf::{VirtualAddress, BinarySection};

pub unsafe fn get_pe_header(base: *const u8) -> BinarySection<VirtualAddress> {
    let pe_header = read_u32(base, 0x3c);
    let header_block_size = read_u32(base, pe_header as usize + 0x54);
    let header = std::slice::from_raw_parts(base, header_block_size as usize);
    BinarySection {
        name: {
            let mut name = [0; 8];
            for (&c, out) in b"(header)".iter().zip(name.iter_mut()) {
                *out = c;
            }
            name
        },
        virtual_address: VirtualAddress(base as u32),
        virtual_size: header_block_size,
        data: header.into(),
    }
}

pub unsafe fn get_section(base: *const u8, name: &[u8; 8]) -> Option<BinarySection<VirtualAddress>> {
    let pe_header_offset = read_u32(base, 0x3c);
    let pe_header = base.offset(pe_header_offset as isize);
    let section_count = read_u16(pe_header, 6);

    (0..section_count).flat_map(|i| {
        let section = pe_header.offset(0xf8 + 0x28 * i as isize);
        let section_name = std::slice::from_raw_parts(section, 8);
        if section_name == name {
            let address = base as u32 + read_u32(section, 0xc);
            let size = read_u32(section, 0x8);
            let section = std::slice::from_raw_parts(address as *const u8, size as usize);
            Some(BinarySection {
                name: *name,
                virtual_address: VirtualAddress(address),
                virtual_size: size as u32,
                data: section.into(),
            })
        } else {
            None
        }
    }).next()
}

unsafe fn read_u32(base: *const u8, offset: usize) -> u32 {
    (base.add(offset) as *const u32).read_unaligned()
}

unsafe fn read_u16(base: *const u8, offset: usize) -> u16 {
    (base.add(offset) as *const u16).read_unaligned()
}
