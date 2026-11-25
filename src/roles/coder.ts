// The coder: the only role that changes product code. In the box, with edit tools and the project's check commands.
import { CODER_BASH, MODELS } from "../config.ts";
import { agent, bullets, prompt } from "../core/agent.ts";
import { step } from "../core/shell.ts";
import type { Triage } from "./triage.ts";

// Why the coder is called again, and which prompt it gets:
//   checks    our local gate failed           ci        CI failed on the PR
//   review    tester/security blocking findings   feedback  your reply in the task's thread about its open PR
export type Fix = { from: "checks" | "ci" | "review" | "feedback"; output: string; lastTry?: boolean };

const ROLE: Record<Fix["from"], string> = { checks: "coder-fix", ci: "ci-fix", review: "review-fix", feedback: "pr-feedback" };

// Returns the coder's summary (WHAT / VERIFY), which goes into the PR description.
// lastTry: the final attempt at a fix runs on MODELS.coderLastTry.
export async function code(task: string, t: Triage, fix?: Fix): Promise<string> {
    const role = fix ? ROLE[fix.from] : "coder";
    const acceptance = bullets(t.acceptance);
    const vars: Record<string, string> = !fix ? { acceptance, files: t.files.join(", "), task }
        : fix.from === "ci" ? { ciLog: fix.output, acceptance, task }
        : fix.from === "review" ? { findings: fix.output, acceptance, task }
        : { feedback: fix.output, acceptance, task };
    const out = await agent(role, prompt(role, vars), [
        "--model", fix?.lastTry ? MODELS.coderLastTry : MODELS.coder,
        "--tools", "Read,Edit,Write,Glob,Grep,Bash",
        "--allowedTools", ["Read", "Edit", "Write", "Glob", "Grep", ...CODER_BASH].join(","),
    ]);
    step(role, { cost: out.total_cost_usd, turns: out.num_turns, error: out.is_error });
    return out.result ?? "";
}
