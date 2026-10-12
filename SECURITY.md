# Security

Do not include credentials, private documents, or exploit details in public
issues. Use GitHub private vulnerability reporting if enabled; otherwise ask
for a private reporting channel without disclosing sensitive details.

Deploy behind TLS with narrow CORS, an API key, private PostgreSQL/Redis/Qdrant
services, persistent storage, secrets injection, and tested backups. Shared API
key authentication is not RBAC. External sources are read-only inputs; source
rights and credentials remain the operator's responsibility.
