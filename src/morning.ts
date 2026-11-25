// Weekday 10:00 (launchd): DM you your Now tasks with "Take" / "Skip" buttons.
// It only reads (Notion, GitHub, state.json) and posts; the buttons are handled by the bot (listener.ts).
import type { KnownBlock } from "@slack/web-api";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MORNING_MAX_TASKS, WIP_LIMIT, WORK } from "./config.ts";
import { loadState } from "./core/state.ts";
import { openHarnessPrs } from "./integrations/github.ts";
import { listTasks, taskId, type NotionTask } from "./integrations/notion.ts";
import { dmChannel, slack } from "./integrations/slack.ts";

// The last list that worked. If Notion or Claude fails this morning (the subscription's usage limit,
// a network blip), you still get yesterday's list, marked as such, instead of no message at all.
const CACHE = join(WORK, "last-tasks.json");
let tasks: NotionTask[];
let stale = "";
try {
    tasks = await listTasks();
    writeFileSync(CACHE, JSON.stringify(tasks, null, 2));
} catch (e) {
    const why = (e as Error).message.match(/"result":"([^"]+)"/)?.[1] ?? (e as Error).message.slice(0, 200);
    tasks = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : [];
    stale = `Could not read Notion (${why}). This is the last list that worked.`;
}

const state = loadState();
// Already handled by the harness (queued, running, has a PR, asked you, you said no): don't offer again.
const offered = tasks.filter((t) => !state.tasks[taskId(t.url)]).slice(0, MORNING_MAX_TASKS);
const prs = openHarnessPrs();

const blocks: KnownBlock[] = [{ type: "header", text: { type: "plain_text", text: "Today's tasks" } }];
if (stale) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `⚠️ ${stale}` }] });
if (prs.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text:
        `Waiting for your review (${prs.length}${prs.length >= WIP_LIMIT ? `, limit ${WIP_LIMIT}: new tasks will queue` : ""}):\n` +
        prs.map((p) => `• <${p.url}|#${p.number} ${p.title}>`).join("\n") } });
}
for (const t of offered) {
    blocks.push(
        { type: "section", text: { type: "mrkdwn", text: `*<${t.url}|${t.title}>*\n${t.priority}${t.type ? ` · ${t.type}` : ""}` } },
        { type: "actions", elements: [
            { type: "button", action_id: "take", style: "primary", text: { type: "plain_text", text: "Take" }, value: t.url },
            { type: "button", action_id: "skip", text: { type: "plain_text", text: "Skip" }, value: t.url },
        ] },
    );
}
if (!offered.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: "No new tasks for the harness." } });

const client = slack();
await client.chat.postMessage({ channel: await dmChannel(client), text: "Today's tasks", blocks });
console.log(`morning: offered ${offered.length} tasks, ${prs.length} PRs waiting`);
