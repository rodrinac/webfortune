FROM rust:1.94-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fortune-mod fortunes fortunes-min ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.0.1 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=build /app/target/release/webfortune /usr/local/bin/webfortune
ENV PATH="/usr/games:${PATH}" \
    MY_APP_HOST=0.0.0.0 \
    MY_APP_PORT=8080 \
    AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/health \
    AWS_LWA_READINESS_CHECK_HEALTHY_STATUS=200
USER 10001:10001
EXPOSE 8080
CMD ["/usr/local/bin/webfortune"]
