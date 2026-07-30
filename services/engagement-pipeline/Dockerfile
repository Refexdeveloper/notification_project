FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl jq ca-certificates postgresql-client python3 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL -o /usr/local/bin/cloud-sql-proxy \
    https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.linux.amd64 \
    && chmod +x /usr/local/bin/cloud-sql-proxy

WORKDIR /app
COPY ops/runbooks/ ./ops/runbooks/
COPY templates/ ./templates/
COPY db/ ./db/

RUN chmod +x ./ops/runbooks/*.sh

COPY entrypoint.py ./entrypoint.py

ENTRYPOINT ["python3", "./entrypoint.py"]
