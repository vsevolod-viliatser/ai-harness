// One PR of the plan: code -> checks -> tester + security (up to MAX_REVIEW_ROUNDS) -> draft PR -> CI.
import { MAX_REVIEW_ROUNDS, PHASE_MAX_LINES } from "../config.ts";
import { publish } from "../integrations/github.ts";
import { loadPhase, planText } from "../roles/architect.ts";
import { code } from "../roles/coder.ts";
import { blocking, formatFindings, security, tester, type Finding } from "../roles/reviewers.ts";
import { diffStat, syncClone } from "../workspace/clone.ts";
import type { Limits } from "../workspace/gate.ts";
import { loadRun } from "../workspace/runs.ts";
import { fixCi } from "./ci.ts";
import { checkAndFix } from "./fix-loop.ts";
import { result, stage } from "./progress.ts";

export async function buildPhase(slug: string, n: number): Promise<string> {
    // The task as read when the plan was made, and this PR's section of the plan (with your edits, if any).
    const r = loadRun(`agent/${slug}`);
    const p = loadPhase(slug, n);
    Object.assign(result, { phase: n, phases: p.total });
    const task = [
        r.task,
        `## The approved plan\n\n${planText(slug)}`,
        `## Your part now: PR ${n} of ${p.total} only\n\nThe PRs before it are merged into main already; the ones after it come later. Do only this:\n\n${p.section}`,
    ].join("\n\n");
    const limits: Limits = { maxLines: PHASE_MAX_LINES, allowSchema: p.migration };

    syncClone(); // main, with the earlier PRs merged
    stage(`Phase ${n}/${p.total}: ${p.title}. Coding…`);
    let summary = await code(task, p.triage);

    // Checks, then the tester and security; their blocking findings go back to the coder.
    let open: Finding[] = [];
    let nits: Finding[] = [];
    for (let round = 1; ; round++) {
        const gate = await checkAndFix(task, p.triage, summary, limits);
        if ("stop" in gate) return gate.stop;
        summary = gate.summary;

        stage(`Review, round ${round} of ${MAX_REVIEW_ROUNDS}: the tester writes tests, security reads the diff…`);
        const found = [...await tester(task, p.triage), ...await security(task, diffStat().files)];
        open = blocking(found);
        nits = found.filter((f) => f.severity === "nit");
        if (!open.length || round === MAX_REVIEW_ROUNDS) break;

        stage(`${open.length} blocking:\n${formatFindings(open)}\nThe coder is fixing them…`);
        summary = (await code(task, p.triage, { from: "review", output: formatFindings(open), lastTry: round === MAX_REVIEW_ROUNDS - 1 })) || summary;
    }

    // The tester's tests came after the last checks: run them once more.
    const gate = await checkAndFix(task, p.triage, summary, limits);
    if ("stop" in gate) return gate.stop;

    const body = [
        `## Plan: PR ${n} of ${p.total}`, p.section.replace(/^## .*\n/, ""),
        ...(open.length ? ["", `## ⚠️ Still blocking after ${MAX_REVIEW_ROUNDS} review rounds: needs you`, formatFindings(open)] : []),
        ...(nits.length ? ["", "## Review nits (not fixed)", formatFindings(nits)] : []),
    ].join("\n");
    const title = p.total === 1 ? p.planTitle : `${p.planTitle} · PR ${n}/${p.total}: ${p.title}`;
    const url = publish(r.taskUrl, r.task, p.triage, gate.summary, gate.diff, { title, body, limits });
    result.pr = url;
    stage(`Draft PR for phase ${n}/${p.total} opened: ${url}${open.length ? `\n⚠️ ${open.length} blocking findings left open, listed in the PR description` : ""}`);
    return `pr: ${url}\n   ${await fixCi(`agent/${p.triage.branch_slug}`)}`;
}
