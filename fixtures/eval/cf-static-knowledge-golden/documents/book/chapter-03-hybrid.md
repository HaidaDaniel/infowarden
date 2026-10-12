# Chapter 3: Hybrid Ranking

Hybrid ranking combines lexical and dense candidates into one ordered list.
The combination in this system is weighted rank fusion, not weighted
similarity: each channel produces an ordered candidate list, each candidate
receives a rank score of `1 / (rank + 1)`, and the two channels are fused as
`denseScore * denseWeight + lexicalScore * lexicalWeight`.

Using rank scores instead of raw similarity scores is deliberate. Raw
similarity values are not comparable across channels: a cosine similarity of
0.81 and a `ts_rank_cd` value of 0.12 live on different scales, and
weighting raw values would make the weights meaningless. Rank scores put both
channels on the same 0-to-1 scale, so a 0.6/0.4 weighting genuinely means
"dense matters 1.5x more than lexical."

A chunk that appears in both channels accumulates both components, which is
what makes hybrid robust: an exact-term hit that is also semantically
relevant outranks a purely semantic guess. A chunk that appears in only one
channel still competes, weighted by that channel alone.

The practical consequence is that hybrid is not "better than both." It is
better than each on the questions where the two channels agree, and it can
amplify a confident-but-wrong candidate from either channel on the questions
where they disagree. That is why hybrid must be evaluated, not assumed.

The default hybrid weighting in the evaluation profile is dense 0.6 and
lexical 0.4, with a lexical candidate limit of 5 before fusion.
