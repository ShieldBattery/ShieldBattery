FROM tailscale/tailscale:latest

COPY tailscale_setup.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
