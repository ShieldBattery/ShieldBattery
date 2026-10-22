use std::time::Duration;

use crate::app_messages::RawGameResultsReport;
use crate::bw::BwGameType;
use crate::bw::players::{
    AllianceState, AssignedRace, FinalNetworkStatus, PlayerLoseType, PlayerResult, StormPlayerId,
    VictoryState,
};

use super::*;

// TODO(tec27): Move this somewhere common for all tests
static INIT_LOGS: std::sync::Once = std::sync::Once::new();

fn init_logs() {
    INIT_LOGS.call_once(|| {
        fern::Dispatch::new()
            .level(log::LevelFilter::Debug)
            .level_for("tokio_reactor", log::LevelFilter::Warn) // Too spammy otherwise
            .chain(fern::Output::call(|record| {
                // Rust test runner's capturing of test prings works only through
                // println and related macros, not when writing directly to io::stdout,
                // so this is not same as just chain(stdout)
                println!(
                    "{}:{} {}",
                    record.file().unwrap_or("?"),
                    record.line().unwrap_or(0),
                    record.args(),
                );
            }))
            .apply()
            .unwrap();
    });
}

fn make_standard_network_results(num_players: u8) -> HashMap<StormPlayerId, FinalNetworkStatus> {
    (0..8)
        .map(|i| {
            (
                StormPlayerId(i),
                FinalNetworkStatus {
                    has_quit: i >= num_players,
                    was_dropped: false,
                },
            )
        })
        .collect()
}

