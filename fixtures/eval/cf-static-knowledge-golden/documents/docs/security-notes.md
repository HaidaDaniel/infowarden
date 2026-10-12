# Security Notes

These notes record the authentication and secret-handling model for the
platform.

## Authentication model

A single shared API key authenticates API and operator surfaces. It is not
RBAC and not multi-user authorization. MCP inbound auth is a separate
boundary: enabling it requires its own key, and the MCP adapter forwards the
backend key to the API when backend auth is enabled. Enabling either boundary
requires the admin key to be set to a real value.

## Stdio trust model

A stdio MCP server is a local child process of the agent host. Trust comes
from the host user, the local filesystem, and the process environment. Anyone
who can edit the agent config or the local checkout can control which backend
and profile the server uses. This is why stdio is the local development path
and network exposure always goes through the authenticated HTTP transport.

## Secrets handling

Raw provider keys never enter the database. Provider configuration stores a
key reference; the value is resolved from the environment or secret store at
use time. Keys are rotated by updating the secret store and recreating the
affected services; rotating a key without recreating the service leaves the
old value in memory.

## Network boundary

Data services are never published to a public interface. The reverse proxy
terminates TLS and forwards only intended routes. CORS is restricted to the
Studio origin. A wildcard CORS origin in production is a startup failure, not
a warning.
