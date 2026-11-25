// Your feedback on an open PR (a reply in the task's thread): the coder changes that PR and pushes to it.
import { prBranch } from "../integrations/github.ts";
import { code } from "../roles/coder.ts";
import { checkoutBranch, commitAndPush } from "../workspace/clone.ts";
import { loadRun, saveRun } from "../workspace/runs.ts";
import { fixCi } from "./ci.ts";
import { checkAndFix } from "./fix-loop.ts";
import { result, stage } from "./progress.ts";

export async function revise(prUrl: string, feedback: string): Promise<string> {
    const branch = prBranch(prUrl);
    const r = loadRun(branch);

    checkoutBranch(branch);
    stage("Updating the PR with your feedback…");
    const summary = await code(r.task, r.triage, { from: "feedback", output: feedback });
    if (summary.trim().startsWith("TOO BIG:")) {
        return `not a change to this PR: ${summary.trim().slice(8).split("\n")[0].trim()} Close the PR and make it a new task.`;
    }
    const gate = await checkAndFix(r.task, r.triage, summary, r.limits);
    if ("stop" in gate) return gate.stop;
    if (!gate.diff.files.length) return "the agent changed nothing: needs you";

    commitAndPush(branch, "fix: review feedback");
    result.pr = prUrl;
    // Later CI fixes and revisions see this feedback as part of the task.
    saveRun({ ...r, task: `${r.task}\n\n## Feedback from the developer on the PR\n${feedback}` });
    stage(`Pushed to the PR: ${gate.diff.lines} lines in ${gate.diff.files.length} files.`);
    return `pr: ${prUrl}\n   ${await fixCi(branch)}`;
}
