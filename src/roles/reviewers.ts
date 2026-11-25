// The reviewers of a change: the tester (writes tests, may keep only test files) and security (reads the diff).
// Both answer with findings; only "blocking" ones go back to the coder.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { CLONE, CODER_BASH, MODELS, TEST_PATH } from "../config.ts";
import { agent, bullets, prompt, type AgentResult } from "../core/agent.ts";
import { git, step } from "../core/shell.ts";
import { uiOnly } from "../workspace/gate.ts";
import type { Triage } from "./triage.ts";

export type Finding = { severity: "blocking" | "nit"; file: string; line: number; issue: string };

const SCHEMA = {
    type: "object",
    properties: { findings: { type: "array", items: { type: "object", properties: {
        severity: { enum: ["blocking", "nit"] }, file: { type: "string" }, line: { type: "integer" }, issue: { type: "string" },
    }, required: ["severity", "file", "line", "issue"], additionalProperties: false } } },
    required: ["findings"], additionalProperties: false,
};

export const formatFindings = (fs: Finding[]): string => fs.map((f) => `- [${f.severity}] ${f.file}:${f.line} ${f.issue}`).join("\n");
export const blocking = (fs: Finding[]): Finding[] => fs.filter((f) => f.severity === "blocking");

function findings(role: string, out: AgentResult): Finding[] {
    const fs = (out.structured_output as { findings: Finding[] } | undefined)?.findings;
    if (!fs) throw new Error(`${role} returned no findings: ${JSON.stringify(out).slice(0, 1000)}`);
    step(role, { cost: out.total_cost_usd, turns: out.num_turns, blocking: blocking(fs).length, nits: fs.length - blocking(fs).length });
    return fs;
}

// The tester may leave only __tests__ files changed: code, not the prompt, enforces that. The coder's change is
// staged first as a snapshot, so whatever else the tester touched is restored from it.
export async function tester(task: string, t: Triage): Promise<Finding[]> {
    git("add", "-A");
    const out = await agent("tester", prompt("tester", { acceptance: bullets(t.acceptance), task }), [
        "--model", MODELS.tester,
        "--tools", "Read,Edit,Write,Glob,Grep,Bash",
        "--allowedTools", ["Read", "Edit", "Write", "Glob", "Grep", ...CODER_BASH].join(","),
        "--json-schema", JSON.stringify(SCHEMA),
    ]);
    const changed = git("diff", "--name-only").split("\n").filter(Boolean);
    const added = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
    const reverted = [...changed, ...added].filter((f) => !TEST_PATH.test(f));
    for (const f of reverted) {
        if (added.includes(f)) rmSync(join(CLONE, f), { force: true });
        else git("checkout", "--", f);
    }
    git("reset", "-q");
    if (reverted.length) step("tester-reverted", { files: reverted });
    return findings("tester", out);
}

// Read-only (git diff and status are its only commands). Opus, unless every changed file is UI.
export async function security(task: string, files: string[]): Promise<Finding[]> {
    const out = await agent("security", prompt("security", { task }), [
        "--model", uiOnly(files) ? MODELS.securityUi : MODELS.security,
        "--tools", "Read,Grep,Glob,Bash",
        "--allowedTools", "Read,Grep,Glob,Bash(git diff *),Bash(git status *)",
        "--json-schema", JSON.stringify(SCHEMA),
    ]);
    return findings("security", out);
}
