// Running commands on the Mac, plus the run log.
import { spawnSync } from "node:child_process";
import { CLONE } from "../config.ts";

export type RunResult = { code: number; out: string; stdout: string };

export function run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): RunResult {
    const r = spawnSync(cmd, args, { cwd: opts.cwd, input: opts.input, encoding: "utf8", maxBuffer: 64 << 20 });
    return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "" };
}

// Like run(), but a non-zero exit is an error.
export function must(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): string {
    const r = run(cmd, args, opts);
    if (r.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.out}`);
    return r.out;
}

// git in the agents' clone.
export const git = (...args: string[]) => must("git", ["-C", CLONE, ...args]).trim();

// Every step appends here; cli.ts writes it to logs/<time>.json at the end.
export const log: Record<string, unknown>[] = [];

export function step(name: string, data: Record<string, unknown>): void {
    log.push({ step: name, at: new Date().toISOString(), ...data });
    console.log(`\n== ${name}`, JSON.stringify(data, null, 2).slice(0, 2000));
}
