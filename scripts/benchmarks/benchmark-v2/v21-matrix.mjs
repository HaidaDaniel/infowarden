import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { V21_SPLIT_PATH, validateV21Split } from "./v21-split.mjs";

const MATRIX_PATH = path.join("fixtures", "eval", "benchmark-v2", "metadata", "v2.1-matrix.json");
const CONFIGURATIONS_PATH = path.join("fixtures", "eval", "benchmark-v2", "metadata", "v2.1-configurations.json");
const EXPECTED_CONFIGURATION_IDS = [
  "dense",
  "dense-reranker",
  "lexical-pg-fts",
  "lexical-structured",
  "lexical-bm25",
  "lexical-bm25f",
  "lexical-lstar",
  "lexical-lstar-reranker",
  "fusion-legacy",
  "fusion-rrf",
  "fusion-dbsf",
  "fusion-selected",
  "fusion-selected-reranker",
];
const EXPECTED_PARAMETER_GRIDS = {
  bm25: { k1: [0.9, 1.2, 1.5], b: [0.5, 0.75, 0.9] },
  bm25fFieldWeights: [
    { id: "balanced", weights: { chunkText: 1, pathTitle: 1.5, identifierMetadata: 2 } },
    { id: "text-first", weights: { chunkText: 2, pathTitle: 1, identifierMetadata: 1 } },
    { id: "identifier-first", weights: { chunkText: 1, pathTitle: 2, identifierMetadata: 3 } },
  ],
  rrf: { k: [20, 60, 100], candidateDepth: [25, 50], weights: "equal" },
};
const EXPECTED_STAGES = [
  {
    id: "lexical-leg-selection",
    split: "DEV",
    purpose: "select L* from independent no-model lexical baselines",
    configurationIds: ["lexical-pg-fts", "lexical-structured", "lexical-bm25", "lexical-bm25f"],
  },
  {
    id: "controlled-fusion",
    split: "DEV_THEN_HOLDOUT",
    purpose: "compare fusion strategies with the same DEV-selected lexical leg",
    lexicalLeg: "L_STAR_FROM_DEV",
    configurationIds: ["fusion-legacy", "fusion-rrf", "fusion-dbsf"],
  },
  {
    id: "reranker-isolation",
    split: "DEV_THEN_HOLDOUT",
    purpose: "measure reranker contribution with candidate and fusion inputs held constant",
    pairedConfigurationIds: [
      ["dense", "dense-reranker"],
      ["lexical-lstar", "lexical-lstar-reranker"],
      ["fusion-selected", "fusion-selected-reranker"],
    ],
  },
];
const EXPECTED_SELECTION_RULES = {
  lexicalLeg:
    "quality, Hit@10/candidate-recall, p50 latency, resource cost, and operational complexity; eligible candidates must be within 0.02 of best Hit@10 and candidate recall, then highest MRR wins; differences below 0.02 MRR use lower latency/cost",
  parameters: "select only from the frozen grids in v2.1-configurations.json on DEV",
  holdout: "no tuning or winner changes; use selected configuration hashes unchanged",
};
const EXPECTED_CONFIGURATION_FIELDS = {
  dense: { stage: "baseline", profileKey: "dense", candidateStrategy: "dense", reranker: false },
  "dense-reranker": {
    stage: "reranker-pair",
    profileKey: "dense-reranker",
    candidateStrategy: "dense",
    reranker: true,
  },
  "lexical-pg-fts": {
    stage: "lexical-leg-selection",
    profileKey: "lexical-pg-fts",
    candidateStrategy: "lexical",
    lexicalStrategy: "pg-fts",
    reranker: false,
  },
  "lexical-structured": {
    stage: "lexical-leg-selection",
    profileKey: "lexical-structured",
    candidateStrategy: "lexical",
    lexicalStrategy: "structured",
    reranker: false,
  },
  "lexical-bm25": {
    stage: "lexical-leg-selection",
    profileKey: "lexical-bm25",
    candidateStrategy: "lexical",
    lexicalStrategy: "bm25",
    parameterGridRef: "bm25",
    reranker: false,
  },
  "lexical-bm25f": {
    stage: "lexical-leg-selection",
    profileKey: "lexical-bm25f",
    candidateStrategy: "lexical",
    lexicalStrategy: "bm25f",
    parameterGridRef: "bm25fFieldWeights",
    reranker: false,
  },
  "lexical-lstar": {
    stage: "reranker-pair",
    profileKey: "L_STAR_FROM_DEV",
    candidateStrategy: "lexical",
    lexicalStrategy: "L_STAR_FROM_DEV",
    reranker: false,
  },
  "lexical-lstar-reranker": {
    stage: "reranker-pair",
    profileKey: "L_STAR_FROM_DEV-reranker",
    candidateStrategy: "lexical",
    lexicalStrategy: "L_STAR_FROM_DEV",
    reranker: true,
  },
  "fusion-legacy": {
    stage: "controlled-fusion",
    profileKey: "hybrid-legacy",
    candidateStrategy: "hybrid",
    lexicalStrategy: "L_STAR_FROM_DEV",
    fusionStrategy: "legacy-weighted-rank",
    reranker: false,
  },
  "fusion-rrf": {
    stage: "controlled-fusion",
    profileKey: "hybrid-rrf",
    candidateStrategy: "hybrid",
    lexicalStrategy: "L_STAR_FROM_DEV",
    fusionStrategy: "rrf",
    parameterGridRef: "rrf",
    reranker: false,
  },
  "fusion-dbsf": {
    stage: "controlled-fusion",
    profileKey: "hybrid-dbsf",
    candidateStrategy: "hybrid",
    lexicalStrategy: "L_STAR_FROM_DEV",
    fusionStrategy: "dbsf",
    reranker: false,
  },
  "fusion-selected": {
    stage: "reranker-pair",
    profileKey: "SELECTED_FUSION_FROM_DEV",
    candidateStrategy: "hybrid",
    lexicalStrategy: "L_STAR_FROM_DEV",
    fusionStrategy: "SELECTED_FUSION_FROM_DEV",
    reranker: false,
  },
  "fusion-selected-reranker": {
    stage: "reranker-pair",
    profileKey: "SELECTED_FUSION_FROM_DEV-reranker",
    candidateStrategy: "hybrid",
    lexicalStrategy: "L_STAR_FROM_DEV",
    fusionStrategy: "SELECTED_FUSION_FROM_DEV",
    reranker: true,
  },
};

