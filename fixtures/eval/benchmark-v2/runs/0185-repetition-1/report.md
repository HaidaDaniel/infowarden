# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

Runtime evidence: `e1a01e33d6e7c8d65cb9530ce890887b2233d3d8`, local Qwen
0.6B providers, embedding dimension 1024, Node `v24.21.0`. Host provenance:
Linux `x64`, kernel `6.8.0-142-generic`, 4 CPUs, AMD Ryzen 3 3200G with
Radeon Vega Graphics, 8,201,256,960 bytes of host memory. Each of the 9 partition/mode
 runs recorded 10 deterministic warm-up query requests, excluded from latency;
90 warm-up requests were issued for this repetition. Full sanitized per-query
records are in `per-query.jsonl` (1560 JSONL records; SHA-256 `979ba30fa5815041c2aee562f4d35c74a0f9d81aeeb213d7bac1a64ba9a53eb6`; no source text or credentials).
Provider-call provenance: repetition 1 includes 205 one-time cold provider/index setup calls (2405 total); repetitions 2 and 3 reuse the warm cache (2200 total).

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense-only | 0.7083 | 0.8417 | 0.9417 | 0.9417 | 0.7906 | 0.8279 | 38.246458000000075 | 79.5850640000001 |
| EN | hybrid | 0.6750 | 0.8250 | 0.9417 | 0.9417 | 0.7703 | 0.8126 | 572.5390919999991 | 661.3516490000038 |
| EN | hybrid + reranker | 0.7250 | 0.8667 | 0.9083 | 0.9333 | 0.7988 | 0.8319 | 799.393401999987 | 978.1481669999921 |
| RU | dense-only | 0.5833 | 0.7500 | 0.8667 | 0.8667 | 0.6826 | 0.7282 | 32.94276700000046 | 42.75207700001192 |
| RU | hybrid | 0.5833 | 0.7417 | 0.8667 | 0.8667 | 0.6815 | 0.7272 | 248.21037899999646 | 322.91529600002104 |
| RU | hybrid + reranker | 0.6250 | 0.7917 | 0.8667 | 0.8667 | 0.7197 | 0.7566 | 511.7948430000106 | 773.0676630000235 |
| MIXED | dense-only | 0.5679 | 0.7893 | 0.8679 | 0.8750 | 0.6869 | 0.7339 | 32.795068000035826 | 42.631686999986414 |
| MIXED | hybrid | 0.5500 | 0.7786 | 0.8679 | 0.8750 | 0.6760 | 0.7257 | 380.30045899999095 | 664.2050529999542 |
| MIXED | hybrid + reranker | 0.5964 | 0.8179 | 0.8750 | 0.8786 | 0.7136 | 0.7553 | 669.374730999989 | 949.1866259999806 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
