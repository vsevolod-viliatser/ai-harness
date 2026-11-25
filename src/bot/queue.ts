// The bot's queue: one run at a time. Each run is `node src/cli.ts …` in a child process; its stage lines go to the
// task's thread as they happen, and its result decides the task's next status.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { HERE, WIP_LIMIT, WORK } from "../config.ts";
import { loadState, saveState, type TaskState } from "../core/state.ts";
import { openHarnessPrs } from "../integrations/github.ts";
import { dmChannel } from "../integrations/slack.ts";
import { taskId } from "../integrations/notion.ts";
import { planPrs } from "../roles/architect.ts";
import { app, ask, say, slackChunks, update } from "./app.ts";

// fresh: you took the task again (button or link), so it starts over from triage, not from an old plan.
export async function enqueue(url: string, title: string, fresh = false): Promise<void> {
    const id = taskId(url);
    const s = loadState();
    const existing = s.tasks[id] && fresh ? { ...s.tasks[id], plan: undefined, phase: undefined, feedback: undefined } : s.tasks[id];
    const channel = await dmChannel(app.client);
    const thread = existing?.thread ?? { channel, ts: (await app.client.chat.postMessage({ channel, text: `Taking: <${url}|${title}>` })).ts! };
    if (existing?.status === "offered") await say({ ...existing, thread }, "Taking it.");
    s.tasks[id] = { ...existing, url, title: title || existing?.title || url, status: "queued", thread, updatedAt: new Date().toISOString() };
    if (!s.queue.includes(id)) s.queue.push(id);
    saveState(s);
    if (s.running || s.queue.length > 1) await say(s.tasks[id], `Queued: #${s.queue.indexOf(id) + 1}.`);
    void pump();
}

// Straight back into the queue from inside a run's report (the pump loop picks it up next, no new message).
function requeue(id: string): void {
    const s = loadState();
    s.tasks[id] = { ...s.tasks[id], status: "queued", updatedAt: new Date().toISOString() };
    if (!s.queue.includes(id)) s.queue.push(id);
    saveState(s);
}

let pumping = false;
export async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
        for (;;) {
            const s = loadState();
            if (s.running || !s.queue.length) return;
            const waiting = openHarnessPrs().length;
            if (waiting >= WIP_LIMIT) {
                await say(s.tasks[s.queue[0]], `${waiting} PRs are waiting for review (limit ${WIP_LIMIT}). I'll start when you merge or close one.`);
                return; // tried again on the next button press, reply, or the half-hourly check
            }
            const id = s.queue.shift()!;
            s.running = id;
            saveState(s);
            await runTask(id);
            const after = loadState();
            after.running = null;
            saveState(after);
        }
    } finally {
        pumping = false;
    }
}

// A crash or a reboot mid-run leaves "running" set: put that task back at the front of the queue.
export function recoverInterruptedRun(): void {
    const s = loadState();
    if (s.running) { s.queue.unshift(s.running); s.running = null; saveState(s); }
}

// Which run a queued task needs: your PR feedback, a PR of its plan, or a fresh start (triage -> quick fix or plan).
async function runTask(id: string): Promise<void> {
    const t = update(id, { status: "running" });
    const dir = join(WORK, "slack");
    mkdirSync(dir, { recursive: true });
    const resultFile = join(dir, `${id}.result.json`);
    rmSync(resultFile, { force: true }); // never report an earlier run's result
    const cli = (...args: string[]) => ["src/cli.ts", ...args, "--result", resultFile];

    if (t.feedback && t.pr) {
        const file = join(dir, `${id}.feedback.md`);
        writeFileSync(file, t.feedback);
        update(id, { feedback: undefined });
        await say(t, "Started: your feedback → code → checks → push to the PR → CI.");
        return report(id, t, resultFile, cli("--revise", t.pr, "--answers", file), true);
    }
    if (t.plan && t.phase) {
        await say(t, `Started phase ${t.phase}: code → checks → tester + security → PR → CI.`);
        return report(id, t, resultFile, cli("--phase", basename(t.plan, ".md"), String(t.phase)));
    }
    await say(t, "Started: triage → a quick fix or a plan.");
    const answers = t.answers?.length ? join(dir, `${id}.answers.md`) : undefined;
    if (answers) writeFileSync(answers, t.answers!.join("\n\n"));
    await report(id, t, resultFile, cli(t.url, ...(answers ? ["--answers", answers] : [])));
}

type RunResult = {
    outcome?: string; verdict?: string; questions?: string[]; reason?: string; log?: string;
    plan?: string; autoStart?: boolean; pr?: string; phase?: number; phases?: number;
};

// revising: a failed revision leaves the PR open as it was, so the task stays "pr" (watched, takes more feedback).
async function report(id: string, t: TaskState, resultFile: string, args: string[], revising = false): Promise<void> {
    // The run's output goes on to the log; its "@@stage" lines also go to the thread, in order.
    let posts = Promise.resolve();
    const code = await new Promise<number>((resolve) => {
        const child = spawn(process.execPath, args, { cwd: HERE, stdio: ["ignore", "pipe", "inherit"] });
        createInterface({ input: child.stdout }).on("line", (line) => {
            console.log(line);
            if (line.startsWith("@@stage ")) posts = posts.then(() => say(t, line.slice(8))).catch(() => {});
        });
        child.on("close", (c) => resolve(c ?? 1));
    });
    await posts;

    let r: RunResult = {};
    try { r = JSON.parse(readFileSync(resultFile, "utf8")); } catch { /* the run crashed before writing it */ }
    const outcome = r.outcome ?? `run exited with ${code}`;
    const logLine = r.log ? `\nLog: ${r.log}` : "";

    if (r.pr) {
        update(id, { status: "pr", pr: r.pr });
        const which = r.phase && r.phases! > 1 ? `Phase ${r.phase}/${r.phases} PR` : "PR";
        const ci = outcome.includes("CI green") ? "CI is green." : `CI: ${outcome.split("\n").pop()?.trim()}`;
        await say(t, `${which} ready: ${r.pr}\n${ci}\nReply here to change it; I'll notice when you merge it.`);
    } else if (r.plan && r.autoStart) {
        // One PR and no migration: nothing to approve that the PR review won't show. The plan is posted for reference.
        for (const text of slackChunks(readFileSync(r.plan, "utf8"))) await say(t, text);
        await say(t, "One PR, no migration: starting it.");
        update(id, { plan: r.plan, phase: 1 });
        requeue(id);
    } else if (r.plan) {
        update(id, { status: "plan", plan: r.plan });
        for (const text of slackChunks(readFileSync(r.plan, "utf8"))) await say(t, text);
        const prs = planPrs(readFileSync(r.plan, "utf8")).length;
        await ask(t, `Plan: ${prs} PRs. File \`${r.plan.replace(`${HERE}/`, "")}\`: you can edit it by hand before Approve. A reply in this thread is feedback, and the architect rewrites the plan.`,
            [{ id: "approve", label: "Approve", style: "primary" }, { id: "reject", label: "Reject", style: "danger" }]);
    } else if (r.verdict === "needs_clarification") {
        update(id, { status: "questions" });
        await say(t, `I need some answers. Reply in this thread and I'll rerun the task:\n${(r.questions ?? []).map((q) => `• ${q}`).join("\n")}`);
    } else if (r.verdict === "needs_human") {
        update(id, { status: "stopped" });
        await say(t, `This one needs you: ${r.reason ?? ""}`);
    } else {
        update(id, { status: revising ? "pr" : "stopped" });
        await say(t, `Stopped: ${outcome}${logLine}`);
    }
}