#[test]
fn results_1v1_opponent_leaves() {
    init_logs();
    // 0 has victory_state defeat
    // 1 has victory_state victory
    // 0 has was_dropped false, has_quit false
    // 1 has was_dropped false, has_quit true
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: local_user.id,
    };
    let opponent = JoinedPlayer {
        name: "opponent".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: 77.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::one_v_one(),
            player_results: HashMap::from([
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Victory,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::Allied;
                            a
                        },
                    },
                ),
            ]),
            network_results: {
                let mut n = make_standard_network_results(2);
                n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                n
            },
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, opponent],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Victory,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_1v1_self_leaves() {
    init_logs();
    // 0 has victory_state playing
    // 1 has victory_state playing
    // 0 has was_dropped false, has_quit false
    // 1 has was_dropped false, has_quit false
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: local_user.id,
    };
    let opponent = JoinedPlayer {
        name: "opponent".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: 77.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::melee(),
            player_results: HashMap::from([
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::Allied;
                            a
                        },
                    },
                ),
            ]),
            network_results: make_standard_network_results(2),
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, opponent],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_1v1_self_all_buildings_killed() {
    init_logs();
    // 0 has victory_state defeat
    // 1 has victory state victory
    // 0 has was_dropped false, has_quit false
    // 1 has was_dropped false, has_quit false
    // (note that has_quit can differ depending on order of players leaving, at least until
    // we calc/submit results when the dialog shows)
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: local_user.id,
    };
    let opponent = JoinedPlayer {
        name: "opponent".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: 77.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::melee(),
            player_results: HashMap::from([
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Victory,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::Allied;
                            a
                        },
                    },
                ),
            ]),
            network_results: make_standard_network_results(2),
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, opponent],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Victory,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_1v1_opponent_dropped() {
    init_logs();
    // 0 has victory_state victory
    // 1 has victory_state disconnected
    // 0 has was_dropped false, has_quit false
    // 1 has was_dropped true, has_quit true
    // lose type = TargetedDisconnect
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: local_user.id,
    };
    let opponent = JoinedPlayer {
        name: "opponent".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: 77.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::one_v_one(),
            player_results: HashMap::from([
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Victory,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Disconnected,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::Allied;
                            a
                        },
                    },
                ),
            ]),
            network_results: {
                let mut n = make_standard_network_results(2);
                n.get_mut(&StormPlayerId(1)).unwrap().was_dropped = true;
                n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                n
            },
            local_player_lose_type: Some(PlayerLoseType::TargetedDisconnect),
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, opponent],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Victory,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_2v2_victory_ally_left() {
    init_logs();
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };
    let ally = JoinedPlayer {
        name: "ally".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: 77.into(),
    };
    let opponent1 = JoinedPlayer {
        name: "opponent1".to_string(),
        storm_id: StormPlayerId(2),
        player_id: Some(BwPlayerId(2)),
        sb_user_id: 78.into(),
    };
    let opponent2 = JoinedPlayer {
        name: "opponent2".to_string(),
        storm_id: StormPlayerId(3),
        player_id: Some(BwPlayerId(3)),
        sb_user_id: 79.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::top_v_bottom(2),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Victory,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(3),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Terran,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
            ]),
            network_results: {
                let mut n = make_standard_network_results(4);
                n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                n
            },
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, ally, opponent1, opponent2],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Victory,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Victory,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                78.into(),
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                79.into(),
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Terran,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_2v2_left_with_ally_still_playing() {
    init_logs();
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };
    let ally = JoinedPlayer {
        name: "ally".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: 77.into(),
    };
    let opponent1 = JoinedPlayer {
        name: "opponent1".to_string(),
        storm_id: StormPlayerId(2),
        player_id: Some(BwPlayerId(2)),
        sb_user_id: 78.into(),
    };
    let opponent2 = JoinedPlayer {
        name: "opponent2".to_string(),
        storm_id: StormPlayerId(3),
        player_id: Some(BwPlayerId(3)),
        sb_user_id: 79.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::melee(),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(3),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
            ]),
            network_results: make_standard_network_results(4),
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, ally, opponent1, opponent2],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Disconnected,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                78.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                79.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Terran,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_2v2_loss() {
    init_logs();
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };
    let ally = JoinedPlayer {
        name: "ally".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: 77.into(),
    };
    let opponent1 = JoinedPlayer {
        name: "opponent1".to_string(),
        storm_id: StormPlayerId(2),
        player_id: Some(BwPlayerId(2)),
        sb_user_id: 78.into(),
    };
    let opponent2 = JoinedPlayer {
        name: "opponent2".to_string(),
        storm_id: StormPlayerId(3),
        player_id: Some(BwPlayerId(3)),
        sb_user_id: 79.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::top_v_bottom(2),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(3),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
            ]),
            network_results: {
                let mut n = make_standard_network_results(4);
                n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                n
            },
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, ally, opponent1, opponent2],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                78.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                79.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Terran,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_2v2_nonsymmetric_allies() {
    init_logs();
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };
    let ally = JoinedPlayer {
        name: "ally".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: 77.into(),
    };
    let opponent1 = JoinedPlayer {
        name: "opponent1".to_string(),
        storm_id: StormPlayerId(2),
        player_id: Some(BwPlayerId(2)),
        sb_user_id: 78.into(),
    };
    let opponent2 = JoinedPlayer {
        name: "opponent2".to_string(),
        storm_id: StormPlayerId(3),
        player_id: Some(BwPlayerId(3)),
        sb_user_id: 79.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::melee(),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(3),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
            ]),
            network_results: make_standard_network_results(4),
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, ally, opponent1, opponent2],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                78.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                79.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Terran,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_2v2_self_disconnect() {
    init_logs();
    // Ally: disconnected, was_dropped + has_quit
    // Enemies: disconnected, was_dropped + has quit
    // Me: victory, not dropped or quit
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };
    let ally = JoinedPlayer {
        name: "ally".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: 77.into(),
    };
    let opponent1 = JoinedPlayer {
        name: "opponent1".to_string(),
        storm_id: StormPlayerId(2),
        player_id: Some(BwPlayerId(2)),
        sb_user_id: 78.into(),
    };
    let opponent2 = JoinedPlayer {
        name: "opponent2".to_string(),
        storm_id: StormPlayerId(3),
        player_id: Some(BwPlayerId(3)),
        sb_user_id: 79.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::top_v_bottom(2),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Victory,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Disconnected,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Disconnected,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(3),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Disconnected,
                        race: AssignedRace::Terran,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
            ]),
            network_results: {
                let mut n = make_standard_network_results(4);
                n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                n.get_mut(&StormPlayerId(1)).unwrap().was_dropped = true;
                n.get_mut(&StormPlayerId(2)).unwrap().has_quit = true;
                n.get_mut(&StormPlayerId(2)).unwrap().was_dropped = true;
                n.get_mut(&StormPlayerId(3)).unwrap().has_quit = true;
                n.get_mut(&StormPlayerId(3)).unwrap().was_dropped = true;
                n
            },
            local_player_lose_type: Some(PlayerLoseType::MassDisconnect),
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, ally, opponent1, opponent2],
        &local_user,
    );

    // The desire here is that we mark ourselves however the game said, but we leave everyone
    // else as "Playing" if they were dropped as part of the mass disconnect, so that, ideally,
    // the majority report from the other side of the connection will outweigh our reports.
    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Victory,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                78.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                79.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Terran,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_2v2_with_dropped_player() {
    init_logs();
    // Ally (dropped): disconnected, was_dropped + has_quit
    // Enemies: playing, not dropped or quit
    // Me: playing, not dropped or quit
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };
    let ally = JoinedPlayer {
        name: "ally".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: 77.into(),
    };
    let opponent1 = JoinedPlayer {
        name: "opponent1".to_string(),
        storm_id: StormPlayerId(2),
        player_id: Some(BwPlayerId(2)),
        sb_user_id: 78.into(),
    };
    let opponent2 = JoinedPlayer {
        name: "opponent2".to_string(),
        storm_id: StormPlayerId(3),
        player_id: Some(BwPlayerId(3)),
        sb_user_id: 79.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::melee(),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Disconnected,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::AlliedVictory;
                            a[1] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(3),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
            ]),
            network_results: {
                let mut n = make_standard_network_results(4);
                n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                n.get_mut(&StormPlayerId(1)).unwrap().was_dropped = true;
                n
            },
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, ally, opponent1, opponent2],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Disconnected,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                78.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                79.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Terran,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_ums_game() {
    init_logs();
    // UMS should exactly reproduce whatever the game thread sent us
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };
    let opponent = JoinedPlayer {
        name: "opponent".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(1)),
        sb_user_id: 77.into(),
    };
    let third = JoinedPlayer {
        name: "third".to_string(),
        storm_id: StormPlayerId(2),
        player_id: Some(BwPlayerId(2)),
        sb_user_id: 78.into(),
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::ums(),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::AlliedVictory;
                            a[2] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::AlliedVictory;
                            a[2] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
            ]),
            network_results: {
                let mut n = make_standard_network_results(2);
                n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                n
            },
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, opponent, third],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                77.into(),
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                78.into(),
                GamePlayerResult {
                    result: VictoryState::Playing,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_with_allied_computers() {
    init_logs();
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };
    let opponent1 = JoinedPlayer {
        name: "opponent1".to_string(),
        storm_id: StormPlayerId(1),
        player_id: Some(BwPlayerId(2)),
        sb_user_id: 78.into(),
    };
    let opponent2 = JoinedPlayer {
        name: "opponent2".to_string(),
        storm_id: StormPlayerId(2),
        player_id: Some(BwPlayerId(3)),
        sb_user_id: 79.into(),
    };

    // BW ID 1 + 4 are computers, allied with each other and players 2 + 3
    // Local player (0) has their buildings destroyed and thus loses, the remaining computer
    // should bring along 2 + 3 as victors
    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::melee(),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::AlliedVictory;
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a[4] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::AlliedVictory;
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(3),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Defeat,
                        race: AssignedRace::Terran,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::AlliedVictory;
                            a[2] = AllianceState::AlliedVictory;
                            a[3] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(4),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::AlliedVictory;
                            a[4] = AllianceState::AlliedVictory;
                            a
                        },
                    },
                ),
            ]),
            network_results: {
                let mut n = make_standard_network_results(3);
                n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                n.get_mut(&StormPlayerId(2)).unwrap().has_quit = true;
                n
            },
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local, opponent1, opponent2],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([
            (
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),
            (
                78.into(),
                GamePlayerResult {
                    result: VictoryState::Victory,
                    race: AssignedRace::Protoss,
                    apm: 0,
                }
            ),
            (
                79.into(),
                GamePlayerResult {
                    result: VictoryState::Victory,
                    race: AssignedRace::Terran,
                    apm: 0,
                }
            )
        ])
    )
}

