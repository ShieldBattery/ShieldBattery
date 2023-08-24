FROM rust:latest AS builder

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
COPY ./ .
RUN cargo build --release --bin server

FROM gcr.io/distroless/cc

# Import from builder.
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

WORKDIR /server
COPY --from=builder /server/target/release/server ./

USER server:server
CMD ["/server/server"]
