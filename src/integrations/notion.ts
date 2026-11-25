// Notion, read-only, through Notion's MCP server on the Mac (your own sign-in; no integration token).
import { MODELS, NOTION_ME, NOTION_TASKS, SKIP_TYPES } from "../config.ts";
import { agent, prompt } from "../core/agent.ts";
import { step } from "../core/shell.ts";

export type NotionTask = { url: string; title: string; priority: string; type: string };

// Only the Notion MCP server is loaded (--strict-mcp-config): loading every server on the Mac made calls 4x dearer.
const NOTION_ONLY = ["--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: { notion: { type: "http", url: "https://mcp.notion.com/mcp" } } })];

// Notion URLs come in several shapes; the 32-hex page id is the stable key.
// A page opened inside a database view ("…/Product-Dev-<db id>?p=<page id>") is named by ?p=.
export const taskId = (url: string): string => {
    const flat = url.replace(/-/g, "");
    return (flat.match(/[?&](?:amp;)?p=([0-9a-f]{32})/i)?.[1] ?? flat.match(/[0-9a-f]{32}/i)?.[0] ?? url).toLowerCase();
};

// Notion's MCP returns app.notion.com/<id> links, which 404 in a browser; notion.so/<id> opens the page.
export const notionUrl = (url: string): string => (url.startsWith("http") ? `https://www.notion.so/${taskId(url)}` : url);

// Your open "Now" tasks, by date. The filter is plain SQL (deterministic); the agent only runs it.
export async function listTasks(): Promise<NotionTask[]> {
    const sql = `SELECT url, "Name", "Priority", "Type" FROM "${NOTION_TASKS}" ` +
        `WHERE ("Done" IS NULL OR "Done" = '__NO__') AND "Priority" = 'Now' ` +
        `AND "Person" LIKE '%${NOTION_ME}%' AND "Name" IS NOT NULL AND "Name" != '' ` +
        `AND ("Type" IS NULL OR "Type" NOT IN (${SKIP_TYPES.map((t) => `'${t}'`).join(",")})) ` +
        `ORDER BY "date:Date:start"`;
    const schema = {
        type: "object",
        properties: { tasks: { type: "array", items: { type: "object", properties: {
            url: { type: "string" }, title: { type: "string" }, priority: { type: "string" }, type: { type: "string" },
        }, required: ["url", "title", "priority", "type"], additionalProperties: false } } },
        required: ["tasks"], additionalProperties: false,
    };
    const out = await agent("picker", prompt("picker", { sql, source: NOTION_TASKS }), [
        "--model", MODELS.picker, "--tools", "", "--allowedTools", "mcp__notion__notion-query-data-sources",
        "--json-schema", JSON.stringify(schema), ...NOTION_ONLY,
    ], { onHost: true });
    const tasks = (out.structured_output as { tasks: NotionTask[] } | undefined)?.tasks;
    if (!tasks) throw new Error(`picker returned no tasks: ${JSON.stringify(out).slice(0, 1000)}`);
    step("picker", { cost: out.total_cost_usd, count: tasks.length });
    return tasks.map((t) => ({ ...t, url: notionUrl(t.url) }));
}

// One task as Markdown: its page plus the pages it links to, one level deep. No built-in tools, fetch only.
export async function fetchTask(url: string): Promise<string> {
    const out = await agent("notion", prompt("notion", { url }), [
        "--model", MODELS.notion,
        "--tools", "",
        "--allowedTools", "mcp__notion__notion-fetch",
        ...NOTION_ONLY,
    ], { onHost: true });
    if (out.is_error || !out.result) throw new Error(`Notion fetch failed: ${JSON.stringify(out).slice(0, 1000)}`);
    step("fetch", { cost: out.total_cost_usd, chars: out.result.length });
    return out.result;
}
