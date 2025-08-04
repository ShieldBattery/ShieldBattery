use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use winapi::um::processthreadsapi::GetCurrentThreadId;

const NOT_LOCKED: u32 = 0;

/// Simple implementation of a spin lock that contains no data, used to guard entry into critical
/// sections. Allows for re-entrant locking. Would not recommend using this for anything remotely
/// complex, it has sharp edges :)
pub struct DumbSpinLock {
    locked_by: AtomicU32,
    /// How many times the current thread has locked this lock. This is guarded by `locked_by`, so
    /// we increment/decrement it only while locked. Since this is a count for the same thread only,
    /// can guarantee that the current thread won't be simultaneously unlocking the lock and the
    /// count will remain correct. This is only atomic to get interior mutability.
    lock_count: AtomicUsize,
}

impl DumbSpinLock {
    pub fn new() -> Self {
        DumbSpinLock {
            locked_by: AtomicU32::new(NOT_LOCKED),
            lock_count: AtomicUsize::new(0),
        }
    }

    pub fn lock(&self) {
        let thread_id = unsafe { GetCurrentThreadId() };
        if self.locked_by.load(Ordering::Acquire) == thread_id {
            // Already locked by this thread, just increment the count
            self.lock_count.fetch_add(1, Ordering::Relaxed);
            return;
        }

        while self
            .locked_by
            .compare_exchange(NOT_LOCKED, thread_id, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        self.lock_count.store(1, Ordering::Relaxed);
    }

    pub fn unlock(&self) {
        let thread_id = unsafe { GetCurrentThreadId() };
        if self.locked_by.load(Ordering::Acquire) != thread_id {
            panic!("Not locked by the current thread!");
        } else if self.lock_count.fetch_sub(1, Ordering::Relaxed) > 1 {
            // Re-entrant unlock, need more unlocks to actually release the lock
        } else {
            self.locked_by.store(NOT_LOCKED, Ordering::Release);
        }
    }
}
