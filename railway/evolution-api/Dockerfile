FROM atendai/evolution-api:v2.2.2

# Expose Evolution API default port
EXPOSE 8080


# Configure platform-assigned port ($PORT on Railway) and execute the official v2.2.2 entrypoint script
ENTRYPOINT ["/bin/bash", "-c", "export SERVER_PORT=${PORT:-${SERVER_PORT:-8080}} && . ./Docker/scripts/deploy_database.sh && npm run start:prod"]
