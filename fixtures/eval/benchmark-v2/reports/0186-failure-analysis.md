# Benchmark v2 corrected failure analysis

Labels, qrels, and methodology were frozen before execution. Cross-partition path count and unidentified count are both zero.

## EN/dense

- misses at Hit@10: 2
- failed queries: 0
- duplicate raw results: 0
- taxonomy: exact-term miss=0, semantic miss=0, hard-negative confusion=2, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=0, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: hard-negative confusion: mrtydi_en_q_541, mrtydi_en_q_1120

## EN/hybrid

- misses at Hit@10: 2
- failed queries: 0
- duplicate raw results: 0
- taxonomy: exact-term miss=0, semantic miss=0, hard-negative confusion=2, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=0, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: hard-negative confusion: mrtydi_en_q_541, mrtydi_en_q_1120

## EN/hybrid-reranker

- misses at Hit@10: 2
- failed queries: 0
- duplicate raw results: 0
- taxonomy: exact-term miss=0, semantic miss=0, hard-negative confusion=2, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=0, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: hard-negative confusion: mrtydi_en_q_541, mrtydi_en_q_1120

## RU/dense

- misses at Hit@10: 5
- failed queries: 0
- duplicate raw results: 1
- taxonomy: exact-term miss=1, semantic miss=0, hard-negative confusion=4, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=0, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: exact-term miss: mrtydi_ru_q_2652; hard-negative confusion: mrtydi_ru_q_5609, mrtydi_ru_q_6279, mrtydi_ru_q_1074, mrtydi_ru_q_1399

## RU/hybrid

- misses at Hit@10: 5
- failed queries: 0
- duplicate raw results: 1
- taxonomy: exact-term miss=1, semantic miss=0, hard-negative confusion=4, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=0, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: exact-term miss: mrtydi_ru_q_2652; hard-negative confusion: mrtydi_ru_q_5609, mrtydi_ru_q_6279, mrtydi_ru_q_1074, mrtydi_ru_q_1399

## RU/hybrid-reranker

- misses at Hit@10: 5
- failed queries: 0
- duplicate raw results: 1
- taxonomy: exact-term miss=1, semantic miss=0, hard-negative confusion=4, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=0, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: exact-term miss: mrtydi_ru_q_2652; hard-negative confusion: mrtydi_ru_q_5609, mrtydi_ru_q_6279, mrtydi_ru_q_1074, mrtydi_ru_q_1399

## MIXED/dense

- misses at Hit@10: 16
- failed queries: 0
- duplicate raw results: 1
- taxonomy: exact-term miss=1, semantic miss=0, hard-negative confusion=7, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=8, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: exact-term miss: mixed_mrtydi_ru_q_2652; hard-negative confusion: mixed_mrtydi_en_q_1120, mixed_mrtydi_en_q_541, xquad_mixed_distractor_57339c16d058e614000b5ec5, mixed_mrtydi_ru_q_5609, mixed_mrtydi_ru_q_6279; cross-language miss: xquad_cross_language_ru_to_en_571c8539dd7acb1400e4c0e6, xquad_cross_language_en_to_ru_57339c16d058e614000b5ec5, xquad_cross_language_ru_to_en_57339c16d058e614000b5ec5, xquad_cross_language_en_to_ru_5725c604271a42140099d185, xquad_cross_language_en_to_ru_5725c604271a42140099d186

## MIXED/hybrid

- misses at Hit@10: 16
- failed queries: 0
- duplicate raw results: 1
- taxonomy: exact-term miss=1, semantic miss=0, hard-negative confusion=7, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=8, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: exact-term miss: mixed_mrtydi_ru_q_2652; hard-negative confusion: mixed_mrtydi_en_q_1120, mixed_mrtydi_en_q_541, xquad_mixed_distractor_57339c16d058e614000b5ec5, mixed_mrtydi_ru_q_5609, mixed_mrtydi_ru_q_6279; cross-language miss: xquad_cross_language_ru_to_en_571c8539dd7acb1400e4c0e6, xquad_cross_language_en_to_ru_57339c16d058e614000b5ec5, xquad_cross_language_ru_to_en_57339c16d058e614000b5ec5, xquad_cross_language_en_to_ru_5725c604271a42140099d185, xquad_cross_language_en_to_ru_5725c604271a42140099d186

## MIXED/hybrid-reranker

- misses at Hit@10: 16
- failed queries: 0
- duplicate raw results: 1
- taxonomy: exact-term miss=1, semantic miss=0, hard-negative confusion=7, entity/identifier confusion=0, Russian morphology/inflection=0, cross-language miss=8, chunk-boundary issue=0, candidate-generation miss=0, reranker regression=0, duplicate result=0, empty result=0, dataset/qrel ambiguity=0
- representative query IDs: exact-term miss: mixed_mrtydi_ru_q_2652; hard-negative confusion: mixed_mrtydi_en_q_1120, mixed_mrtydi_en_q_541, xquad_mixed_distractor_57339c16d058e614000b5ec5, mixed_mrtydi_ru_q_5609, mixed_mrtydi_ru_q_6279; cross-language miss: xquad_cross_language_ru_to_en_571c8539dd7acb1400e4c0e6, xquad_cross_language_en_to_ru_57339c16d058e614000b5ec5, xquad_cross_language_ru_to_en_57339c16d058e614000b5ec5, xquad_cross_language_en_to_ru_5725c604271a42140099d185, xquad_cross_language_en_to_ru_5725c604271a42140099d186

## Decision

No partition has three supported modes simultaneously at Hit@10 >= 0.98, Hit@3 >= 0.95, and MRR >= 0.95.