#[test]
fn results_with_unallied_computers() {
    init_logs();
    let local_user = SbUser {
        id: 1.into(),
        name: "local".to_string(),
        avatar_url: None,
    };
    let local = JoinedPlayer {
        name: local_user.name.clone(),
        storm_id: StormPlayerId(0),
        player_id: Some(BwPlayerId(0)),
        sb_user_id: local_user.id,
    };

    let results = determine_game_results(
        GameThreadResults {
            game_type: BwGameType::melee(),
            player_results: HashMap::from([
                (
                    BwPlayerId(0),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Zerg,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[0] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(1),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[1] = AllianceState::Allied;
                            a
                        },
                    },
                ),
                (
                    BwPlayerId(2),
                    PlayerResult {
                        apm: 0,
                        victory_state: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        alliances: {
                            let mut a = [AllianceState::Unallied; 8];
                            a[2] = AllianceState::Allied;
                            a
                        },
                    },
                ),
            ]),
            network_results: make_standard_network_results(1),
            local_player_lose_type: None,
            time: Duration::from_millis(27270),
            replay_path: None,
        },
        &[local],
        &local_user,
    );

    assert_eq!(
        results,
        HashMap::from([(
            local_user.id,
            GamePlayerResult {
                result: VictoryState::Defeat,
                race: AssignedRace::Zerg,
                apm: 0,
            }
        ),])
    )
}

