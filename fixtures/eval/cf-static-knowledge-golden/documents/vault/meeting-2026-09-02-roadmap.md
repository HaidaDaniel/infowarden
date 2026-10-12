# Roadmap Meeting — 2026-09-02

Notes from the platform roadmap review. Decisions that bind are in the
decision log; this note records the discussion context.

## Static knowledge first

The group agreed the public story leads with stable, warm, persistent
knowledge: documentation folders, reference archives, and notes. Active
repository coding productivity is a separate experiment and must not be
implied by retrieval support. Retrieval hitting a file in a repository is
source-type support, not a claim that the agent fixed the code.

## What is in and out

In for the current release: lexical/dense/hybrid retrieval with evaluation,
source revisions and refresh, durable memory, MCP consumer profiles, and the
bounded single-call answer path. Out: LLM-assisted indexing artifacts,
recursive answer orchestration, and any code-native parser, all pending
evidence that a concrete observed failure justifies them.

## Evidence bar

Any feature that changes retrieval quality must cite an observed failure from
the evaluation pack. A hypothetical gap is not enough. The evaluation pack
itself must be sanitized and committed; private questions and paths stay out
of the repository.

## Naming

The working name for the consumer-facing tool surface stays intention
oriented: retrieve context, read a document, search memory. Internal profile
keys are not part of the public vocabulary.
