// Explicit local tooling only. The release export never downloads a diagram renderer.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const [mode, flag, bundle] = process.argv.slice(2);
if (!["--write", "--check"].includes(mode) || flag !== "--bundle" || !bundle || process.argv.length !== 5)
  throw Error(
    "Usage: node scripts/render-diagrams.mjs --write|--check --bundle /path/to/mermaid/dist/mermaid.esm.min.mjs",
  );
const directory = await fs.realpath(path.dirname(path.resolve(bundle)));
const packageInfo = JSON.parse(await fs.readFile(path.join(directory, "../package.json"), "utf8"));
if (packageInfo.name !== "mermaid" || packageInfo.version !== "11.12.0") throw Error("Require Mermaid 11.12.0");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch();
const results = [];
try {
  for (const name of ["runtime", "lifecycle", "retrieval"]) {
    // Fresh contexts reset renderer counters. Browser requests are fulfilled from the explicit local tool directory.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("http://127.0.0.1:8765/**", async (route) => {
      const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
      if (pathname === "/")
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body></body>" });
      const target = path.resolve(directory, "." + pathname);
      if (!target.startsWith(directory + path.sep)) return route.abort();
      await route.fulfill({ contentType: "application/javascript", body: await fs.readFile(target) });
    });
    await page.goto("http://127.0.0.1:8765/");
    const source = await fs.readFile(path.join(root, `assets/diagrams/${name}.mmd`), "utf8");
    const output = await page.evaluate(
      async ({ source, name, entry }) => {
        const { default: mermaid } = await import("/" + entry);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          deterministicIds: true,
          deterministicIDSeed: "infowarden-" + name,
          fontFamily: "Arial, sans-serif",
        });
        await mermaid.parse(source);
        return (await mermaid.render("infowarden-" + name, source)).svg + "\n";
      },
      { source, name, entry: path.basename(bundle) },
    );
    const target = path.join(root, `assets/diagrams/${name}.svg`);
    if (mode === "--check") {
      if ((await fs.readFile(target, "utf8")) !== output) throw Error(`Stale diagram: ${name}`);
    } else await fs.writeFile(target, output);
    results.push({ name, sha256: createHash("sha256").update(output).digest("hex") });
    await context.close();
  }
  console.log(JSON.stringify({ status: "PASS", mermaid: packageInfo.version, chromium: browser.version(), results }));
} finally {
  await browser.close();
}
