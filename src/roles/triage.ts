// Triage: can the task be done from what is written plus the code, or does it need you? Read-only, in the box.
import { MODELS } from "../config.ts";
import { agent, prompt } from "../core/agent.ts";
import { step } from "../core/shell.ts";

export type Triage = {
    verdict: "go" | "needs_clarification" | "needs_human";
    files: string[];
    est_lines: number;
    reason: string;
    acceptance: string[];
    questions: string[];
    branch_slug: string;
};

// --json-schema makes the agent answer in exactly this shape, so code can read `verdict` reliably.
const SCHEMA = {
    type: "object",
    properties: {
        verdict: { enum: ["go", "needs_clarification", "needs_human"] },
        files: { type: "array", items: { type: "string" } },
        est_lines: { type: "integer" },
        reason: { type: "string" },
        acceptance: { type: "array", items: { type: "string" } },
        questions: { type: "array", items: { type: "string" } },
        branch_slug: { type: "string", pattern: "^[a-z0-9-]{3,40}$" },
    },
    required: ["verdict", "files", "est_lines", "reason", "acceptance", "questions", "branch_slug"],
    additionalProperties: false,
};

export async function triage(task: string): Promise<Triage> {
    const out = await agent("triage", prompt("triage", { task }), [
        "--model", MODELS.triage,
        "--tools", "Read,Grep,Glob",
        "--allowedTools", "Read,Grep,Glob",
        "--json-schema", JSON.stringify(SCHEMA),
    ]);
    const t = out.structured_output as Triage | undefined;
    if (!t) throw new Error(`triage returned no structured output: ${JSON.stringify(out).slice(0, 1000)}`);
    step("triage", { cost: out.total_cost_usd, turns: out.num_turns, ...t });
    return t;
}
