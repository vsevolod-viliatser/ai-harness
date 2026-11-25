// The Slack app and the two things every part of the bot does: talk in a task's thread, update its state.
import bolt from "@slack/bolt";
import { appToken, botToken, me } from "../integrations/slack.ts";
import { loadState, saveState, type TaskState } from "../core/state.ts";

// Socket Mode: an outbound WebSocket to Slack, so the Mac needs no public URL.
export const app = new bolt.App({ token: botToken(), appToken: appToken(), socketMode: true });
// You: the only person whose clicks and messages count.
export const ME = me();

// Every task talks in its own thread, started by the "Taking" message.
export async function say(t: TaskState, text: string): Promise<void> {
    await app.client.chat.postMessage({ channel: t.thread!.channel, thread_ts: t.thread!.ts, text });
}

// A thread message with one row of buttons; each button's value is the task's URL.
export async function ask(t: TaskState, text: string, buttons: { id: string; label: string; style?: "primary" | "danger" }[]): Promise<void> {
    await app.client.chat.postMessage({
        channel: t.thread!.channel, thread_ts: t.thread!.ts, text,
        blocks: [
            { type: "section", text: { type: "mrkdwn", text } },
            { type: "actions", elements: buttons.map((b) => ({
                type: "button" as const, action_id: b.id, text: { type: "plain_text" as const, text: b.label }, value: t.url,
                ...(b.style ? { style: b.style } : {}),
            })) },
        ],
    });
}

export function update(id: string, patch: Partial<TaskState>): TaskState {
    const s = loadState();
    s.tasks[id] = { ...s.tasks[id], ...patch, updatedAt: new Date().toISOString() };
    saveState(s);
    return s.tasks[id];
}

// Slack shows no Markdown headings and caps a text block at 3000 characters: bold the headings, split on lines.
export function slackChunks(md: string, max = 2900): string[] {
    const chunks = [""];
    for (const line of md.split("\n").map((l) => l.replace(/^#+\s*(.+)$/, "*$1*"))) {
        if (chunks[chunks.length - 1].length + line.length + 1 > max) chunks.push("");
        chunks[chunks.length - 1] += `${line}\n`;
    }
    return chunks.filter((c) => c.trim());
}