#[test]
fn raw_report_serializes_expected_json() {
    let players = vec![
        RawPlayerResult {
            user_id: Some(10.into()),
            bw_player_id: 0,
            storm_id: Some(0),
            race: AssignedRace::Zerg,
            victory_state: VictoryState::Victory,
            alliances: {
                let mut a = [AllianceState::Unallied; 8];
                a[1] = AllianceState::AlliedVictory;
                a
            },
        },
        RawPlayerResult {
            user_id: None,
            bw_player_id: 1,
            storm_id: None,
            race: AssignedRace::Terran,
            victory_state: VictoryState::Defeat,
            alliances: [AllianceState::Unallied; 8],
        },
    ];
    let net_players = vec![RawNetPlayer {
        storm_id: 0,
        was_dropped: false,
        has_quit: true,
    }];
    let report = RawGameResultsReport {
        version: 2,
        user_id: 10.into(),
        result_code: "abc",
        time: 1234,
        players: &players,
        net_players: &net_players,
        local_player_lose_type: Some(PlayerLoseType::TargetedDisconnect),
    };

    let value = serde_json::to_value(&report).unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "version": 2,
            "userId": 10,
            "resultCode": "abc",
            "time": 1234,
            "players": [
                {
                    "userId": 10,
                    "bwPlayerId": 0,
                    "stormId": 0,
                    "race": "z",
                    "victoryState": 3,
                    "alliances": [0, 2, 0, 0, 0, 0, 0, 0],
                },
                {
                    "userId": null,
                    "bwPlayerId": 1,
                    "stormId": null,
                    "race": "t",
                    "victoryState": 2,
                    "alliances": [0, 0, 0, 0, 0, 0, 0, 0],
                },
            ],
            "netPlayers": [
                { "stormId": 0, "wasDropped": false, "hasQuit": true },
            ],
            "localPlayerLoseType": "targetedDisconnect",
        })
    );
}

#[test]
fn maximal_raw_report_fits_relay_cap() {
    let players = (0..8u8)
        .map(|i| RawPlayerResult {
            user_id: Some(u32::MAX.into()),
            bw_player_id: i,
            storm_id: Some(i),
            race: AssignedRace::Protoss,
            victory_state: VictoryState::Disconnected,
            alliances: [AllianceState::AlliedVictory; 8],
        })
        .collect::<Vec<_>>();
    let net_players = (0..8u8)
        .map(|i| RawNetPlayer {
            storm_id: i,
            was_dropped: true,
            has_quit: true,
        })
        .collect::<Vec<_>>();
    let report = RawGameResultsReport {
        version: 2,
        user_id: u32::MAX.into(),
        result_code: "0123456789abcdef0123456789abcdef",
        time: u64::MAX,
        players: &players,
        net_players: &net_players,
        local_player_lose_type: Some(PlayerLoseType::MassDisconnect),
    };

    let bytes = serde_json::to_vec(&report).unwrap();
    assert!(
        bytes.len() < 4096,
        "maximal raw report was {} bytes, expected comfortably under 4096",
        bytes.len(),
    );
}
