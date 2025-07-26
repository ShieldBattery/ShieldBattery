use std::sync::atomic::{AtomicBool, Ordering};

/// Simple implementation of a spin lock that contains no data, used to guard entry into critical
/// sections. Would not recommend using this for anything remotely complex, it has sharp edges :)
pub struct DumbSpinLock {
    locked: AtomicBool,
}

impl DumbSpinLock {
    pub fn new() -> Self {
        DumbSpinLock {
            locked: AtomicBool::new(false),
        }
    }

    pub fn lock(&self) {
        while self.locked.swap(true, Ordering::Acquire) {
            std::hint::spin_loop();
        }
    }

    pub fn unlock(&self) {
        self.locked.store(false, Ordering::Release);
    }
}
