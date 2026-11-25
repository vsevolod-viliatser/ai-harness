// The agents' own clone of the product repo (work/repo): reset it, switch branches, measure and commit changes.
// The box mounts its .git read-only, so every git write happens here, on the Mac.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOX, CLONE, WORK } from "../config.ts";
import { git, must, step } from "../core/shell.ts";

export type DiffStat = { files: string[]; lines: number };

// A clean checkout of origin/main. npm ci (inside the box) only when package-lock.json changed.
export function syncClone(): void {
    git("fetch", "-q", "origin");
    git("checkout", "-q", "--detach", "origin/main");
    git("reset", "-q", "--hard", "origin/main");
    git("clean", "-fdq"); // untracked files go, ignored ones (node_modules, .next) stay

    const lockSha = createHash("sha256").update(readFileSync(join(CLONE, "package-lock.json"))).digest("hex");
    const stamp = join(WORK, ".lock-sha");
    if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== lockSha) {
        must(BOX, ["npm", "ci"]);
        writeFileSync(stamp, lockSha);
    }
    step("sync", { head: git("rev-parse", "--short", "HEAD") });
}

// Puts the clone on a PR's branch, exactly as it is on GitHub.
export function checkoutBranch(branch: string): void {
    git("fetch", "-q", "origin", branch);
    git("checkout", "-q", "-B", branch, `origin/${branch}`);
    git("clean", "-fdq");
}

// What the agents changed in the working tree, new files included.
export function diffStat(): DiffStat {
    git("add", "-A"); // stage briefly so new files count too
    const files = git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
    const lines = git("diff", "--cached", "--numstat").split("\n").filter(Boolean)
        .reduce((n, l) => n + (Number(l.split("\t")[0]) || 0) + (Number(l.split("\t")[1]) || 0), 0);
    git("reset", "-q");
    return { files, lines };
}

export function commitAndPush(branch: string, message: string, opts: { newBranch?: boolean } = {}): void {
    if (opts.newBranch) git("checkout", "-q", "-B", branch);
    git("add", "-A");
    git("commit", "-q", "-m", message);
    git("push", "-q", ...(opts.newBranch ? ["-u"] : []), "origin", branch); // the pre-push hook allows agent/* only
    step("push", { branch, message });
}
