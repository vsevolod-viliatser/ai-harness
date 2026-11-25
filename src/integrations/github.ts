// GitHub through the `gh` CLI on the Mac (your login; the box never sees it): draft PRs and their CI.
import { REPO } from "../config.ts";
import { must, run, step } from "../core/shell.ts";
import type { Triage } from "../roles/triage.ts";
import { commitAndPush, type DiffStat } from "../workspace/clone.ts";
import type { Limits } from "../workspace/gate.ts";
import { saveRun } from "../workspace/runs.ts";
import { notionUrl } from "./notion.ts";

// Draft PRs the harness opened that are still open: the review queue waiting for you.
export function openHarnessPrs(): { number: number; url: string; title: string }[] {
    const prs = JSON.parse(must("gh", ["pr", "list", "--repo", REPO, "--author", "@me", "--state", "open",
        "--json", "number,url,title,headRefName"])) as { number: number; url: string; title: string; headRefName: string }[];
    return prs.filter((p) => p.headRefName.startsWith("agent/"));
}

export const prBranch = (prUrl: string): string => must("gh", ["pr", "view", prUrl, "--json", "headRefName", "-q", ".headRefName"]).trim();

// Commit the clone's change to agent/<slug>, push it, open a draft PR. extra: a plan's PR passes its own title,
// a body section (its part of the plan, review results) and its limits, saved for later CI fixes.
export function publish(taskUrl: string, task: string, t: Triage, summary: string, d: DiffStat,
    extra: { title?: string; body?: string; limits?: Limits } = {}): string {
    const branch = `agent/${t.branch_slug}`;
    // The "# <title>" line the Notion agent writes; never the first line, which may be the agent talking.
    const title = (extra.title ?? task.match(/^#\s+(.+)$/m)?.[1] ?? t.branch_slug).trim().slice(0, 100);
    commitAndPush(branch, `fix: ${title}`, { newBranch: true });

    const body = [
        `Notion: ${notionUrl(taskUrl)}`,
        "",
        "## Done when",
        ...t.acceptance.map((a) => `- [ ] ${a}`),
        "",
        "## Agent's own summary (check it against the diff: it can be wrong)",
        summary.trim(),
        "",
        `Checks run before opening: the project checks and a lint ratchet. ${d.files.length} files, ${d.lines} lines.`,
        ...(extra.body ? ["", extra.body] : []),
    ].join("\n");
    const url = must("gh", ["pr", "create", "--repo", REPO, "--draft", "--base", "main", "--head", branch, "--title", title, "--body", body]).trim();
    saveRun({ branch, taskUrl, task, triage: t, limits: extra.limits });
    step("pr", { url, branch });
    return url;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Blocks until every check on the PR has finished. Returns null when CI is green, else the failing jobs' logs.
export async function waitForCi(branch: string): Promise<string | null> {
    console.log(`  [ci] waiting for checks on ${branch}`);
    for (let i = 0; i < 12 && run("gh", ["pr", "checks", branch, "--repo", REPO]).out.includes("no checks"); i++) await sleep(10_000);
    // --watch returns when nothing is pending; exit 0 = all passed.
    const watched = run("gh", ["pr", "checks", branch, "--repo", REPO, "--watch", "--interval", "20"]);
    if (watched.code === 0) { step("ci", { ok: true }); return null; }

    const checks = JSON.parse(must("gh", ["pr", "checks", branch, "--repo", REPO, "--json", "name,state,link"])) as { name: string; state: string; link: string }[];
    const failed = checks.filter((c) => c.state === "FAILURE");
    const log = failed.map((c) => {
        const job = c.link.match(/\/job\/(\d+)/)?.[1];
        const raw = job ? run("gh", ["run", "view", "--repo", REPO, "--job", job, "--log-failed"]).out : "(no log)";
        // Lines look like "<job>\t<step>\t<timestamp> <text>": keep the text, drop colour codes.
        const text = raw.split("\n").map((l) => l.split("\t").pop()!.replace(/^\S+Z /, "").replace(/\x1b\[[0-9;]*m/g, ""));
        return `### ${c.name}\n${text.slice(-120).join("\n")}`;
    }).join("\n\n");
    step("ci", { ok: false, failed: failed.map((c) => c.name), tail: log.slice(-1500) });
    return log;
}

// "OPEN" | "MERGED" | "CLOSED", or "" when gh can't tell (offline, rate limit): the caller tries again later.
export function prState(prUrl: string): string {
    const r = run("gh", ["pr", "view", prUrl, "--json", "state", "-q", ".state"]);
    return r.code === 0 ? r.out.trim() : "";
}
