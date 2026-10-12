# Upload Processing

Managed uploads can include a single text-like file or a ZIP archive. The
ingestion pipeline normalizes supported text, records upload metadata, and keeps
the original upload as external source material rather than making the vector
index canonical.

The phrase "zip archive import warning" belongs to upload processing tests.

Stable external document id: `doc_upload_processing`.
