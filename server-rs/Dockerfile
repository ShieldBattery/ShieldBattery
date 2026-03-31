# NOTE(tec27): The version of debian used to build should match the version we deploy on (below)
FROM rust:slim-bookworm AS chef
RUN cargo install cargo-chef

FROM chef AS planner
WORKDIR /server
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
RUN update-ca-certificates

ENV USER=server
ENV UID=10001
RUN adduser \
  --disabled-password \
  --gecos "" \
  --home "/nonexistent" \
  --shell "/sbin/nologin" \
  --no-create-home \
  --uid "${UID}" \
  "${USER}"

WORKDIR /server

# Build dependencies - this is the caching Docker layer!
COPY --from=planner /server/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo chef cook --release --recipe-path recipe.json

# Build application
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked --bin server

FROM busybox:stable AS tools

FROM gcr.io/distroless/cc-debian12

# Import from builder.
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

# Import wget from busybox (statically linked) for health checks
COPY --from=tools /bin/busybox /usr/local/bin/busybox

WORKDIR /server
COPY --from=builder /server/target/release/server ./

USER server:server

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=5 CMD ["/usr/local/bin/busybox", "wget", "-q", "-O", "/dev/null", "http://localhost:5529/healthcheck"]
CMD ["/server/server"]
