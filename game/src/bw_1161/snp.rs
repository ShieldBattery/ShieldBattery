use std::mem;
use std::ptr::null_mut;

use lazy_static::lazy_static;
use libc::c_void;
use winapi::um::libloaderapi::GetModuleFileNameA;

use crate::bw;
use crate::snp::{PROVIDER_ID, SNP_PACKET_SIZE};
use crate::windows;

use super::storm;

lazy_static! {
    static ref SNP_LIST_ENTRY: bw::SnpListEntry = init_list_entry();
}

unsafe fn init_snp_list_hook() {
    // Set up Storm's SNP list ourselves, so that we don't have to worry about having an MPQ file
    // appended to this one and don't have to worry about passing signature checks.
    if *storm::snp_list_initialized == 0 {
        *storm::snp_list_initialized = 1;
        let entry = &*SNP_LIST_ENTRY as *const bw::SnpListEntry as *mut bw::SnpListEntry;
        (*storm::snp_list).prev = entry;
        (*storm::snp_list).next = entry;
    }
}

unsafe fn unload_snps(_clear_list: u32, orig: unsafe extern fn(u32)) {
    // Never pass clear_list = true, as we initialized the list and Storm can't free the memory
    orig(0);
    if *storm::snp_list_initialized != 0 {
        *storm::snp_list_initialized = 0;
        (*storm::snp_list).prev = null_mut();
        (*storm::snp_list).next = null_mut();
    }
}

pub unsafe fn init_hooks(patcher: &mut whack::Patcher) {
    let mut storm = patcher.patch_library("storm", 0x1500_0000);
    storm::init_vars(&mut storm);
    storm.hook(storm::InitializeSnpList, init_snp_list_hook);
    storm.hook_opt(storm::UnloadSnp, unload_snps);
}

fn init_list_entry() -> bw::SnpListEntry {
    let mut list_entry = bw::SnpListEntry {
        // Since we don't actually use the list, its fine not to set this
        prev: null_mut(),
        next: -1isize as *mut bw::SnpListEntry, // Ensure the list ends,
        file_path: [0; 260],
        index: 0,
        identifier: PROVIDER_ID,
        // Name/Description don't matter since we don't show the normal network UI
        name: [0; 128],
        description: [0; 128],
        capabilities: bw::SnpCapabilities {
            size: mem::size_of::<bw::SnpCapabilities>() as u32,
            // As far as I can see, only the 1 bit matters here, and seems to affect how storm
            // allocates for packet data. Only UDP LAN sets it. Doesn't look particularly useful
            // to us. All of the network modes set at least 0x20000000 though, so we'll set it as
            // well.
            unknown1: 0x20000000,
            // minus 16 because Storm normally does that (overhead?)
            max_packet_size: SNP_PACKET_SIZE - 16,
            unknown3: 16,
            displayed_player_count: 256,
            // This value is related to timeouts in some way (it's always used alongside
            // GetTickCount, and always as the divisor). The value here matches the one used by
            // UDP LAN and new (post-lan-lat-changes) BNet.
            unknown5: 100000,
            // This value is seemingly related to timeouts as well (and does not affect action
            // latency under normal conditions). The value chosen here sits between UDP LAN
            // (50, minimum) and BNet (500).
            player_latency: 384,
            // This is not really an accurate naming, it's more related to the rate at which
            // packets will be sent. This value matches UDP LAN and new (post-lan-lat-changes)
            // BNet.
            max_player_count: 8,
            // Matches UDP LAN
            turn_delay: 2,
        },
    };
    let self_module = windows::module_from_address(init_list_entry as *mut c_void);
    if let Some((_, module)) = self_module {
        // Using GetModuleFileNameA specifically if the dll is in a
        // not-ascii-but-valid-current-language path.
        unsafe {
            let n = GetModuleFileNameA(
                module,
                list_entry.file_path.as_mut_ptr() as *mut i8,
                list_entry.file_path.len() as u32,
            );
            if n == 0 {
                panic!(
                    "GetModuleFileNameA failed: {}",
                    std::io::Error::last_os_error()
                );
            }
        }
    } else {
        panic!("Unable to get self path");
    }
    list_entry
}
