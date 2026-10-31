//! BWAPI 4.4 external-client bridge for supervised local practice.

use std::sync::atomic::{AtomicBool, Ordering};

pub mod commands;
pub mod transport;
pub mod wire;

static ACCESS: BridgeAccess = BridgeAccess::new();

struct BridgeAccess {
    untracked: AtomicBool,
    local_session: AtomicBool,
}

impl BridgeAccess {
    const fn new() -> Self {
        Self {
            untracked: AtomicBool::new(false),
            local_session: AtomicBool::new(false),
        }
    }

    fn configure(&self, tracked: bool, relay: bool) {
        self.local_session.store(false, Ordering::Release);
        self.untracked.store(!tracked && !relay, Ordering::Release);
    }

    fn establish_local_session(&self) {
        if self.untracked.load(Ordering::Acquire) {
            self.local_session.store(true, Ordering::Release);
        }
    }

    fn enabled(&self, local: bool, instance: bool) -> bool {
        self.untracked.load(Ordering::Acquire)
            && self.local_session.load(Ordering::Acquire)
            && requested_for_launch(local, instance)
    }
}

/// Initializes bridge policy before game initialization or transport establishment.
pub(crate) fn configure_session(tracked: bool, relay: bool) {
    ACCESS.configure(tracked, relay);
}

/// Called only after the local named-pipe session has been established.
pub(crate) fn establish_local_session() {
    ACCESS.establish_local_session();
}

/// Bridge execution requires an established, untracked local session.
pub fn enabled() -> bool {
    ACCESS.enabled(crate::is_local_game(), crate::bwapi_instance().is_some())
}

/// Terrain analysis runs before transport establishment and cannot start a bridge.
pub(crate) fn analysis_requested() -> bool {
    requested_for_launch(crate::is_local_game(), crate::bwapi_instance().is_some())
}

fn requested_for_launch(local: bool, instance: bool) -> bool {
    local && instance
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_requires_established_untracked_local_session_and_instance() {
        let access = BridgeAccess::new();
        assert!(!access.enabled(true, true));
        access.establish_local_session();
        assert!(!access.enabled(true, true));
        access.configure(false, false);
        assert!(!access.enabled(true, true));
        access.establish_local_session();
        for local in [false, true] {
            for instance in [false, true] {
                assert_eq!(access.enabled(local, instance), local && instance);
            }
        }
        // Reconfiguration must discard the established session even when still untracked.
        access.configure(false, false);
        assert!(!access.enabled(true, true));
    }

    #[test]
    fn bridge_refuses_tracked_or_relay_games() {
        let access = BridgeAccess::new();
        for (tracked, relay) in [(true, false), (false, true), (true, true)] {
            access.configure(false, false);
            access.establish_local_session();
            assert!(access.enabled(true, true));
            access.configure(tracked, relay);
            access.establish_local_session();
            for local in [false, true] {
                for instance in [false, true] {
                    assert!(!access.enabled(local, instance));
                }
            }
        }
    }

    #[test]
    fn terrain_analysis_requires_local_instance() {
        for local in [false, true] {
            for instance in [false, true] {
                assert_eq!(requested_for_launch(local, instance), local && instance);
            }
        }
    }
}
