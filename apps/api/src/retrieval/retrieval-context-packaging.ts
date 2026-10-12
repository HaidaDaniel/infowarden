import type { BudgetDiagnostics, SearchResult } from "./retrieval.types";

export type ContextGroup = {
  title: string;
  kind: "code" | "docs" | "memory" | "ops" | "mixed";
  items: SearchResult[];
};

export function groupResults(results: SearchResult[], grouping: string): ContextGroup[] {
  const groups = new Map<string, SearchResult[]>();

  for (const result of results) {
    const key =
      grouping === "path"
        ? result.path || result.documentId
        : grouping === "document"
          ? result.documentId
          : "results";

    const current = groups.get(key) || [];
    current.push(result);
    groups.set(key, current);
  }

  return Array.from(groups.entries()).map(([title, items]) => ({
    title,
    kind: inferGroupKind(items),
    items,
  }));
}

export function applyTokenBudget(
  groups: ContextGroup[],
  budgetPlan: {
    tokenizer: BudgetDiagnostics["tokenizer"];
    requestedTokens: number;
    reservedTokens: BudgetDiagnostics["reservedTokens"];
    retrievalBudgetTokens: number;
  },
) {
  let remaining = budgetPlan.retrievalBudgetTokens;
  let usedTokens = 0;
  let droppedItems = 0;
  let trimmedItems = 0;
  const packagedGroups: ContextGroup[] = [];

  for (const group of groups) {
    const keptItems: SearchResult[] = [];
    for (const item of group.items) {
      const itemTokens = countTokens(item.text, budgetPlan.tokenizer);
      if (itemTokens > remaining) {
        if (remaining > 0) {
          const trimmed = trimTextToTokenBudget(item.text, remaining, budgetPlan.tokenizer);
          if (trimmed.text.trim()) {
            const lineRange = trimmedLineRange(item, trimmed.text);
            keptItems.push({
              ...item,
              text: trimmed.text,
              endLine: lineRange.endLine,
              tokenCount: trimmed.tokens,
              metadata: {
                ...item.metadata,
                startLine: lineRange.startLine,
                endLine: lineRange.endLine,
                budgetTrimmed: true,
                originalTokenCount: itemTokens,
                originalStartLine: item.startLine,
                originalEndLine: item.endLine,
                trimReason: "retrieval_budget_exhausted",
              },
            });
            usedTokens += trimmed.tokens;
            remaining -= trimmed.tokens;
            trimmedItems += 1;
          } else {
            droppedItems += 1;
          }
        } else {
          droppedItems += 1;
        }
        continue;
      }
      keptItems.push({
        ...item,
        tokenCount: itemTokens,
      });
      usedTokens += itemTokens;
      remaining -= itemTokens;
    }

    if (keptItems.length > 0) {
      packagedGroups.push({
        ...group,
        items: keptItems,
      });
    }
  }

  return {
    groups: packagedGroups,
    diagnostics: {
      tokenizer: budgetPlan.tokenizer,
      requestedTokens: budgetPlan.requestedTokens,
      reservedTokens: budgetPlan.reservedTokens,
      retrievalBudgetTokens: budgetPlan.retrievalBudgetTokens,
      usedTokens,
      droppedItems,
      trimmedItems,
      budgetReason:
        budgetPlan.retrievalBudgetTokens === 0
          ? "reserved_tokens_exhausted_budget"
          : droppedItems || trimmedItems
            ? "retrieval_budget_exhausted"
            : "within_budget",
    },
  };
}

export function countTokens(text: string, _tokenizer?: BudgetDiagnostics["tokenizer"]): number {
  const matches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[A-Za-z0-9_]+|[^\s]/gu);
  if (!matches?.length) {
    return 0;
  }
  return matches.length;
}

function inferGroupKind(items: SearchResult[]): "code" | "docs" | "memory" | "ops" | "mixed" {
  const languages = new Set(
    items.map((item) => item.language).filter(Boolean),
  );
  if (languages.size > 0) {
    return "code";
  }

  if (items.some((item) => String(item.path || "").startsWith("docs/"))) {
    return "docs";
  }

  return "mixed";
}

function trimTextToTokenBudget(
  text: string,
  tokenBudget: number,
  tokenizer: BudgetDiagnostics["tokenizer"],
) {
  if (tokenBudget <= 0) {
    return { text: "", tokens: 0 };
  }
  let end = Math.min(text.length, Math.max(1, tokenBudget * 6));
  let trimmed = text.slice(0, end);
  while (countTokens(trimmed, tokenizer) > tokenBudget && end > 0) {
    end = Math.floor(end * 0.8);
    trimmed = text.slice(0, end);
  }
  const boundary = Math.max(trimmed.lastIndexOf("\n"), trimmed.lastIndexOf(" "));
  if (boundary > 40) {
    trimmed = trimmed.slice(0, boundary);
  }
  const tokens = countTokens(trimmed, tokenizer);
  return { text: trimmed, tokens };
}

function trimmedLineRange(item: SearchResult, trimmedText: string) {
  if (item.startLine === undefined || item.endLine === undefined) {
    return { startLine: item.startLine, endLine: item.endLine };
  }
  const lineCount = Math.max(1, trimmedText.split(/\r\n|\r|\n/u).length);
  return {
    startLine: item.startLine,
    endLine: Math.min(item.endLine, item.startLine + lineCount - 1),
  };
}
