// The inner loop of every flow: guard the diff, run the checks, hand failures back to the coder.
import { MAX_FIX_ROUNDS } from "../config.ts";
import { code } from "../roles/coder.ts";
import type { Triage } from "../roles/triage.ts";
import { diffStat, type DiffStat } from "../workspace/clone.ts";
import { checks, guard, type Limits } from "../workspace/gate.ts";
import { stage } from "./progress.ts";

export type Gate = { summary: string; diff: DiffStat } | { stop: string };

export async function checkAndFix(task: string, t: Triage, summary: string, limits: Limits = {}): Promise<Gate> {
    let diff = diffStat();
    for (let round = 0; ; round++) {
        const stop = guard(t, diff, limits);
        if (stop) return { stop: `escalated: ${stop}` };

        stage(`Checks (types, lint, tests): ${diff.lines} lines in ${diff.files.length} files…`);
        const check = checks(diff.files);
        if (check.code === 0) return { summary, diff };
        if (round === MAX_FIX_ROUNDS) { console.log(check.out); return { stop: "checks still failing after fixes" }; }

        stage(`Checks failed, fixing (attempt ${round + 1} of ${MAX_FIX_ROUNDS})…`);
        summary = (await code(task, t, { from: "checks", output: check.out, lastTry: round === MAX_FIX_ROUNDS - 1 })) || summary;
        diff = diffStat();
    }
}
