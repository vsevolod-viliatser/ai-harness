// A new task: Notion -> triage -> either a quick fix (straight to a PR) or the architect's plan.
import { readFileSync } from "node:fs";
import { ESCALATE_PATHS, QUICK } from "../config.ts";
import { publish } from "../integrations/github.ts";
import { fetchTask } from "../integrations/notion.ts";
import { loadPhase, plan } from "../roles/architect.ts";
import { code } from "../roles/coder.ts";
import { blocking, formatFindings, security, type Finding } from "../roles/reviewers.ts";
import { triage, type Triage } from "../roles/triage.ts";
import { syncClone } from "../workspace/clone.ts";
import { uiOnly, type Limits } from "../workspace/gate.ts";
import { fixCi } from "./ci.ts";
import { checkAndFix } from "./fix-loop.ts";
import { result, stage } from "./progress.ts";

// answers: your replies in the thread so far (to triage's questions, or feedback on a plan).
export async function newTask(taskUrl: string, opts: { answers?: string; triageOnly?: boolean } = {}): Promise<string> {
    // 1. Read the task (Notion, or a local file when testing).
    let task = taskUrl.startsWith("http") ? await fetchTask(taskUrl) : readFileSync(taskUrl, "utf8");
    if (opts.answers) task += `\n\n## Answers and feedback from the developer\n${opts.answers}`;

    // 2. Fresh clone of main for the agents.
    syncClone();

    // 3. Triage: can it be done from what is written, or does it need you?
    stage("Triage: reading the task and the code…");
    const t = await triage(task);
    Object.assign(result, { verdict: t.verdict, questions: t.questions, reason: t.reason });
    if (t.verdict !== "go" || opts.triageOnly) {
        if (t.questions.length) console.log(`\nQuestions for you:\n${t.questions.map((q) => `- ${q}`).join("\n")}`);
        return `triage: ${t.verdict}`;
    }

    // 4a. A quick fix needs no plan.
    const isQuick = t.est_lines <= QUICK.lines && t.files.length <= QUICK.files && !t.files.some((f) => ESCALATE_PATHS.some((p) => p.test(f)));
    if (isQuick) {
        const done = await quickFix(taskUrl, task, t);
        if (done) return done;
        syncClone(); // bigger than it looked: drop the attempt and plan it
        stage("Bigger than triage thought: the architect is planning it instead…");
    } else {
        stage(`Triage: ~${t.est_lines} lines in ${t.files.length} files. The architect is planning the PRs…`);
    }

    // 4b. Everything else gets a plan: one PR for a small task, a series for a big one. flows/phase.ts builds them.
    result.plan = await plan(taskUrl, task, t);
    const first = loadPhase(t.branch_slug, 1);
    result.autoStart = first.total === 1 && !first.migration;
    return `plan: ${result.plan} (${first.total} PR${first.total > 1 ? "s" : ""})`;
}

// code -> checks -> security (unless UI-only) -> draft PR -> CI. Returns the outcome, or null when the change
// came out bigger than QUICK.maxDiff or touched the schema (the caller plans it instead).
async function quickFix(taskUrl: string, task: string, t: Triage): Promise<string | null> {
    stage(`Triage: ~${t.est_lines} lines in ${t.files.length} files, a quick fix. Coding…`);
    const limits: Limits = { maxLines: QUICK.maxDiff };
    let gate = await checkAndFix(task, t, await code(task, t), limits);
    if ("stop" in gate) return /changed lines|schema\/deps/.test(gate.stop) ? null : gate.stop;

    // Security only where it can find something: one fix round for what it blocks, the rest goes in the PR.
    let open: Finding[] = [];
    if (!uiOnly(gate.diff.files)) {
        stage("Security is reading the diff…");
        open = blocking(await security(task, gate.diff.files));
        if (open.length) {
            stage(`${open.length} blocking:\n${formatFindings(open)}\nThe coder is fixing them…`);
            const summary = await code(task, t, { from: "review", output: formatFindings(open), lastTry: true }) || gate.summary;
            const fixed = await checkAndFix(task, t, summary, limits);
            if ("stop" in fixed) return fixed.stop;
            gate = fixed;
            open = blocking(await security(task, gate.diff.files));
        }
    }

    const body = open.length ? `## ⚠️ Still blocking after the security fix: needs you\n${formatFindings(open)}` : undefined;
    const url = publish(taskUrl, task, t, gate.summary, gate.diff, { body, limits });
    result.pr = url;
    stage(`Draft PR opened: ${url}`);
    return `pr: ${url}\n   ${await fixCi(`agent/${t.branch_slug}`)}`;
}
