// One run of the harness. The Slack bot starts these; you can too. Each run writes logs/<time>.json.
//
//   node src/cli.ts <notion-url | task.md>          triage, then a quick fix (PR) or a plan (plans/<slug>.md)
//   node src/cli.ts <notion-url> --triage-only      read + triage only
//   node src/cli.ts --phase <slug> <n>              build PR <n> of plans/<slug>.md, review it, open it, fix CI
//   node src/cli.ts --revise <pr-url> --answers <f> change an open harness PR as the feedback in <f> asks
//   node src/cli.ts --fix-ci agent/<slug>           watch CI on a harness PR and fix what fails
//   … --answers <file>   your replies to questions or to the plan, added to the task
//   … --result <file>    write the outcome for the Slack bot (see flows/progress.ts)
//
// The flows are in src/flows/, read top to bottom: task.ts (new task), phase.ts (one PR of a plan),
// revise.ts (your PR feedback), ci.ts (CI fixes). They call the roles in src/roles/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOGS } from "./config.ts";
import { log } from "./core/shell.ts";
import { fixCi } from "./flows/ci.ts";
import { buildPhase } from "./flows/phase.ts";
import { result } from "./flows/progress.ts";
import { revise } from "./flows/revise.ts";
import { newTask } from "./flows/task.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const answersFile = flag("--answers");
const answers = answersFile ? readFileSync(answersFile, "utf8").trim() : undefined;

async function main(): Promise<string> {
    const [first, second, third] = args;
    if (first === "--fix-ci" && second?.startsWith("agent/")) return fixCi(second);
    if (first === "--revise" && second?.startsWith("http") && answers) return revise(second, answers);
    if (first === "--phase" && second && Number(third) > 0) return buildPhase(second, Number(third));
    if (first && (first.startsWith("http") || existsSync(first))) return newTask(first, { answers, triageOnly: args.includes("--triage-only") });

    console.error([
        "usage: node src/cli.ts <notion-url | task.md> [--triage-only] [--answers <file>]",
        "       node src/cli.ts --phase <slug> <n>",
        "       node src/cli.ts --revise <pr-url> --answers <file>",
        "       node src/cli.ts --fix-ci agent/<slug>",
    ].join("\n"));
    process.exit(2);
}

const startedAt = new Date().toISOString().replace(/[:.]/g, "-");
let outcome: string;
try {
    outcome = await main();
} catch (e) {
    outcome = `error: ${(e as Error).message}`;
}

mkdirSync(LOGS, { recursive: true });
const file = join(LOGS, `${startedAt}.json`);
const cost = log.reduce((n, s) => n + (typeof s.cost === "number" ? s.cost : 0), 0);
writeFileSync(file, JSON.stringify({ args, outcome, cost_usd_list_price: cost, steps: log }, null, 2));
const resultFile = flag("--result");
if (resultFile) writeFileSync(resultFile, JSON.stringify({ outcome, ...result, log: file }, null, 2));
console.log(`\n=> ${outcome}\n   log: ${file}\n   usage at API list price (the subscription pays): $${cost.toFixed(2)}`);
