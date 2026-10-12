#!/usr/bin/env node
// Deterministic syntax + contract validation for examples/integrations/*.
//
// Repository-owned parsers (no external dependencies):
//   - parseJSONC: full JSON plus // and /* */ comments and trailing commas.
//   - parseYamlSubset: strict block-style YAML subset (nested mappings,
//     block sequences, plain/single/double-quoted scalars, comments).
//
// The Hermes example is validated against the block-style subset used by
// examples/integrations/hermes-config.yaml, which is upstream-supported
// Hermes configuration syntax.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const READ_TOOLS = ["list_workspaces", "retrieve_context", "read_document", "search_memory"];

const errors = [];

function pass(file, note) {
  console.log(`PASS ${file}${note ? ` — ${note}` : ""}`);
}

function fail(file, message) {
  errors.push(`${file}: ${message}`);
  console.error(`FAIL ${file}: ${message}`);
}

// --- JSONC parser (repository-owned, deterministic) ---

function parseJSONC(source) {
  const errs = [];
  const n = source.length;
  let i = 0;

  function lineAt(index) {
    return source.slice(0, index).split("\n").length;
  }

  function err(message, index = i) {
    errs.push(`line ${lineAt(index)}: ${message}`);
  }

  function ws() {
    for (;;) {
      while (i < n && " \t\r\n".includes(source[i])) i += 1;
      if (i < n && source[i] === "/" && source[i + 1] === "/") {
        while (i < n && source[i] !== "\n") i += 1;
      } else if (i < n && source[i] === "/" && source[i + 1] === "*") {
        const start = i;
        i += 2;
        while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
        if (i >= n) {
          err("unterminated block comment", start);
          i = n;
          return;
        }
        i += 2;
      } else {
        return;
      }
    }
  }

  function parseString() {
    let out = "";
    i += 1;
    while (i < n) {
      const c = source[i];
      if (c === '"') {
        i += 1;
        return out;
      }
      if (c === "\n") {
        err("unterminated string literal");
        i = n;
        return out;
      }
      if (c !== "\\") {
        out += c;
        i += 1;
        continue;
      }
      const e = source[i + 1];
      if (e === '"') out += '"';
      else if (e === "\\") out += "\\";
      else if (e === "/") out += "/";
      else if (e === "b") out += "\b";
      else if (e === "f") out += "\f";
      else if (e === "n") out += "\n";
      else if (e === "r") out += "\r";
      else if (e === "t") out += "\t";
      else if (e === "u") {
        const hex = source.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          err(`invalid \\u escape in string literal`);
          i = n;
          return out;
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
      } else {
        err(`invalid escape '\\${e}' in string literal`);
        i = n;
        return out;
      }
      i += 2;
    }
    err("unterminated string literal");
    return out;
  }

  function parseNumber() {
    const start = i;
    if (source[i] === "-") i += 1;
    while (i < n && /[0-9]/.test(source[i])) i += 1;
    if (i < n && source[i] === ".") {
      i += 1;
      while (i < n && /[0-9]/.test(source[i])) i += 1;
    }
    if (i < n && (source[i] === "e" || source[i] === "E")) {
      i += 1;
      if (i < n && (source[i] === "+" || source[i] === "-")) i += 1;
      while (i < n && /[0-9]/.test(source[i])) i += 1;
    }
    const raw = source.slice(start, i);
    if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(raw)) {
      err(`invalid number '${raw}'`);
    }
    return Number(raw);
  }

  function parseLiteral(name, value) {
    if (source.startsWith(name, i)) {
      i += name.length;
      return value;
    }
    err(`unexpected token, expected '${name}'`);
    i = n;
    return value;
  }

  function parseObject() {
    const obj = {};
    const keys = new Set();
    i += 1;
    ws();
    if (i < n && source[i] === "}") {
      i += 1;
      return obj;
    }
    for (;;) {
      ws();
      if (i >= n) {
        err("unterminated object");
        return obj;
      }
      if (source[i] !== '"') {
        err("object key must be a double-quoted string");
        return obj;
      }
      const key = parseString();
      ws();
      if (source[i] !== ":") {
        err(`expected ':' after key '${key}'`);
        return obj;
      }
      i += 1;
      ws();
      if (keys.has(key)) err(`duplicate object key '${key}'`);
      keys.add(key);
      obj[key] = parseValue();
      ws();
      if (i >= n) {
        err("unterminated object");
        return obj;
      }
      if (source[i] === ",") {
        i += 1;
        ws();
        if (i < n && source[i] === "}") {
          i += 1;
          return obj;
        }
        continue;
      }
      if (source[i] === "}") {
        i += 1;
        return obj;
      }
      err(`expected ',' or '}' in object, got '${source[i]}'`);
      return obj;
    }
  }

  function parseArray() {
    const arr = [];
    i += 1;
    ws();
    if (i < n && source[i] === "]") {
      i += 1;
      return arr;
    }
    for (;;) {
      ws();
      if (i >= n) {
        err("unterminated array");
        return arr;
      }
      arr.push(parseValue());
      ws();
      if (i >= n) {
        err("unterminated array");
        return arr;
      }
      if (source[i] === ",") {
        i += 1;
        ws();
        if (i < n && source[i] === "]") {
          i += 1;
          return arr;
        }
        continue;
      }
      if (source[i] === "]") {
        i += 1;
        return arr;
      }
      err(`expected ',' or ']' in array, got '${source[i]}'`);
      return arr;
    }
  }

  function parseValue() {
    ws();
    if (i >= n) {
      err("unexpected end of input");
      return undefined;
    }
    const c = source[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "-" || /[0-9]/.test(c)) return parseNumber();
    if (source.startsWith("true", i)) return parseLiteral("true", true);
    if (source.startsWith("false", i)) return parseLiteral("false", false);
    if (source.startsWith("null", i)) return parseLiteral("null", null);
    err(`unexpected character '${c}'`);
    i = n;
    return undefined;
  }

  const value = parseValue();
  ws();
  if (i < n) err(`unexpected trailing content at '${source[i]}'`);
  return { value, errors: errs };
}

