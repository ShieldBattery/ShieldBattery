use std::time::Instant;

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use server::matchmaking::matchmaker::{Matchmaker, MatchmakingMode, Player};

fn bench_1v1(c: &mut Criterion) {
    let mut matchmaker = Matchmaker::new(16);
    for player in (0..1000).map(|n| Player {
        id: n,
        rating: 1000.0,
    }) {
        matchmaker.insert_player(player, MatchmakingMode::Mode1v1.into());
    }
    c.bench_function("matches", |b| {
        b.iter(|| black_box(matchmaker.find_matches(f32::NEG_INFINITY, Instant::now())));
    });
}

fn bench_2v2(c: &mut Criterion) {
    let mut matchmaker = Matchmaker::new(16);
    for player in (0..1000).map(|n| Player {
        id: n,
        rating: 1000.0,
    }) {
        matchmaker.insert_player(player, MatchmakingMode::Mode2v2Bgh.into());
    }
    c.bench_function("matches", |b| {
        b.iter(|| black_box(matchmaker.find_matches(f32::NEG_INFINITY, Instant::now())));
    });
}

fn bench_3v3(c: &mut Criterion) {
    let mut matchmaker = Matchmaker::new(16);
    for player in (0..1000).map(|n| Player {
        id: n,
        rating: 1000.0,
    }) {
        matchmaker.insert_player(player, MatchmakingMode::Mode3v3Bgh.into());
    }
    c.bench_function("matches", |b| {
        b.iter(|| black_box(matchmaker.find_matches(f32::NEG_INFINITY, Instant::now())));
    });
}

criterion_group!(benches, bench_1v1, bench_2v2, bench_3v3);
criterion_main!(benches);
