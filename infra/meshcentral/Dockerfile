# Tee24 remote-support server (MeshCentral, Apache-2.0) for Fly.io.
# The upstream entrypoint copies config.json.template into the data volume on
# first boot only, so our config wins and later edits in the UI persist.
FROM ghcr.io/ylianst/meshcentral:latest
COPY config.json /opt/meshcentral/config.json.template
ENV DYNAMIC_CONFIG=false \
    CONFIG_FILE=/opt/meshcentral/meshcentral-data/config.json
