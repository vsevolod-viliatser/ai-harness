// The gate every change passes before it is pushed: code, not a model, decides.
//   guard()   the diff stays inside its limits (size, forbidden paths, schema)
//   checks()  the project's checks plus a per-file lint ratchet, run in the box (docker/checks.sh)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BOX, CLONE, ESCALATE_PATHS, FORBIDDEN_PATHS, HARD_MAX_LINES, NOT_UI, UI_ONLY } from "../config.ts";
import { run, step, type RunResult } from "../core/shell.ts";
import type { Triage } from "../roles/triage.ts";
import type { DiffStat } from "./clone.ts";

// How big a change may get. A plan's PR gets PHASE_MAX_LINES and, if the plan says so, its migration;
// without limits a change is held to HARD_MAX_LINES and no schema.
export type Limits = { maxLines?: number; allowSchema?: boolean };

// Returns why the change must stop, or null if it stays within its limits.
export function guard(t: Triage, d: DiffStat, limits: Limits = {}): string | null {
    const maxLines = limits.maxLines ?? HARD_MAX_LINES;
    const forbidden = d.files.filter((f) => FORBIDDEN_PATHS.some((p) => p.test(f)));
    if (forbidden.length) return `touched forbidden paths: ${forbidden.join(", ")}`;
    const escalate = d.files.filter((f) => ESCALATE_PATHS.some((p) => p.test(f)));
    if (escalate.length && !limits.allowSchema) return `touched ${escalate.join(", ")} (schema/deps): needs a plan with a migration PR`;
    if (d.lines > maxLines) return `${d.lines} changed lines > ${maxLines}`;
    // Twice the estimate, with room for the tester's tests on a small change.
    if (d.lines > Math.max(2 * t.est_lines, t.est_lines + 150)) return `${d.lines} changed lines vs the estimate of ${t.est_lines}: needs a (smaller) plan`;
    return null;
}

export function checks(changed: string[]): RunResult {
    const lintable = changed.filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(join(CLONE, f)));
    const r = run(BOX, ["harness-checks", ...lintable]);
    const out = r.out.slice(-6000);
    step("checks", { ok: r.code === 0, tail: out.slice(-1500) });
    return { ...r, out };
}

// A diff where every file is UI: no routes, queries or migrations.
export const uiOnly = (files: string[]): boolean => files.length > 0 && files.every((f) => UI_ONLY.test(f) && !NOT_UI.test(f));
