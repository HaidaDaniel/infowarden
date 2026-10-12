export type RetrievalStage =
  | 'dense'
  | 'lexical'
  | 'merged'
  | 'filtered'
  | 'reranked'
  | 'context_package';

export function buildContextPackage(query: string, stages: RetrievalStage[]) {
  return {
    query,
    stages,
    marker: 'pipeline-stage-order-anchor',
  };
}

export function shouldUseReranker(enabled: boolean, providerReady: boolean) {
  return enabled && providerReady;
}

export function collectNeighborSymbols() {
  return ['buildContextPackage', 'shouldUseReranker', 'neighbor-symbol-anchor'];
}
