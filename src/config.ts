// Every path, limit, model and rule of the harness in one place. Tune here, not in the code that uses them.
// What belongs to one product (its repo, Notion, checks, rules) lives in project/ (not in git); see project.example/.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PROJECT_DIR = join(HERE, "project");
type Project = {
    repo: string; // owner/name on GitHub: where the PRs go
    slackUserId: string; // you: the only person the bot listens to
    notion: { tasks: string; me: string; skipTypes: string[] };
    coderCommands: string[]; // Bash commands the agents may run, on top of the read-only ones below
    schemaPaths: string[]; // regexes: a change here is a schema change
};
export const PROJECT: Project = JSON.parse(readFileSync(join(PROJECT_DIR, "config.json"), "utf8"));

export const CLONE = join(HERE, "work", "repo"); // the agents' own clone of the product repo
export const BOX = join(HERE, "bin", "box"); // runs a command inside the Docker box
export const REPO = PROJECT.repo;

// Which model each role runs on: the cheapest one that does the job, Opus where a mistake costs the most.
// Escalation: a role on a cheaper model gets Opus for its last fix attempt (coderLastTry).
export const MODELS = {
    picker: "haiku", // runs one fixed SQL query
    notion: "sonnet", // reads the task and its linked pages, copies them verbatim
    triage: "sonnet",
    architect: "opus", // where a bad split costs a whole series of PRs
    architectSmall: "sonnet", // triage saw a small change: the plan is one PR anyway
    coder: "opus", // the code is what you review: it gets the best model
    coderLastTry: "opus",
    tester: "sonnet",
    security: "opus",
    securityUi: "sonnet", // the diff only touches UI files: no routes, queries or migrations
} as const;
// Triage's estimate at or under this is a quick fix: no plan and no tester, straight to code -> checks -> PR,
// with security only when the diff is not UI-only. The real diff may be at most maxDiff, or it gets a plan after all.
export const QUICK = { lines: 50, files: 3, maxDiff: 120 };
// Triage's estimate at or under this is "small" for the architect's model.
export const SMALL_TASK = { lines: 150, files: 6 };
// A diff where every file matches is UI only (security runs on MODELS.securityUi).
export const UI_ONLY = /\.(tsx|css)$/;
export const NOT_UI = /(^|\/)(api|server|lib)\//;

// The architect plans each PR at about this size, so that you can review it in one sitting.
export const HARD_MAX_LINES = 300;
// How many times the coder gets the failing check output back before we give up.
export const MAX_FIX_ROUNDS = 2;
// How many times the harness pushes a fix after CI fails on its PR.
export const MAX_CI_ROUNDS = 2;

// Code stops a PR whose real diff is over this (the tester's tests come on top of the plan's estimate).
export const PHASE_MAX_LINES = 500;
// Coder -> checks -> tester -> security rounds before the PR opens anyway, with what is left marked "needs you".
export const MAX_REVIEW_ROUNDS = 3;
// The only files the tester may leave changed; the harness reverts anything else it touches.
export const TEST_PATH = /(^|\/)__tests__\//;

// Schema and dependency changes: allowed only in a PR the plan marks as a migration.
export const ESCALATE_PATHS = [/^package(-lock)?\.json$/, ...PROJECT.schemaPaths.map((p) => new RegExp(p))];
// Never in an agent PR: CI, deploy, scripts with secrets, the agent's own config.
export const FORBIDDEN_PATHS = [/^\.github\//, /^\.claude\//, /^\.husky\//, /^scripts\//, /^Dockerfile/, /^\.env/];

// Notion: the tasks data source and you (the Person the harness picks tasks for).
export const NOTION_TASKS = PROJECT.notion.tasks;
export const NOTION_ME = PROJECT.notion.me;
// Task types the harness never offers: they need a design file or a human decision.
export const SKIP_TYPES = PROJECT.notion.skipTypes;

// At most this many harness PRs waiting for your review before it stops taking new tasks.
export const WIP_LIMIT = 2;
// Most tasks in one morning message (Slack caps a message at 50 blocks).
export const MORNING_MAX_TASKS = 12;

export const STATE = join(HERE, "state.json");
export const WORK = join(HERE, "work"); // the clone, saved runs, the bot's scratch files
export const LOGS = join(HERE, "logs");
// The architect's plans, one Markdown file per task. Local only; edit one before you press Approve.
export const PLANS = join(HERE, "plans");

// The only shell commands the coder and the tester may run inside the box.
export const CODER_BASH = [
    ...PROJECT.coderCommands.map((c) => `Bash(${c})`),
    "Bash(git diff *)", "Bash(git status *)", "Bash(git log *)", "Bash(ls *)", "Bash(rg *)",
];
