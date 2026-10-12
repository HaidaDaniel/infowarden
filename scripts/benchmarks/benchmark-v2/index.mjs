import path from "node:path";
import { validateV21Split } from "./v21-split.mjs";
import { validateV21Harness } from "./v21-matrix.mjs";
import { runV21Dev } from "./v21-dev.mjs";
import { runV21Holdout } from "./v21-holdout.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const mode = args.shift();
const root = process.cwd();
if (mode === "--validate" && args.length === 0) {
  await validateV21Split(root);
  await validateV21Harness(root);
} else if (
  ["--dev", "--holdout"].includes(mode) &&
  args.length === 4 &&
  args[0] === "--api-url" &&
  args[2] === "--out"
) {
  const output = path.resolve(args[3]);
  if (output === root || output.startsWith(root + path.sep))
    throw new Error("benchmark output must be outside frozen repository evidence");
  await (mode === "--dev" ? runV21Dev : runV21Holdout)(root, { apiUrl: args[1], output });
} else {
  throw new Error("usage: --validate | --dev|--holdout --api-url <URL> --out <external-directory>");
}
