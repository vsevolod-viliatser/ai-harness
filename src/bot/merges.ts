// The bot notices your merges itself. A merged PR of a multi-PR plan offers the next one as a button, never starts it
// on its own: you check the merged one first. The last PR, or a quick fix, makes the task done.
import { readFileSync } from "node:fs";
import { loadState } from "../core/state.ts";
import { prState } from "../integrations/github.ts";
import { planPrs } from "../roles/architect.ts";
import { ask, say, update } from "./app.ts";

export async function watchMerges(): Promise<void> {
    for (const [id, t] of Object.entries(loadState().tasks)) {
        if (t.status !== "pr" || !t.pr) continue;
        const state = prState(t.pr);
        if (state === "CLOSED") {
            update(id, { status: "stopped" });
            await say(t, "The PR was closed without merging, so I stopped the task.");
        } else if (state === "MERGED") {
            const total = t.plan ? planPrs(readFileSync(t.plan, "utf8")).length : 0;
            if (t.phase && t.phase < total) {
                update(id, { status: "next" });
                await ask(t, `Phase ${t.phase}/${total} merged. Check it, then press the button when you are ready for the next one.`,
                    [{ id: "next_phase", label: `Phase ${t.phase + 1}`, style: "primary" }]);
            } else {
                update(id, { status: "done" });
                await say(t, `Merged, and the task is done.${t.url.startsWith("http") ? " Mark it Done in Notion." : ""}`);
            }
        }
    }
}
