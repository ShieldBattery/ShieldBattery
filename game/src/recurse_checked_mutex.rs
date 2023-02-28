//! A mutex that checks on lock if the locking thread is same as current,
//! and returns `None` in that case.
//!
//! Ideally the recursive locking shouldn't happen at all, but with globals
//! and hooks and windows callbacks it seems likely enough that eventually
//! some code path ends calling this, at which point we'd want to avoid
//! deadlocks.

use std::sync::atomic::{AtomicUsize, Ordering};

use winapi::um::processthreadsapi::GetCurrentThreadId;

#[repr(C)]
pub struct Mutex<T> {
    locking_thread: AtomicUsize,
    inner: parking_lot::Mutex<T>,
}

pub struct MutexGuard<'a, T: 'a> {
    mutex: &'a Mutex<T>,
    guard: parking_lot::MutexGuard<'a, T>,
}

unsafe impl<T> Sync for Mutex<T> {}

impl<T> Mutex<T> {
    pub const fn new(value: T) -> Mutex<T> {
        Mutex {
            inner: parking_lot::const_mutex(value),
            locking_thread: AtomicUsize::new(0),
        }
    }

    #[inline]
    pub fn lock<'s>(&'s self) -> Option<MutexGuard<'s, T>> {
        Some(MutexGuard {
            mutex: self,
            guard: self.lock_inner()?,
        })
    }

    fn lock_inner<'s>(&'s self) -> Option<parking_lot::MutexGuard<'s, T>> {
        let self_thread_id = unsafe { GetCurrentThreadId() };
        if self.locking_thread.load(Ordering::Relaxed) as u32 == self_thread_id {
            // Should maybe just log a warning here?
            // On assumption that the code is never supposed to call this
            // when the thread has already locked the mutex, and that
            // hitting this None path is a bug.
            return None;
        }
        let guard = self.inner.lock();
        self.locking_thread
            .store(self_thread_id as usize, Ordering::Relaxed);
        Some(guard)
    }
}

impl<T: Default> Default for Mutex<T> {
    fn default() -> Self {
        Mutex {
            inner: Default::default(),
            locking_thread: AtomicUsize::new(0),
        }
    }
}

impl<'a, T: 'a> Drop for MutexGuard<'a, T> {
    fn drop(&mut self) {
        self.mutex.locking_thread.store(0, Ordering::Relaxed);
    }
}

impl<'a, T: 'a> std::ops::Deref for MutexGuard<'a, T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.guard
    }
}

impl<'a, T: 'a> std::ops::DerefMut for MutexGuard<'a, T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut self.guard
    }
}
