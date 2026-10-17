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
# Matches the app server's `node` user, so both servers can write the `uploaded_files` volume they
# share when SB_FILE_STORE is a local filesystem store.
ENV UID=1000
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
RUN mkdir /uploaded_files

FROM gcr.io/distroless/cc-debian12

# Import from builder.
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

WORKDIR /server
COPY --from=builder /server/target/release/server ./
# Created in the image so a new volume mounted here takes this user as its owner, rather than root
COPY --from=builder --chown=server:server /uploaded_files ./uploaded_files

USER server:server

CMD ["/server/server"]
