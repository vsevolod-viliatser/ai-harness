// The architect: plans a task as a series of PRs (one, for a small task). Read-only, in the box.
// The plan is Markdown on purpose: it is the one source of truth, you can edit plans/<slug>.md before Approve,
// and each PR is built from its "## PR <n>:" section, read back by loadPhase().
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HARD_MAX_LINES, MODELS, PLANS, SMALL_TASK } from "../config.ts";
import { agent, prompt } from "../core/agent.ts";
import { step } from "../core/shell.ts";
import { saveRun } from "../workspace/runs.ts";
import type { Triage } from "./triage.ts";

// Writes plans/<slug>.md and saves the task for the PRs that follow. Returns the plan's path.
export async function plan(taskUrl: string, task: string, t: Triage): Promise<string> {
    const small = t.est_lines <= SMALL_TASK.lines && t.files.length <= SMALL_TASK.files;
    const out = await agent("architect", prompt("architect", {
        task, reason: t.reason, files: t.files.join(", "), maxLines: String(HARD_MAX_LINES),
        forbidden: ".github/, .claude/, .husky/, scripts/, Dockerfile, .env* (see FORBIDDEN_PATHS)",
    }), [
        "--model", small ? MODELS.architectSmall : MODELS.architect,
        "--tools", "Read,Grep,Glob",
        "--allowedTools", "Read,Grep,Glob",
    ]);
    const md = out.result?.trim() ?? "";
    const prs = planPrs(md).length;
    step("architect", { cost: out.total_cost_usd, turns: out.num_turns, prs });
    if (out.is_error || !prs) throw new Error(`architect returned no plan: ${md.slice(0, 500)}`);
    mkdirSync(PLANS, { recursive: true });
    const file = join(PLANS, `${t.branch_slug}.md`);
    writeFileSync(file, `${md}\n`);
    saveRun({ branch: `agent/${t.branch_slug}`, taskUrl, task, triage: t });
    return file;
}

// The "## PR <n>: <title>" headings of a plan, in order.
export const planPrs = (md: string): string[] => [...md.matchAll(/^## PR \d+:\s*(.+)$/gm)].map((m) => m[1].trim());

// One PR of the plan, read into the same shape triage gives, so the coder, the gate and publish work on it unchanged.
export type Phase = { n: number; total: number; planTitle: string; title: string; section: string; migration: boolean; triage: Triage };

export function loadPhase(slug: string, n: number): Phase {
    const md = readFileSync(join(PLANS, `${slug}.md`), "utf8");
    const section = md.split(/^(?=## )/m).find((s) => s.startsWith(`## PR ${n}:`));
    if (!section) throw new Error(`plans/${slug}.md has no "## PR ${n}:" section`);
    const field = (name: string) => section.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1] ?? "";
    const files = [...field("Files").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const doneWhen = section.split(/^Done when:\s*$/m)[1]?.split(/^Tests:/m)[0] ?? "";
    return {
        n,
        total: planPrs(md).length,
        planTitle: md.match(/^#\s+(.+)$/m)?.[1].trim() ?? slug,
        title: section.match(/^## PR \d+:\s*(.+)$/m)![1].trim(),
        section: section.trim(),
        migration: !/^no\b/i.test(field("Migration").trim()),
        triage: {
            verdict: "go", files, reason: `PR ${n} of the approved plan`, questions: [], branch_slug: `${slug}-pr${n}`,
            est_lines: [...field("Estimate").matchAll(/\d+/g)].reduce((sum, m) => sum + Number(m[0]), 0),
            acceptance: [...doneWhen.matchAll(/^- (.+)$/gm)].map((m) => m[1].trim()),
        },
    };
}

// The whole plan, as the coder of PR <n> sees it.
export const planText = (slug: string): string => readFileSync(join(PLANS, `${slug}.md`), "utf8");