export async function validateV21Harness(repoRoot) {
  const split = await validateV21Split(repoRoot);
  const matrix = await readJson(repoRoot, MATRIX_PATH);
  const configurations = await readJson(repoRoot, CONFIGURATIONS_PATH);

  if (matrix.formatVersion !== "infowarden-benchmark-v21-matrix.v1") {
    throw new Error("unsupported v2.1 matrix format");
  }
  if (configurations.formatVersion !== "infowarden-benchmark-v21-configurations.v1") {
    throw new Error("unsupported v2.1 configuration format");
  }
  if (matrix.qualityRun !== false || configurations.qualityRun !== false) {
    throw new Error("v2.1 harness metadata must be pre-quality and qualityRun=false");
  }
  if (matrix.splitPath !== V21_SPLIT_PATH || matrix.splitChecksumSha256 !== split.splitChecksumSha256) {
    throw new Error("v2.1 matrix does not bind to the immutable split manifest");
  }
  if (matrix.matrixChecksumSha256 !== checksumWithout(matrix, ["matrixChecksumSha256"])) {
    throw new Error("v2.1 matrix checksum mismatch");
  }
  if (
    configurations.splitChecksumSha256 !== split.splitChecksumSha256 ||
    configurations.matrixChecksumSha256 !== matrix.matrixChecksumSha256 ||
    configurations.configurationChecksumSha256 !==
      checksumWithout(configurations, ["splitChecksumSha256", "matrixChecksumSha256", "configurationChecksumSha256"])
  ) {
    throw new Error("v2.1 configuration metadata is not bound to the frozen matrix and split");
  }
  if (matrix.repetitions?.dev !== 1 || matrix.repetitions?.holdout !== 3) {
    throw new Error("v2.1 repetition protocol mismatch");
  }
  if (JSON.stringify(matrix.stages) !== JSON.stringify(EXPECTED_STAGES)) {
    throw new Error("v2.1 stage contract changed from the frozen methodology");
  }
  if (JSON.stringify(matrix.selectionRules) !== JSON.stringify(EXPECTED_SELECTION_RULES)) {
    throw new Error("v2.1 selection rules changed from the frozen methodology");
  }

  if (JSON.stringify(configurations.parameterGrids) !== JSON.stringify(EXPECTED_PARAMETER_GRIDS)) {
    throw new Error("v2.1 parameter grids changed from the frozen methodology");
  }

  const configurationById = new Map();
  for (const configuration of configurations.configurations || []) {
    if (!configuration?.id || configurationById.has(configuration.id)) {
      throw new Error(`duplicate or missing v2.1 configuration id: ${configuration?.id || "unknown"}`);
    }
    if (typeof configuration.profileKey !== "string" || typeof configuration.candidateStrategy !== "string") {
      throw new Error(`incomplete v2.1 configuration: ${configuration.id}`);
    }
    if (typeof configuration.reranker !== "boolean") {
      throw new Error(`reranker flag missing from v2.1 configuration: ${configuration.id}`);
    }
    configurationById.set(configuration.id, configuration);
  }
  if (JSON.stringify([...configurationById.keys()]) !== JSON.stringify(EXPECTED_CONFIGURATION_IDS)) {
    throw new Error("v2.1 configuration IDs changed from the frozen matrix");
  }
  for (const id of EXPECTED_CONFIGURATION_IDS) {
    const actual = configurationById.get(id);
    const expected = EXPECTED_CONFIGURATION_FIELDS[id];
    if (JSON.stringify(actual) !== JSON.stringify({ id, ...expected })) {
      throw new Error(`v2.1 configuration content changed: ${id}`);
    }
  }
  const requiredGridRefs = new Map([
    ["lexical-bm25", "bm25"],
    ["lexical-bm25f", "bm25fFieldWeights"],
    ["fusion-rrf", "rrf"],
  ]);
  for (const [id, gridRef] of requiredGridRefs) {
    if (configurationById.get(id)?.parameterGridRef !== gridRef) {
      throw new Error(`v2.1 configuration ${id} is missing frozen grid reference ${gridRef}`);
    }
  }

  for (const stage of matrix.stages || []) {
    const ids = [...(stage.configurationIds || []), ...(stage.pairedConfigurationIds || []).flat()];
    for (const id of ids) {
      if (!configurationById.has(id)) throw new Error(`matrix references unknown configuration: ${id}`);
    }
  }
  const lexicalStage = matrix.stages?.find((stage) => stage.id === "lexical-leg-selection");
  if (
    !lexicalStage ||
    lexicalStage.split !== "DEV" ||
    JSON.stringify(lexicalStage.configurationIds) !==
      JSON.stringify(["lexical-pg-fts", "lexical-structured", "lexical-bm25", "lexical-bm25f"])
  ) {
    throw new Error("v2.1 lexical-leg DEV stage is missing or underspecified");
  }
  const fusionStage = matrix.stages?.find((stage) => stage.id === "controlled-fusion");
  if (
    !fusionStage ||
    fusionStage.lexicalLeg !== "L_STAR_FROM_DEV" ||
    JSON.stringify(fusionStage.configurationIds) !== JSON.stringify(["fusion-legacy", "fusion-rrf", "fusion-dbsf"])
  ) {
    throw new Error("v2.1 controlled fusion stage is not isolated on L*");
  }
  const rerankerStage = matrix.stages?.find((stage) => stage.id === "reranker-isolation");
  if (
    !rerankerStage ||
    JSON.stringify(rerankerStage.pairedConfigurationIds) !==
      JSON.stringify([
        ["dense", "dense-reranker"],
        ["lexical-lstar", "lexical-lstar-reranker"],
        ["fusion-selected", "fusion-selected-reranker"],
      ])
  ) {
    throw new Error("v2.1 reranker isolation stage is missing required pairs");
  }
  if (
    configurations.parameterGrids?.rrf?.weights !== "equal" ||
    !Array.isArray(configurations.parameterGrids?.rrf?.k) ||
    !Array.isArray(configurations.parameterGrids?.bm25fFieldWeights)
  ) {
    throw new Error("v2.1 parameter grids are not frozen");
  }

  return {
    split,
    matrix,
    configurations,
    configurationCount: configurationById.size,
  };
}

function checksumWithout(value, fields) {
  const copy = { ...value };
  for (const field of fields) delete copy[field];
  return crypto
    .createHash("sha256")
    .update(`${JSON.stringify(copy, null, 2)}\n`)
    .digest("hex");
}

async function readJson(repoRoot, relativePath) {
  const filePath = path.resolve(repoRoot, relativePath);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid v2.1 harness metadata ${relativePath}: ${error.message}`);
  }
}
