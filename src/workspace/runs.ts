// What a later step needs to know about a task's branch (the task text, its triage, its limits), kept outside
// the clone in work/runs/<slug>.json: the plan's PRs, CI fixes and your PR feedback all start from it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK } from "../config.ts";
import type { Triage } from "../roles/triage.ts";
import type { Limits } from "./gate.ts";

export type RunState = { branch: string; taskUrl: string; task: string; triage: Triage; limits?: Limits };

const runFile = (branch: string) => join(WORK, "runs", `${branch.replace(/^agent\//, "")}.json`);

export function saveRun(r: RunState): void {
    mkdirSync(join(WORK, "runs"), { recursive: true });
    writeFileSync(runFile(r.branch), JSON.stringify(r, null, 2));
}

export function loadRun(branch: string): RunState {
    if (!existsSync(runFile(branch))) throw new Error(`no saved run for ${branch} (only branches the harness made can be continued)`);
    return JSON.parse(readFileSync(runFile(branch), "utf8"));
}
