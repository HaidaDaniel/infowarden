# RAG Overview

ContextForge keeps retrieval observable before answer generation. The baseline
pipeline embeds source chunks, searches the active vector collection, applies
metadata filters, expands neighbors when a profile asks for it, and returns a
context package.

The semantic marker "agent usable context package" should be found even when a
question asks about preparing useful material for Hermes or another coding
agent.

Stable external document id: `doc_rag_overview`.
