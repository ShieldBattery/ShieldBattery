use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use server::matchmaking::MatchmakingType;
use server::matchmaking::config::MatchmakerConfig;
use server::matchmaking::matchmaker::{Matchmaker, Player, PlayerModeRating};

fn bench_1v1(c: &mut Criterion) {
    let mut matchmaker = Matchmaker::new(Arc::new(MatchmakerConfig::default()));
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
        server_pings: HashMap::new(),
    }) {
        matchmaker.insert_player(player).unwrap();
    }
    c.bench_function("find_matches_1v1", |b| {
        b.iter(|| black_box(matchmaker.find_matches(Instant::now())));
    });
}

fn bench_2v2(c: &mut Criterion) {
    let mut matchmaker = Matchmaker::new(Arc::new(MatchmakerConfig::default()));
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
        server_pings: HashMap::new(),
    }) {
        matchmaker.insert_player(player).unwrap();
    }
    c.bench_function("find_matches_2v2", |b| {
        b.iter(|| black_box(matchmaker.find_matches(Instant::now())));
    });
}

criterion_group!(benches, bench_1v1, bench_2v2);
criterion_main!(benches);
