use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use std::hint::black_box;

use criterion::{BatchSize, BenchmarkId, Criterion, criterion_group, criterion_main};
use server::matchmaking::MatchmakingType;
use server::matchmaking::backbone::BackboneRttTable;
use server::matchmaking::config::MatchmakerConfig;
use server::matchmaking::matchmaker::{Matchmaker, Player, PlayerModeRating, RandomQueueSelector};

const BENCH_QUEUE_SIZE: usize = 1000;

#[derive(Clone, Copy)]
struct ProductionTickCase {
    name: &'static str,
    mode: MatchmakingType,
    regional: bool,
    positive_map_selections: bool,
}

fn production_backbone() -> BackboneRttTable {
    BackboneRttTable::new([
        ("us-east|us-west".to_string(), 55.0),
        ("us-east|eu-west".to_string(), 85.0),
        ("us-east|ap-south".to_string(), 105.0),
        ("us-west|eu-west".to_string(), 95.0),
        ("us-west|ap-south".to_string(), 110.0),
        ("eu-west|ap-south".to_string(), 75.0),
    ])
}

fn production_player(id: usize, case: ProductionTickCase) -> Player {
    let (region, rtt_ms) = if case.regional {
        const REGIONS: [(&str, f32); 4] = [
            ("us-east", 18.0),
            ("us-west", 22.0),
            ("eu-west", 26.0),
            ("ap-south", 30.0),
        ];
        let (region, base_rtt) = REGIONS[id % REGIONS.len()];
        (Some(region.to_string()), Some(base_rtt + (id % 5) as f32))
    } else {
        (None, None)
    };

    let map_selections = if case.positive_map_selections {
        HashMap::from([(
            case.mode,
            vec![
                "fastest-shared".to_string(),
                format!("fastest-{}", id % 4),
                format!("fastest-{}", (id + 1) % 4),
            ],
        )])
    } else {
        HashMap::new()
    };

    Player {
        id,
        ratings: HashMap::from([(
            case.mode,
            PlayerModeRating {
                rating: 1000.0 + (id % 7) as f32 * 2.0,
                uncertainty: Some(35.0 + (id % 3) as f32 * 5.0),
            },
        )]),
        map_selections,
        region,
        rtt_ms,
    }
}

fn production_template(
    case: ProductionTickCase,
    config: Arc<MatchmakerConfig>,
    backbone: &BackboneRttTable,
) -> Matchmaker<RandomQueueSelector> {
    let mut matchmaker = Matchmaker::new(config, backbone.clone());
    for id in 0..BENCH_QUEUE_SIZE {
        matchmaker
            .insert_player(production_player(id, case))
            .unwrap();
    }
    matchmaker
}

fn bench_1v1(c: &mut Criterion) {
    let mut matchmaker = Matchmaker::new(
        Arc::new(MatchmakerConfig::default()),
        BackboneRttTable::default(),
    );
    for player in (0..1000).map(|n| Player {
        id: n,
        ratings: HashMap::from([(
            MatchmakingType::Match1v1,
            PlayerModeRating {
                rating: 1000.0,
                uncertainty: None,
            },
        )]),
        map_selections: HashMap::new(),
        region: None,
        rtt_ms: None,
    }) {
        matchmaker.insert_player(player).unwrap();
    }
    c.bench_function("find_matches_1v1", |b| {
        b.iter(|| black_box(matchmaker.find_matches(Instant::now())));
    });
}

fn bench_2v2(c: &mut Criterion) {
    let mut matchmaker = Matchmaker::new(
        Arc::new(MatchmakerConfig::default()),
        BackboneRttTable::default(),
    );
    for player in (0..1000).map(|n| Player {
        id: n,
        ratings: HashMap::from([(
            MatchmakingType::Match2v2,
            PlayerModeRating {
                rating: 1000.0,
                uncertainty: None,
            },
        )]),
        map_selections: HashMap::new(),
        region: None,
        rtt_ms: None,
    }) {
        matchmaker.insert_player(player).unwrap();
    }
    c.bench_function("find_matches_2v2", |b| {
        b.iter(|| black_box(matchmaker.find_matches(Instant::now())));
    });
}

