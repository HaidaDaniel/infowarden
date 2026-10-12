# Structure Aware Chunking

ContextForge keeps Markdown section boundaries visible for retrieval. The
section marker is markdown-section-boundary-anchor.

## Capability Table

| Capability | Marker |
| --- | --- |
| table preservation | markdown-table-preservation-anchor |
| heading hierarchy | heading-hierarchy-anchor |

## Malformed Fence

Malformed Markdown still remains indexable through deterministic fallback. The
malformed-input-fallback-anchor appears near an intentionally unclosed fence.

```ts
export const brokenFence = true;