// --- YAML block-subset parser (repository-owned, deterministic) ---

function stripYamlComment(line) {
  let quote = null;
  for (let k = 0; k < line.length; k += 1) {
    const c = line[k];
    if (quote) {
      if (c === quote) {
        if (quote === "'" && line[k + 1] === "'") {
          k += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && (k === 0 || line[k - 1] === " " || line[k - 1] === "\t")) {
      return line.slice(0, k);
    }
  }
  return line;
}

function parseYamlScalar(token, label, lineNo) {
  if (token === "") return null;
  if (token.startsWith('"')) {
    let out = "";
    for (let k = 1; k < token.length; k += 1) {
      const c = token[k];
      if (c === '"') {
        if (k === token.length - 1) return out;
        throw new Error(`${label} line ${lineNo}: stray '"' inside double-quoted scalar`);
      }
      if (c === "\\") {
        const e = token[k + 1];
        if (e === '"') out += '"';
        else if (e === "\\") out += "\\";
        else if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else throw new Error(`${label} line ${lineNo}: unsupported escape '\\${e}'`);
        k += 1;
      } else {
        out += c;
      }
    }
    throw new Error(`${label} line ${lineNo}: unterminated double-quoted scalar`);
  }
  if (token.startsWith("'")) {
    let out = "";
    for (let k = 1; k < token.length; k += 1) {
      const c = token[k];
      if (c === "'") {
        if (token[k + 1] === "'") {
          out += "'";
          k += 1;
          continue;
        }
        if (k === token.length - 1) return out;
        throw new Error(`${label} line ${lineNo}: stray "'" inside single-quoted scalar`);
      }
      out += c;
    }
    throw new Error(`${label} line ${lineNo}: unterminated single-quoted scalar`);
  }
  if (/^[\s?&*!|>%@`-]/.test(token)) {
    throw new Error(`${label} line ${lineNo}: plain scalar '${token}' uses reserved YAML syntax`);
  }
  if (token.includes(": ") || token.endsWith(":") || token.includes(" #")) {
    throw new Error(`${label} line ${lineNo}: ambiguous plain scalar '${token}' (quote it)`);
  }
  if (token.includes("{") || token.includes("[") || token.includes("}")) {
    throw new Error(`${label} line ${lineNo}: flow-style YAML is not supported by this validator`);
  }
  return token;
}

function parseYamlSubset(source, label) {
  const errs = [];
  const lines = [];
  source.split("\n").forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (raw.includes("\t")) errs.push(`line ${lineNo}: tab characters are not allowed`);
    const stripped = stripYamlComment(raw);
    if (stripped.trim() === "") return;
    const indent = stripped.length - stripped.trimStart().length;
    if (indent % 2 !== 0) errs.push(`line ${lineNo}: odd indentation is not allowed`);
    lines.push({ text: stripped.trim(), indent, lineNo });
  });

  let pos = 0;

  function scalar(token, lineNo) {
    try {
      return { value: parseYamlScalar(token, label, lineNo), error: null };
    } catch (error) {
      errs.push(error.message);
      return { value: undefined, error: error.message };
    }
  }

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    if (lines[pos].text.startsWith("- ") || lines[pos].text === "-") return parseSequence(indent);
    return parseMapping(indent);
  }

  function parseSequence(indent) {
    const arr = [];
    while (
      pos < lines.length &&
      lines[pos].indent === indent &&
      (lines[pos].text.startsWith("- ") || lines[pos].text === "-")
    ) {
      const item = lines[pos].text === "-" ? "" : lines[pos].text.slice(2).trim();
      pos += 1;
      if (item === "") {
        if (pos < lines.length && lines[pos].indent > indent) {
          arr.push(parseBlock(lines[pos].indent));
        } else {
          arr.push(null);
        }
      } else {
        arr.push(scalar(item, lines[pos - 1].lineNo).value);
      }
    }
    return arr;
  }

  function parseMapping(indent) {
    const map = {};
    const seen = new Set();
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith("- ")) {
      const { text, lineNo } = lines[pos];
      const match = text.match(/^((?:[^:]+?)|("(?:[^"\\]|\\.)*")|('(?:[^']|'')*')):(?:\s+(.*))?$/);
      if (!match) {
        errs.push(`line ${lineNo}: expected 'key: value' mapping entry, got '${text}'`);
        pos += 1;
        continue;
      }
      const key = parseYamlScalar(match[1], label, lineNo);
      const rest = match[4];
      pos += 1;
      if (seen.has(key)) errs.push(`line ${lineNo}: duplicate key '${key}'`);
      seen.add(key);
      if (rest === undefined) {
        if (pos < lines.length && lines[pos].indent > indent) {
          map[key] = parseBlock(lines[pos].indent);
        } else {
          map[key] = null;
        }
      } else {
        map[key] = scalar(rest, lineNo).value;
      }
    }
    return map;
  }

  if (lines.length === 0) return { value: {}, errors: errs };
  const value = parseBlock(lines[0].indent);
  if (pos < lines.length) {
    errs.push(`line ${lines[pos].lineNo}: unexpected content '${lines[pos].text}' after document`);
  }
  return { value, errors: errs };
}

// --- Structural helpers ---

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(cond, file, message) {
  if (!cond) fail(file, message);
}

function expectServerEntry(doc, file, name) {
  assert(isPlainObject(doc), file, `top level must be an object`);
  if (!isPlainObject(doc)) return null;
  assert(isPlainObject(doc.mcp), file, `missing "mcp" object`);
  if (!isPlainObject(doc.mcp)) return null;
  assert(isPlainObject(doc.mcp[name]), file, `missing mcp."${name}" server entry`);
  return isPlainObject(doc.mcp[name]) ? doc.mcp[name] : null;
}

function expectNodeCommand(entry, file, key = "command") {
  if (Array.isArray(entry[key])) {
    assert(
      entry[key].length >= 1 && entry[key].every((part) => typeof part === "string"),
      file,
      `${key} must be a non-empty array of strings`,
    );
    assert(entry[key][0] === "node", file, `${key}[0] must be "node"`);
    const target = entry[key][entry[key].length - 1];
    assert(
      typeof target === "string" && target.endsWith("apps/mcp-server/dist/index.js"),
      file,
      `${key} must point at apps/mcp-server/dist/index.js`,
    );
    return;
  }
  assert(typeof entry[key] === "string" && entry[key] === "node", file, `${key} must be "node"`);
}

function checkFile(file, note, fn) {
  const before = errors.length;
  fn();
  if (errors.length === before) pass(file, note);
}

function readRepoFile(file) {
  return readFileSync(join(root, file), "utf8");
}

// --- opencode-stdio.jsonc ---

checkFile("examples/integrations/opencode-stdio.jsonc", "JSONC syntax + stdio read-profile contract", () => {
  const file = "examples/integrations/opencode-stdio.jsonc";
  const { value, errors: parseErrors } = parseJSONC(readRepoFile(file));
  parseErrors.forEach((message) => fail(file, `JSONC parse: ${message}`));
  if (parseErrors.length > 0) return;
  const entry = expectServerEntry(value, file, "contextforge");
  if (!entry) return;
  assert(entry.type === "local", file, 'mcp.contextforge.type must be "local"');
  expectNodeCommand(entry, file);
  assert(entry.enabled === true, file, "mcp.contextforge.enabled must be true");
  assert(isPlainObject(entry.environment), file, "mcp.contextforge.environment must be an object");
  if (!isPlainObject(entry.environment)) return;
  assert(entry.environment.MCP_PROFILE === "read", file, 'environment.MCP_PROFILE must be "read" (safe daily default)');
  assert(
    typeof entry.environment.CONTEXTFORGE_BACKEND_URL === "string" &&
      /^https?:\/\//.test(entry.environment.CONTEXTFORGE_BACKEND_URL),
    file,
    "environment.CONTEXTFORGE_BACKEND_URL must be an http(s) URL",
  );
});

// --- opencode-http.jsonc ---

checkFile("examples/integrations/opencode-http.jsonc", "JSONC syntax + HTTP read-profile contract", () => {
  const file = "examples/integrations/opencode-http.jsonc";
  const { value, errors: parseErrors } = parseJSONC(readRepoFile(file));
  parseErrors.forEach((message) => fail(file, `JSONC parse: ${message}`));
  if (parseErrors.length > 0) return;
  const entry = expectServerEntry(value, file, "contextforge");
  if (!entry) return;
  assert(entry.type === "remote", file, 'mcp.contextforge.type must be "remote"');
  assert(
    typeof entry.url === "string" && /^https?:\/\/\S+\//.test(entry.url),
    file,
    "mcp.contextforge.url must be an http(s) MCP endpoint URL",
  );
  assert(entry.enabled === true, file, "mcp.contextforge.enabled must be true");
  assert(isPlainObject(entry.headers), file, "mcp.contextforge.headers must be an object");
  if (!isPlainObject(entry.headers)) return;
  assert(
    typeof entry.headers.Authorization === "string" && /^Bearer \S/.test(entry.headers.Authorization),
    file,
    "headers.Authorization must be a Bearer credential (MCP auth is separate from backend auth)",
  );
});

// --- hermes-config.yaml ---

checkFile("examples/integrations/hermes-config.yaml", "YAML syntax + Hermes read-profile contract", () => {
  const file = "examples/integrations/hermes-config.yaml";
  const { value, errors: parseErrors } = parseYamlSubset(readRepoFile(file), file);
  parseErrors.forEach((message) => fail(file, `YAML parse: ${message}`));
  if (parseErrors.length > 0) return;
  assert(isPlainObject(value), file, "top level must be a mapping");
  if (!isPlainObject(value)) return;
  assert(isPlainObject(value.mcp_servers), file, 'missing "mcp_servers" mapping');
  if (!isPlainObject(value.mcp_servers)) return;
  const entry = value.mcp_servers.contextforge;
  assert(isPlainObject(entry), file, "missing mcp_servers.contextforge mapping");
  if (!isPlainObject(entry)) return;
  expectNodeCommand(entry, file);
  assert(
    Array.isArray(entry.args) && entry.args.length >= 1 && entry.args.every((a) => typeof a === "string"),
    file,
    "args must be a non-empty list of strings",
  );
  assert(isPlainObject(entry.env), file, "env must be a mapping");
  if (isPlainObject(entry.env)) {
    assert(entry.env.MCP_PROFILE === "read", file, 'env.MCP_PROFILE must be "read" (safe daily default)');
    assert(
      typeof entry.env.CONTEXTFORGE_BACKEND_URL === "string" && /^https?:\/\//.test(entry.env.CONTEXTFORGE_BACKEND_URL),
      file,
      "env.CONTEXTFORGE_BACKEND_URL must be an http(s) URL",
    );
  }
  assert(isPlainObject(entry.tools), file, "tools must be a mapping");
  if (!isPlainObject(entry.tools)) return;
  const include = entry.tools.include;
  assert(Array.isArray(include), file, "tools.include must be a list");
  if (!Array.isArray(include)) return;
  const sorted = [...include].sort();
  const expected = [...READ_TOOLS].sort();
  assert(
    include.length === READ_TOOLS.length &&
      include.every((t) => typeof t === "string") &&
      JSON.stringify(sorted) === JSON.stringify(expected),
    file,
    `tools.include must be exactly the read-profile consumer tools: ${READ_TOOLS.join(", ")}`,
  );
});

// --- Result ---

if (errors.length > 0) {
  console.error(`\nvalidate-integration-configs: ${errors.length} error(s)`);
  process.exit(1);
}
console.log("\nvalidate-integration-configs: all integration config checks passed");