fn bench_3v3_scaling(c: &mut Criterion) {
    let mode = MatchmakingType::Match3v3Bgh;
    let mut group = c.benchmark_group("find_matches_3v3");

    for max_players_examined in [6, 8, 12, 16, 20, 22, 24] {
        let mut config = MatchmakerConfig::default();
        config.max_players_examined = max_players_examined;
        let mut matchmaker = Matchmaker::new(Arc::new(config), BackboneRttTable::default());
        for player in (0..1000).map(|n| Player {
            id: n,
            ratings: HashMap::from([(
                mode,
                PlayerModeRating {
                    rating: 1000.0,
                    uncertainty: None,
                },
            )]),
            map_selections: HashMap::new(),
            region: None,
            rtt_ms: None,
        }) {
            matchmaker.insert_player(player).unwrap();
        }

        group.bench_with_input(
            BenchmarkId::from_parameter(max_players_examined),
            &max_players_examined,
            |b, _| {
                b.iter(|| black_box(matchmaker.find_matches_for_modes(&[mode], Instant::now())));
            },
        );
    }

    group.finish();
}

fn bench_tick_3v3_scaling(c: &mut Criterion) {
    let mode = MatchmakingType::Match3v3Bgh;
    let mut group = c.benchmark_group("run_tick_3v3");

    for max_players_examined in [6, 8, 12, 16, 20, 22, 24] {
        let mut config = MatchmakerConfig::default();
        config.max_players_examined = max_players_examined;
        let config = Arc::new(config);
        let backbone = Arc::new(BackboneRttTable::default());
        let mut template = Matchmaker::new(config.clone(), BackboneRttTable::default());
        for player in (0..1000).map(|n| Player {
            id: n,
            ratings: HashMap::from([(
                mode,
                PlayerModeRating {
                    rating: 1000.0,
                    uncertainty: None,
                },
            )]),
            map_selections: HashMap::new(),
            region: None,
            rtt_ms: None,
        }) {
            template.insert_player(player).unwrap();
        }

        group.bench_with_input(
            BenchmarkId::from_parameter(max_players_examined),
            &max_players_examined,
            |b, _| {
                b.iter_batched(
                    || template.clone(),
                    |mut matchmaker| {
                        black_box(matchmaker.run_tick(
                            Instant::now(),
                            config.clone(),
                            backbone.clone(),
                        ))
                    },
                    BatchSize::SmallInput,
                );
            },
        );
    }

    group.finish();
}

fn bench_tick_production_cases(c: &mut Criterion) {
    let cases = [
        ProductionTickCase {
            name: "1v1_regional_rtt",
            mode: MatchmakingType::Match1v1,
            regional: true,
            positive_map_selections: false,
        },
        ProductionTickCase {
            name: "1v1_fastest_pick_maps",
            mode: MatchmakingType::Match1v1Fastest,
            regional: false,
            positive_map_selections: true,
        },
        ProductionTickCase {
            name: "3v3_fastest_regional_pick",
            mode: MatchmakingType::Match3v3Fastest,
            regional: true,
            positive_map_selections: true,
        },
    ];
    let mut group = c.benchmark_group("run_tick_production");

    for case in cases {
        let config = Arc::new(MatchmakerConfig::default());
        let backbone = Arc::new(if case.regional {
            production_backbone()
        } else {
            BackboneRttTable::default()
        });
        let template = production_template(case, config.clone(), &backbone);

        group.bench_function(case.name, |b| {
            b.iter_batched(
                || template.clone(),
                |mut matchmaker| {
                    black_box(matchmaker.run_tick(Instant::now(), config.clone(), backbone.clone()))
                },
                BatchSize::SmallInput,
            );
        });
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_1v1,
    bench_2v2,
    bench_3v3_scaling,
    bench_tick_3v3_scaling,
    bench_tick_production_cases
);
criterion_main!(benches);
