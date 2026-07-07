// arkive.config — pure YAML root file (§3 of the data model spec).
//
// Unlike every other file in the arkive, arkive.config has NO frontmatter.
// The entire file is YAML. Reader + writer keep that shape exact and emit
// a stable key order so manual edits round-trip cleanly.

import { storage, currentUserId } from "@/lib/storage";
import { PATH_CONFIG } from "./paths";
import { AUTHORED_PRACTICES } from "./authored";
import {
  ARKIVE_CORE_VERSION,
  DEFAULT_ARKIVE_DEFAULTS,
  type ArkiveConfigFile,
} from "./schemas";

/**
 * Default config for a brand-new arkive. Every packaged ("authored") practice
 * is installed active. Core doesn't name any specific practice here — it asks
 * the authored-practice registry which practices ship pre-installed. Today
 * that's just trading; adding another packaged practice needs no change here.
 */
export function defaultArkiveConfig(): ArkiveConfigFile {
  const practices: ArkiveConfigFile["practices"] = {};
  for (const p of AUTHORED_PRACTICES) {
    practices[p.name] = { enabled: true, mode: "active", version: p.version };
  }
  return {
    version: ARKIVE_CORE_VERSION,
    identity_ref: "identity.md",
    protocol_ref: "arkive.protocol.md",
    practices,
    defaults: { ...DEFAULT_ARKIVE_DEFAULTS },
  };
}

/** Serialize the config to canonical YAML. */
export function serializeArkiveConfig(cfg: ArkiveConfigFile): string {
  const lines: string[] = [];
  lines.push(`version: ${cfg.version}`);
  lines.push(`identity_ref: ${cfg.identity_ref}`);
  lines.push(`protocol_ref: ${cfg.protocol_ref}`);
  lines.push("");
  lines.push("practices:");
  for (const [name, reg] of Object.entries(cfg.practices)) {
    lines.push(`  ${name}:`);
    lines.push(`    enabled: ${reg.enabled}`);
    lines.push(`    mode: ${reg.mode}`);
    lines.push(`    version: ${reg.version}`);
  }
  lines.push("");
  lines.push("defaults:");
  lines.push(`  weekly_recap: ${cfg.defaults.weekly_recap}`);
  lines.push(`  monthly_retrospective: ${cfg.defaults.monthly_retrospective}`);
  lines.push(`  insight_evidence_threshold: ${cfg.defaults.insight_evidence_threshold}`);
  lines.push(`  rejection_cooldown_threshold: ${cfg.defaults.rejection_cooldown_threshold}`);
  lines.push(`  conversation_timeout_min: ${cfg.defaults.conversation_timeout_min}`);
  lines.push(`  recent_window_days: ${cfg.defaults.recent_window_days}`);
  lines.push(`  recent_max_entries: ${cfg.defaults.recent_max_entries}`);
  lines.push(`  daydream_frequency: ${cfg.defaults.daydream_frequency}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Parse the YAML body. Tolerant — missing fields fall back to defaults so
 * the runtime never blows up on a partial file.
 */
export function parseArkiveConfig(yaml: string): ArkiveConfigFile {
  const cfg = defaultArkiveConfig();
  const lines = yaml.split(/\r?\n/);
  let section: "root" | "practices" | "defaults" = "root";
  let currentPractice: string | null = null;

  for (const raw of lines) {
    if (!raw || raw.trim().startsWith("#")) continue;
    const noIndent = raw.trimStart();
    const indent = raw.length - noIndent.length;

    if (indent === 0) {
      if (noIndent.startsWith("practices:")) {
        section = "practices";
        currentPractice = null;
        continue;
      }
      if (noIndent.startsWith("defaults:")) {
        section = "defaults";
        currentPractice = null;
        continue;
      }
      const m = noIndent.match(/^([A-Za-z_]+):\s*(.+)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (k === "version") cfg.version = v.trim();
      else if (k === "identity_ref") cfg.identity_ref = v.trim();
      else if (k === "protocol_ref") cfg.protocol_ref = v.trim();
      section = "root";
      continue;
    }

    if (section === "practices") {
      if (indent === 2) {
        const m = noIndent.match(/^([A-Za-z0-9_-]+):\s*$/);
        if (m) {
          currentPractice = m[1];
          cfg.practices[currentPractice] = {
            enabled: false,
            mode: "active",
            version: "0.0.0",
          };
        }
      } else if (indent >= 4 && currentPractice) {
        const m = noIndent.match(/^([A-Za-z_]+):\s*(.+)$/);
        if (!m) continue;
        const [, k, v] = m;
        const value = v.trim();
        const reg = cfg.practices[currentPractice];
        if (k === "enabled") reg.enabled = value === "true";
        else if (k === "mode") reg.mode = value as ArkiveConfigFile["practices"][string]["mode"];
        else if (k === "version") reg.version = value;
      }
    } else if (section === "defaults") {
      const m = noIndent.match(/^([A-Za-z_]+):\s*(.+)$/);
      if (!m) continue;
      const [, k, v] = m;
      const value = v.trim();
      switch (k) {
        case "weekly_recap": cfg.defaults.weekly_recap = value === "true"; break;
        case "monthly_retrospective": cfg.defaults.monthly_retrospective = value === "true"; break;
        case "insight_evidence_threshold": cfg.defaults.insight_evidence_threshold = Number(value) || 0; break;
        case "rejection_cooldown_threshold": cfg.defaults.rejection_cooldown_threshold = Number(value) || 0; break;
        case "conversation_timeout_min": cfg.defaults.conversation_timeout_min = Number(value) || 0; break;
        case "recent_window_days": cfg.defaults.recent_window_days = Number(value) || 0; break;
        case "recent_max_entries": cfg.defaults.recent_max_entries = Number(value) || 0; break;
        case "daydream_frequency":
          cfg.defaults.daydream_frequency =
            value === "daily" || value === "frequent" ? value : "off";
          break;
      }
    }
  }

  return cfg;
}

/** Load the user's arkive.config (or seed defaults if missing). */
export async function readArkiveConfig(): Promise<ArkiveConfigFile> {
  const uid = await currentUserId();
  const entry = await storage().readEntry(uid, PATH_CONFIG);
  if (!entry) return defaultArkiveConfig();
  return parseArkiveConfig(entry.body);
}

/** Write the config back to disk. */
export async function writeArkiveConfig(cfg: ArkiveConfigFile): Promise<void> {
  const uid = await currentUserId();
  await storage().writeEntry(uid, {
    path: PATH_CONFIG,
    body: serializeArkiveConfig(cfg),
    // No frontmatter — arkive.config is pure YAML per §3.
    meta: {},
  });
}
