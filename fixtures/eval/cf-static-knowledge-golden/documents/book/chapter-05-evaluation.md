# Chapter 5: Evaluating Retrieval

Retrieval evaluation answers one question per query: did the expected
document appear in the ranked results, and at what position? The standard
metrics are computed per question and then averaged.

Hit@K is 1 when any expected document appears within the top K results,
otherwise 0. Hit@3 is the same test with K fixed at 3. MRR, the mean
reciprocal rank, is the average of `1 / (rank + 1)` for the first expected
hit, which rewards systems that put the right document first rather than
merely somewhere in the list.

Two rates complete the picture. The empty-result rate is the fraction of
questions that returned zero candidates; a high empty rate is a coverage or
provider problem, not a ranking problem. The duplicate rate is the fraction
of top-K results that repeat a chunk already seen; a rising duplicate rate
points at chunk boundaries or overlap, not at the ranking model.

A critical discipline is label integrity: expected documents must come from
a reviewed fixture, never from the system's own output. Scoring a system
against labels it produced is circular and produces confident, meaningless
numbers. Baselines must fix the environment class, the topK, and the
profile, and a regression is a change in metric against that fixed baseline,
not a change against an unspecified "usual" level.

Latency is part of the evaluation contract. p50 and p95 per question are
recorded alongside quality metrics because a retrieval system that is 10
points better at Hit@3 but 4x slower is a different system, not the same one
with a better score.
