// The harness's memory between runs: state.json. Only the Slack bot writes it (one writer = no races).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { STATE } from "../config.ts";

export type TaskStatus =
    | "offered" // a task you wrote in the DM, waiting for you to press Take
    | "queued" // you pressed "Take", waiting for its turn
    | "running"
    | "pr" // a PR is open; the listener watches for your merge
    | "next" // a PR of a multi-PR plan got merged; the "Phase N+1" button waits for you
    | "done" // merged (the last PR of the plan)
    | "questions" // triage asked something; your reply in the thread restarts it
    | "plan" // the architect's plan waits for Approve / Reject; a reply in the thread re-plans
    | "stopped" // needs a human, rejected, or a failure: see the thread
    | "skipped"; // you pressed "Skip"

export type TaskState = {
    url: string;
    title: string;
    status: TaskStatus;
    thread?: { channel: string; ts: string }; // the Slack thread this task talks in
    answers?: string[]; // your replies in the thread (answers, plan feedback), fed into the next run
    plan?: string; // plans/<slug>.md
    phase?: number; // the plan's PR being built, or whose PR is open
    feedback?: string; // your reply about the open PR, waiting in the queue to be applied to it
    pr?: string;
    updatedAt: string;
};

export type State = { tasks: Record<string, TaskState>; queue: string[]; running: string | null };

export function loadState(): State {
    if (!existsSync(STATE)) return { tasks: {}, queue: [], running: null };
    return JSON.parse(readFileSync(STATE, "utf8"));
}

// Write to a temp file and rename: a crash mid-write can't leave half a JSON file behind.
export function saveState(s: State): void {
    writeFileSync(`${STATE}.tmp`, JSON.stringify(s, null, 2));
    renameSync(`${STATE}.tmp`, STATE);
}
