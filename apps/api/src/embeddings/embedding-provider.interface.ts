export interface EmbeddingProvider {
  getType(): string;
  getModel(): string;
  getDimension(): number;
  embedTexts(texts: string[]): Promise<number[][]>;
}
