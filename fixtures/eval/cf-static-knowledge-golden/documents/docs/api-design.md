# API Design Notes

These notes record the REST conventions used by the Meridian platform API.

## Conventions

Endpoints are resource-oriented and versioned by path only when a breaking
change is unavoidable. List endpoints paginate with `limit` and `offset`; the
maximum `limit` is 100 and the default is 20. Every list response carries
`total` so clients can compute the last page without an extra round trip.

## Error shape

Errors use a stable envelope: `{"error": {"code", "message"}}`. The `code`
field is a stable machine-readable token such as `unauthorized`,
`not_found`, or `stale_revision`; the `message` field is human-readable and
may change without notice. Clients must branch on `code`, never on
`message` text.

## Identifier resolution

Workspace and knowledge-base surfaces accept either the UUID `id` or the
`slug`. When both are supplied and disagree, the request is rejected with
`invalid_identifier`. Slugs are lowercase, hyphenated, and immutable after
creation; renaming a workspace requires a new slug and an explicit migration.

## Idempotency

Mutating operations that enqueue work accept an `idempotencyKey`. Replaying a
request with the same key returns the original job instead of enqueuing a
duplicate. Idempotency keys are scoped per operation type and retained for
72 hours.

## Authentication

The shared API key is sent as `Authorization: Bearer <key>` or
`X-Api-Key: <key>`. The key authenticates the caller; it does not encode
per-user roles. Public health endpoints are the only unauthenticated
surfaces.
