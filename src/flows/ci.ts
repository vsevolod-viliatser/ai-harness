// After a PR is open: wait for CI; when it fails, hand the failing log to the coder, check locally, push, wait again.
import { MAX_CI_ROUNDS } from "../config.ts";
import { waitForCi } from "../integrations/github.ts";
import { code } from "../roles/coder.ts";
import { checkoutBranch, commitAndPush, diffStat } from "../workspace/clone.ts";
import { checks, guard } from "../workspace/gate.ts";
import { loadRun } from "../workspace/runs.ts";
import { stage } from "./progress.ts";

export async function fixCi(branch: string): Promise<string> {
    const r = loadRun(branch);
    for (let round = 0; ; round++) {
        stage("Waiting for CI…");
        const failed = await waitForCi(branch);
        if (!failed) return `CI green on ${branch}`;
        if (round === MAX_CI_ROUNDS) return `CI still red after ${MAX_CI_ROUNDS} fixes: needs you`;

        stage(`CI failed, fixing (attempt ${round + 1} of ${MAX_CI_ROUNDS})…`);
        checkoutBranch(branch);
        await code(r.task, r.triage, { from: "ci", output: failed, lastTry: round === MAX_CI_ROUNDS - 1 });
        const diff = diffStat();
        if (!diff.files.length) return "CI red and the agent changed nothing: needs you";
        const stop = guard(r.triage, diff, r.limits);
        if (stop) return `CI fix stopped: ${stop}`;
        if (checks(diff.files).code !== 0) return "the CI fix fails local checks: needs you";

        commitAndPush(branch, `fix: CI (round ${round + 1})`);
    }
}
