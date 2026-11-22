//! The one place the DLL makes DXGI factories of its own.

use std::ptr::null_mut;

use parking_lot::Mutex;
use winapi::Interface;
use winapi::shared::dxgi::{CreateDXGIFactory1, IDXGIFactory1};

/// Whether an earlier factory creation failed, held while creating one so creations never
/// overlap.
static CREATION_FAILED: Mutex<bool> = Mutex::new(false);

/// Makes a DXGI factory, returning a reference the caller must release. Returns `None` when
/// creation fails, and from then on without trying again.
///
/// DXVK (under Wine) has crashed inside a `CreateDXGIFactory1` call made shortly after one of
/// these failed, so a failure is taken to mean DXGI is unusable in this process. The game's own
/// renderer setup doesn't come through here and decides for itself.
pub fn create_factory1() -> Option<*mut IDXGIFactory1> {
    let mut failed = CREATION_FAILED.lock();
    if *failed {
        return None;
    }
    let mut factory = null_mut();
    let result = unsafe { CreateDXGIFactory1(&IDXGIFactory1::uuidof(), &mut factory) };
    if result < 0 || factory.is_null() {
        *failed = true;
        return None;
    }
    Some(factory as *mut IDXGIFactory1)
}
