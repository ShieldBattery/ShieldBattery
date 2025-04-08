use std::{
    future::Future,
    panic::{catch_unwind, resume_unwind, AssertUnwindSafe},
    pin::Pin,
    task::{Context, Poll},
    thread,
};

use tokio::sync::oneshot;

/// Spawns a task on the Rayon thread pool in LIFO order, producing a future that can be polled on
/// a Tokio task safely. Use this for CPU-bound computations that don't run forever. The Rayon task
/// thread will have a Tokio runtime available to it if it needs to spawn other Tokio tasks.
pub fn spawn_rayon<F, R>(func: F) -> RayonFuture<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    let rt = tokio::runtime::Handle::current();
    let (tx, rx) = tokio::sync::oneshot::channel();
    rayon::spawn(move || {
        let _guard = rt.enter();
        let _ = tx.send(catch_unwind(AssertUnwindSafe(func)));
    });

    RayonFuture(rx)
}

#[must_use]
#[derive(Debug)]
pub struct RayonFuture<T>(oneshot::Receiver<thread::Result<T>>);

impl<T> Future for RayonFuture<T> {
    type Output = T;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let rx = Pin::new(&mut self.0);
        rx.poll(cx).map(|result| {
            result
                .expect("Tokio channel closed while waiting for Rayon task")
                .unwrap_or_else(|err| resume_unwind(err))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rayon::ThreadPoolBuilder;
    use std::sync::Once;

    static INIT: Once = Once::new();
    pub fn init() {
        INIT.call_once(|| {
            ThreadPoolBuilder::new()
                .num_threads(1)
                .build_global()
                .unwrap();
        });
    }

    #[tokio::test]
    async fn test_spawn_rayon() {
        init();
        let result = spawn_rayon(|| {
            assert_eq!(rayon::current_thread_index(), Some(0));
            4
        })
        .await;

        assert_eq!(result, 4);
        assert_eq!(rayon::current_thread_index(), None);
    }

    #[tokio::test]
    #[should_panic(expected = "woo the task failed!")]
    async fn spawn_rayon_panic() {
        init();
        let handle = spawn_rayon(|| {
            panic!("woo the task failed!");
        });

        handle.await;
    }

    #[tokio::test]
    #[should_panic(expected = "woo the task failed!")]
    async fn poll_panic() {
        init();
        let panic_err = catch_unwind(|| {
            panic!("woo the task failed!");
        })
        .unwrap_err();

        let (tx, rx) = oneshot::channel::<thread::Result<()>>();
        let future = RayonFuture(rx);
        tx.send(Err(panic_err)).unwrap();
        future.await;
    }

    #[tokio::test]
    #[should_panic(expected = "Tokio channel closed while waiting for Rayon task")]
    async fn poll_closed_channel() {
        init();
        let (tx, rx) = oneshot::channel::<thread::Result<()>>();
        let future = RayonFuture(rx);
        drop(tx);
        future.await;
    }
}
