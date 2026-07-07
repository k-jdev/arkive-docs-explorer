// YAML frontmatter codec — read/write the `---\n...\n---\n` block at the top of
// every markdown file. We don't need a full YAML implementation; entries we
// emit have flat keys + arrays of primitives + a few nested objects. The
// serializer in seeds.ts already covers our write needs; this file adds a
// matching parser so reads are symmetric.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export type ParsedEntry<M = Record<string, unknown>> = {
  meta: M;
  body: string;
};

/**
 * Split an arkive entry's stored text into { meta, body }. If the text has no
 * frontmatter block, returns meta = {} and the full text as body.
 */
export function parseFrontmatter<M = Record<string, unknown>>(text: string): ParsedEntry<M> {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { meta: {} as M, body: text };
  return { meta: parseYaml(m[1]) as M, body: m[2] };
}

/** Compose `---\n<yaml>\n---\n<body>`. */
export function serializeEntry(meta: Record<string, unknown>, body: string): string {
  const head = serializeYaml(meta);
  // Always end frontmatter with a newline before body.
  return `---\n${head}---\n${body.startsWith("\n") ? body : "\n" + body}`;
}

// ============================================================================
// Minimal YAML parser/serializer — handles what arkive entries actually use:
//   - flat string/number/boolean values
//   - lists of strings (`- item`)
//   - lists of inline objects (`- { k: v }`)
//   - nested objects (two-space indent)
//
// Anything more complex round-trips through JSON inside a string literal.
// ============================================================================

function parseYaml(src: string): Record<string, unknown> {
  const lines = src.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const parsed = parseLine(lines, i, 0);
    if (parsed) {
      root[parsed.key] = parsed.value;
      i = parsed.next;
    } else {
      i++;
    }
  }
  return root;
}

function parseLine(
  lines: string[],
  start: number,
  baseIndent: number
): { key: string; value: unknown; next: number } | null {
  const line = lines[start];
  if (!line || !line.trim()) return null;
  const indent = line.match(/^(\s*)/)![1].length;
  if (indent !== baseIndent) return null;
  const trimmed = line.slice(indent);
  if (trimmed.startsWith("#") || trimmed.startsWith("- ")) return null;

  const colon = trimmed.indexOf(":");
  if (colon < 0) return null;
  const key = trimmed.slice(0, colon).trim();
  const rawValue = trimmed.slice(colon + 1).trim();

  // Inline value
  if (rawValue) return { key, value: parseScalar(rawValue), next: start + 1 };

  // Block continuation — list or nested object
  let i = start + 1;
  const childIndent = baseIndent + 2;
  // Peek next non-blank line
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return { key, value: null, next: i };
  const firstChild = lines[i];
  const firstIndent = firstChild.match(/^(\s*)/)![1].length;
  if (firstIndent < childIndent) return { key, value: null, next: i };

  // List
  if (firstChild.slice(firstIndent).startsWith("- ")) {
    const items: unknown[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") {
        i++;
        continue;
      }
      const ind = l.match(/^(\s*)/)![1].length;
      if (ind < childIndent) break;
      const tr = l.slice(ind);
      if (!tr.startsWith("- ")) break;
      const itemBody = tr.slice(2).trim();
      if (itemBody.includes(":")) {
        // Inline object: collect subsequent indented lines as an object
        const obj: Record<string, unknown> = {};
        const firstColon = itemBody.indexOf(":");
        const itemKey = itemBody.slice(0, firstColon).trim();
        const itemRaw = itemBody.slice(firstColon + 1).trim();
        if (itemRaw) obj[itemKey] = parseScalar(itemRaw);
        i++;
        // Continue absorbing indented child keys belonging to this list item
        while (i < lines.length) {
          const l2 = lines[i];
          if (l2.trim() === "") {
            i++;
            continue;
          }
          const ind2 = l2.match(/^(\s*)/)![1].length;
          if (ind2 <= childIndent) break;
          const tr2 = l2.slice(ind2);
          const col2 = tr2.indexOf(":");
          if (col2 < 0) break;
          obj[tr2.slice(0, col2).trim()] = parseScalar(tr2.slice(col2 + 1).trim());
          i++;
        }
        items.push(obj);
      } else {
        items.push(parseScalar(itemBody));
        i++;
      }
    }
    return { key, value: items, next: i };
  }

  // Nested object
  const obj: Record<string, unknown> = {};
  while (i < lines.length) {
    const sub = parseLine(lines, i, childIndent);
    if (!sub) {
      const l = lines[i];
      if (l && l.trim() && (l.match(/^(\s*)/)![1].length ?? 0) < childIndent) break;
      i++;
      continue;
    }
    obj[sub.key] = sub.value;
    i = sub.next;
  }
  return { key, value: obj, next: i };
}

function parseScalar(s: string): unknown {
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    // Inline flow list of primitives
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => parseScalar(x.trim()));
  }
  return s;
}

export function serializeYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    lines.push(...serializeKV(k, v, 0));
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

function serializeKV(key: string, value: unknown, indent: number): string[] {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return [`${pad}${key}: null`];
  if (typeof value === "string") return [`${pad}${key}: ${quoteIfNeeded(value)}`];
  if (typeof value === "number" || typeof value === "boolean") return [`${pad}${key}: ${value}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`];
    const out: string[] = [`${pad}${key}:`];
    for (const v of value) {
      if (v === null || v === undefined) {
        out.push(`${pad}  - null`);
      } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out.push(`${pad}  - ${typeof v === "string" ? quoteIfNeeded(v) : v}`);
      } else if (Array.isArray(v)) {
        out.push(`${pad}  - ${JSON.stringify(v)}`);
      } else if (typeof v === "object") {
        const entries = Object.entries(v as Record<string, unknown>);
        if (entries.length === 0) {
          out.push(`${pad}  - {}`);
        } else {
          out.push(`${pad}  - ${entries[0][0]}: ${formatInlineScalar(entries[0][1])}`);
          for (const [ek, ev] of entries.slice(1)) {
            out.push(`${pad}    ${ek}: ${formatInlineScalar(ev)}`);
          }
        }
      }
    }
    return out;
  }
  if (typeof value === "object") {
    const out: string[] = [`${pad}${key}:`];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(...serializeKV(k, v, indent + 1));
    }
    return out;
  }
  return [`${pad}${key}: ${String(value)}`];
}

function formatInlineScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return quoteIfNeeded(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function quoteIfNeeded(s: string): string {
  // Quote when string could be ambiguous (contains special chars, looks like a
  // number/bool, starts with a sigil, or has leading/trailing whitespace).
  if (
    s === "" ||
    s.match(/[:{}\[\],&*#?|\-<>=!%@`]/) ||
    s.match(/^(true|false|null|~|\d)/i) ||
    s.match(/^\s|\s$/)
  ) {
    return JSON.stringify(s);
  }
  return s;
}
