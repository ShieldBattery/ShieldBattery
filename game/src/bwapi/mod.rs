//! BWAPI 4.4 external-client bridge for supervised local practice.

pub mod commands;
pub mod transport;
pub mod wire;

/// Release DLLs expose the bridge only for a supervised local bot instance. Legacy discovery
/// stays development-only and cannot attach to a production network game.
pub fn enabled() -> bool {
    enabled_for_launch(
        crate::is_local_game(),
        crate::bwapi_instance().is_some(),
        std::env::var_os("SB_BWAPI").is_some(),
        cfg!(debug_assertions),
    )
}

fn enabled_for_launch(local: bool, instance: bool, legacy: bool, development: bool) -> bool {
    (local && instance) || (development && (instance || (legacy && !local)))
}

#[cfg(test)]
mod tests {
    use super::enabled_for_launch;

    #[test]
    fn release_bridge_requires_supervised_local_instance() {
        for legacy in [false, true] {
            for local in [false, true] {
                for instance in [false, true] {
                    assert_eq!(
                        enabled_for_launch(local, instance, legacy, false),
                        local && instance
                    );
                }
            }
        }
    }

    #[test]
    fn development_retains_explicit_and_legacy_discovery() {
        assert!(enabled_for_launch(false, true, false, true));
        assert!(enabled_for_launch(false, false, true, true));
        assert!(!enabled_for_launch(true, false, true, true));
        assert!(!enabled_for_launch(false, false, false, true));
    }
}
