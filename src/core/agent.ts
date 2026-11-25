// Calling Claude: one `claude -p` per role, streamed so you can watch every tool call.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { BOX, HERE, PROJECT_DIR } from "../config.ts";

// project/rules.md: what the agents in the box must know about this product beyond its CLAUDE.md.
const RULES = readFileSync(join(PROJECT_DIR, "rules.md"), "utf8");

// A list as Markdown bullets, for prompts.
export const bullets = (items: string[]): string => items.map((a) => `- ${a}`).join("\n");

// prompts/<name>.md with {{key}} filled in from vars.
export function prompt(name: string, vars: Record<string, string>): string {
    const text = readFileSync(join(HERE, "prompts", `${name}.md`), "utf8");
    return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export type AgentResult = {
    structured_output?: unknown; // the JSON, when the call used --json-schema
    result?: string; // the agent's final text
    total_cost_usd?: number; // what it would cost on the API; the subscription pays, this measures usage
    num_turns?: number;
    is_error?: boolean;
};

type ToolUse = { type: "tool_use"; name: string; input: Record<string, unknown> };

// One line per agent action: "  [coder] Edit src/app/.../page.tsx".
function show(role: string, t: ToolUse): void {
    const i = t.input;
    const what = String(i.file_path ?? i.path ?? i.pattern ?? i.command ?? i.id ?? "").replace(/^\/work\//, "");
    console.log(`  [${role}] ${t.name.replace(/^mcp__\w+__/, "")} ${what.slice(0, 120)}`);
}

// Runs one agent. Inside the box unless onHost. The prompt goes in on stdin, never as an argument.
// --permission-mode dontAsk: anything not explicitly allowed by the flags is refused.
export function agent(role: string, text: string, flags: string[], opts: { onHost?: boolean } = {}): Promise<AgentResult> {
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk", ...flags];
    const child = opts.onHost
        ? spawn("claude", args, { cwd: HERE })
        : spawn(BOX, ["claude", ...args, "--append-system-prompt", RULES]);
    child.stdin.end(text);
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    console.log(`  [${role}] started`);

    return new Promise((resolve, reject) => {
        let final: AgentResult | undefined;
        // stream-json: one JSON event per line. Print tool calls as they happen, keep the final "result".
        createInterface({ input: child.stdout }).on("line", (line: string) => {
            let ev: { type?: string; message?: { content?: unknown[] } } & AgentResult;
            try { ev = JSON.parse(line); } catch { return; }
            if (ev.type === "assistant") {
                for (const c of ev.message?.content ?? []) if ((c as ToolUse).type === "tool_use") show(role, c as ToolUse);
            }
            if (ev.type === "result") final = ev;
        });
        child.on("close", (code: number | null) => {
            if (final) resolve(final);
            else reject(new Error(`[${role}] claude ended without a result (exit ${code}):\n${stderr.slice(-3000)}`));
        });
    });
}
