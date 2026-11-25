// The Slack bot. Always running (launchd KeepAlive), it listens only to you.
//
//   buttons      Take / Skip (morning list), Approve / Reject (a plan), Phase N (after a merge)
//   DM           "tasks" re-sends the list; a Notion task link takes that task; any other text is a new task,
//                offered back to you with a Take button (the bot asks in the thread if something is unclear)
//   thread reply answers its questions, gives feedback on its plan, or changes its open PR
//
// The queue and the runs are in bot/queue.ts, merge watching in bot/merges.ts.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, WORK } from "./config.ts";
import { loadState } from "./core/state.ts";
import { notionUrl, taskId } from "./integrations/notion.ts";
import { app, ask, ME, say, update } from "./bot/app.ts";
import { watchMerges } from "./bot/merges.ts";
import { enqueue, pump, recoverInterruptedRun } from "./bot/queue.ts";

const taskOf = (action: unknown) => loadState().tasks[taskId((action as { value: string }).value)];
const busy = (status?: string) => status === "queued" || status === "running";

// ---------- buttons ----------

app.action("take", async ({ ack, body, action }) => {
    await ack();
    if (body.user.id !== ME) return;
    const url = (action as { value: string }).value;
    if (busy(loadState().tasks[taskId(url)]?.status)) return; // a double click
    const title = JSON.stringify(body).match(new RegExp(`<${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|([^>]+)>`))?.[1]
        ?? loadState().tasks[taskId(url)]?.title ?? url;
    await enqueue(url, title, true);
});

app.action("skip", async ({ ack, body, action }) => {
    await ack();
    if (body.user.id !== ME) return;
    const url = (action as { value: string }).value;
    update(taskId(url), { url, title: url, status: "skipped" });
    await app.client.chat.postEphemeral({ channel: (body as { channel?: { id: string } }).channel!.id, user: ME, text: "OK, I won't offer it again." });
});

app.action("approve", async ({ ack, body, action }) => {
    await ack();
    const t = taskOf(action);
    if (body.user.id !== ME || t?.status !== "plan") return; // already decided, or being re-planned
    update(taskId(t.url), { phase: 1 });
    await say(t, "Plan approved, starting phase 1.");
    await enqueue(t.url, t.title);
});

app.action("reject", async ({ ack, body, action }) => {
    await ack();
    const t = taskOf(action);
    if (body.user.id !== ME || t?.status !== "plan") return;
    update(taskId(t.url), { status: "stopped" });
    await say(t, "OK, plan rejected. I won't do this task.");
});

app.action("next_phase", async ({ ack, body, action }) => {
    await ack();
    const t = taskOf(action);
    if (body.user.id !== ME || t?.status !== "next" || !t.phase) return; // a double click
    update(taskId(t.url), { phase: t.phase + 1 });
    await enqueue(t.url, t.title);
});

// ---------- messages ----------

const NOTION_LINK = /https:\/\/(?:www\.|app\.)?notion\.(?:so|com)\/[^\s>|]+/;

app.message(async ({ message }) => {
    const m = message as { user?: string; text?: string; ts: string; channel: string; thread_ts?: string; channel_type?: string };
    if (m.user !== ME || m.channel_type !== "im" || !m.text) return;

    // Outside a thread: a task link, or a request for the list.
    if (!m.thread_ts) {
        const link = m.text.match(NOTION_LINK)?.[0];
        if (link) {
            const url = notionUrl(link); // the page, not the database view around it
            if (!busy(loadState().tasks[taskId(url)]?.status)) await enqueue(url, url, true);
        } else if (/^\s*(tasks|list|задачи|список)\s*$/i.test(m.text)) {
            spawn(process.execPath, ["src/morning.ts"], { cwd: HERE, stdio: "inherit" });
        } else {
            await offerWrittenTask(m.text, { channel: m.channel, ts: m.ts });
        }
        return;
    }

    // In a task's thread: the reply goes into that task's next run.
    const entry = Object.entries(loadState().tasks).find(([, t]) => t.thread?.ts === m.thread_ts);
    if (!entry) return;
    const [id, t] = entry;
    if (t.status === "offered") {
        update(id, { answers: [...(t.answers ?? []), m.text] }); // more detail before you press Take
        await say(t, "Added to the task.");
        return;
    }
    if (t.status === "questions" || t.status === "plan") {
        update(id, { answers: [...(t.answers ?? []), m.text] });
    } else if (t.status === "pr" && t.pr) {
        update(id, { feedback: [t.feedback, m.text].filter(Boolean).join("\n\n") });
        await say(t, "Got it, I'll apply that to the PR.");
    } else {
        return; // running, queued, done or stopped: nothing to feed the reply into
    }
    await enqueue(t.url, t.title);
});

// A task you wrote in the DM: saved as work/tasks/slack-<ts>.md (the run reads it like a Notion task) and offered
// back in its own thread with Take / Ignore, so a stray message never starts a run on its own.
async function offerWrittenTask(text: string, thread: { channel: string; ts: string }): Promise<void> {
    const dir = join(WORK, "tasks");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `slack-${thread.ts.replace(".", "-")}.md`);
    const title = text.split("\n")[0].replace(/[<>*_`]/g, "").slice(0, 80);
    writeFileSync(file, `# ${title}\n\n${text}\n`);
    const t = update(taskId(file), { url: file, title, status: "offered", thread });
    await ask(t, "A new task? I'll ask here if anything is unclear.", [{ id: "take", label: "Take", style: "primary" }, { id: "skip", label: "Ignore" }]);
}

// ---------- start ----------

recoverInterruptedRun();
await app.start();
console.log(`listener: connected to Slack as the harness bot, listening for ${ME}`);
void pump();
void watchMerges();
setInterval(() => void watchMerges().catch((e) => console.error("watchMerges", e)), 5 * 60 * 1000);
// A queue held back by the PR limit moves again once you merge or close a PR.
setInterval(() => void pump(), 30 * 60 * 1000);
