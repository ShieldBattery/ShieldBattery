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

    fn enabled(&self, local: bool, instance: bool, legacy: bool, development: bool) -> bool {
        self.untracked.load(Ordering::Acquire)
            && ((self.local_session.load(Ordering::Acquire) && local && instance)
                || (development && requested_for_launch(local, instance, legacy, true)))
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

/// Release bridge execution requires an established, untracked local session.
pub fn enabled() -> bool {
    ACCESS.enabled(
        crate::is_local_game(),
        crate::bwapi_instance().is_some(),
        std::env::var_os("SB_BWAPI").is_some(),
        cfg!(debug_assertions),
    )
}

/// Terrain analysis runs before transport establishment and cannot start a bridge.
pub(crate) fn analysis_requested() -> bool {
    requested_for_launch(
        crate::is_local_game(),
        crate::bwapi_instance().is_some(),
        std::env::var_os("SB_BWAPI").is_some(),
        cfg!(debug_assertions),
    )
}

fn requested_for_launch(local: bool, instance: bool, legacy: bool, development: bool) -> bool {
    (local && instance) || (development && (instance || (legacy && !local)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_requires_local_session_and_refuses_tracked_or_relay_games() {
        let access = BridgeAccess::new();
        assert!(requested_for_launch(true, true, false, false));
        assert!(!access.enabled(true, true, false, false));
        access.configure(false, false);
        assert!(!access.enabled(true, true, false, false));
        access.establish_local_session();
        assert!(access.enabled(true, true, false, false));
        assert!(!access.enabled(true, false, true, false));
        assert!(!access.enabled(false, true, true, false));
        for (tracked, relay) in [(true, false), (false, true), (true, true)] {
            access.configure(tracked, relay);
            access.establish_local_session();
            for development in [false, true] {
                assert!(!access.enabled(true, true, true, development));
                assert!(!access.enabled(false, true, true, development));
            }
        }
        access.configure(false, false);
        assert!(!access.enabled(true, true, false, false));
        assert!(access.enabled(false, true, false, true));
        assert!(access.enabled(false, false, true, true));
    }

    #[test]
    fn release_terrain_analysis_requires_local_instance() {
        for legacy in [false, true] {
            for local in [false, true] {
                for instance in [false, true] {
                    assert_eq!(
                        requested_for_launch(local, instance, legacy, false),
                        local && instance
                    );
                }
            }
        }
    }

    #[test]
    fn development_retains_explicit_and_legacy_discovery() {
        assert!(requested_for_launch(false, true, false, true));
        assert!(requested_for_launch(false, false, true, true));
        assert!(!requested_for_launch(true, false, true, true));
        assert!(!requested_for_launch(false, false, false, true));
    }
}
