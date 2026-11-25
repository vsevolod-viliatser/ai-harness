# harness

An AI dev harness for a solo developer. It reads your tasks from Notion and offers them to you in Slack. When you press **Take**, Claude agents do the task inside a locked-down Docker box and open a draft pull request. Planning, review and merge stay with you.

It runs on a Mac on a Claude subscription. There is no server and nothing else to pay for.

```
Notion ("Now" tasks)
   │  weekdays 10:00, or "tasks" in the bot DM, or a task link
   ▼
Slack DM: [Take] [Skip]
   ▼
triage ──► needs answers ──► questions in the thread ──► you reply ──► rerun
   │   └─► needs a human ──► says why
   ▼
small (≤50 lines)? ──► quick fix: coder ─► checks ─► security (unless UI-only) ─► draft PR ─► CI
   │                       └─ came out bigger? dropped, and planned instead
   ▼
architect: a plan of PRs ──► 1 PR, no migration: starts on its own
                         └─► otherwise: [Approve] / [Reject] (or reply to re-plan)
   ▼
each PR: coder ─► checks ─► tester + security, ≤3 rounds ─► draft PR ─► CI, fixed up to 2×
   ▼
you review ──► reply in the thread: the coder updates the same PR
           └─► merge: [Phase N+1] … done
```

## Why it is built this way

**Workflow, not a free agent.** Plain TypeScript decides what happens next: triage, plan, code, check, review, publish. A model is called for one bounded job at a time, gets only the tools that job needs, and answers in a fixed JSON shape where code has to read the answer. That makes the harness predictable, debuggable and cheap.

**The agents think, the Mac acts.** Everything that leaves the machine is plain code on the host: the push, the PR, the Slack message. The agents cannot do any of it.

| Layer | What enforces it |
|---|---|
| No secrets in reach | Agents run in Docker (`docker/`). The box has no `.env`, no cloud credentials, no SSH and no `gh`. The only secret inside it is the Claude subscription token. |
| No network | Egress is deny-by-default: only `api.anthropic.com` and the npm registry are reachable (`docker/init-firewall.sh`). Root privileges are dropped before an agent starts. |
| No git writes | `.git` is mounted read-only. Agents cannot commit, push or plant hooks. |
| Least privilege per role | Each role gets its own tool list and `--permission-mode dontAsk`, so anything not listed is refused. Triage, architect and security are read-only. The tester may keep only `__tests__` files; code reverts anything else it touches. |
| Only `agent/*` branches | A `pre-push` hook that lives outside the clone (`hooks/`) refuses every other branch. PRs are always drafts. |
| Size and scope | `src/workspace/gate.ts` stops a diff that is too big, too far over its estimate, or touches CI, scripts or agent config. Schema changes go only in a PR the plan marks as a migration. |
| Bounded loops | At most 2 fixes for failed checks, 3 review rounds and 2 CI fixes. After that the PR opens anyway, with what is left marked "needs you". |
| One listener | The Slack bot obeys a single user id. Clicks and messages from anyone else are ignored. |

**Models by risk.** Each role runs on the cheapest model that does its job well. Opus goes where a mistake costs most: the architect on big tasks, the coder, and security on anything beyond UI. When a cheaper model fails a fix, the last attempt is escalated to Opus. The whole table is `MODELS` in `src/config.ts`.

## Layout

```
src/
  cli.ts            one run: new task | one PR of a plan | your PR feedback | CI fixes
  listener.ts       the Slack bot: buttons, DMs, thread replies
  morning.ts        the weekday task list
  config.ts         every limit, path and model in one place
  flows/            the runs, read top to bottom
    task.ts           triage, then a quick fix or a plan
    phase.ts          one PR of a plan, with tester + security rounds
    revise.ts         your feedback, pushed to the open PR
    ci.ts             wait for CI, fix what fails
    fix-loop.ts       guard, checks, give failures back to the coder
  roles/            one file per agent: its prompt variables, tools, model, output shape
    triage.ts  architect.ts  coder.ts  reviewers.ts
  workspace/        the agents' clone: reset, diff, gate, saved run state
  integrations/     notion.ts (MCP, read-only), github.ts (gh), slack.ts
  bot/              the bot's queue, merge watcher, Slack helpers
  core/             running claude, shell + run log, state.json
prompts/            what each role is told (Markdown, {{vars}})
docker/             the box: image, firewall, entrypoint, the checks gate
bin/                setup, verify, install, uninstall, box
hooks/pre-push      only agent/* branches
project.example/    template for project/ (not in git): repo, Notion ids, checks, rules
```

These are local only and not in git:

- `work/repo`, the agents' clone;
- `plans/`, the architect's plans, which you can edit before Approve;
- `logs/`, one JSON per run with every step and its usage;
- `state.json`.

## Setup

1. Install Docker (Docker Desktop or OrbStack), Node 22+ and the Claude Code CLI. Install `gh` and log in with the account that will open the PRs.
2. Describe your product:
   ```bash
   cp -r project.example project
   ```
   - In `project/config.json`, set the repo, the commit identity, your Slack user id, your Notion tasks data source and your Notion user id, and the check commands. Keep the checks the same as your CI, minus the build.
   - In `project/rules.md`, write what the agents must know beyond the repo's own `CLAUDE.md`.
3. Put the tokens in the macOS Keychain:
   ```bash
   claude setup-token   # prints a subscription token
   security add-generic-password -a "$USER" -s harness-claude    -w '<token>'
   security add-generic-password -a "$USER" -s harness-slack-bot -w 'xoxb-…'
   security add-generic-password -a "$USER" -s harness-slack-app -w 'xapp-…'
   ```
   The Slack app needs:
   - Socket Mode and Interactivity turned on;
   - the bot scopes `chat:write`, `im:write` and `im:history`;
   - the `message.im` bot event.
4. Connect Notion to Claude Code with `claude mcp add --transport http notion https://mcp.notion.com/mcp`, then sign in.
5. Build, check and turn the harness on:
   ```bash
   npm ci
   bin/setup     # builds the box, clones the repo into work/repo, installs its deps inside the box
   bin/verify    # isolation checks: every line must say OK
   bin/install   # launchd: the morning list on weekdays at 10:00, the bot always on
   ```

## Use

In the bot DM:

- **Take** takes a task, and **Skip** hides it for good.
- `tasks` re-sends the list.
- A Notion task link takes that task, whatever its priority.
- A reply in a task's thread goes into its next run:
  - after questions, it is your answers;
  - under a plan, it is feedback, and the architect re-plans;
  - while a PR is open, it is a change to that PR.
- **Approve** / **Reject** decide a plan of several PRs or one with a migration.
- **Phase N** starts the next PR after you have merged and checked the last one.

From the terminal (`npm run task -- …` works too):

```bash
node src/cli.ts <notion-url>                      # triage, then a quick fix or a plan
node src/cli.ts <notion-url> --triage-only
node src/cli.ts --phase <slug> <n>                # build PR <n> of plans/<slug>.md
node src/cli.ts --revise <pr-url> --answers <f>   # apply feedback to an open harness PR
node src/cli.ts --fix-ci agent/<slug>             # watch and fix CI on a harness PR
```

## Limits

- It runs only while the Mac is awake. A morning run missed during sleep runs on wake. Clicks made while the Mac sleeps are lost.
- It does one task at a time. When 2 of its PRs are waiting for review, new tasks wait in the queue (`WIP_LIMIT`).
- It never runs the app, end-to-end tests, migrations, or anything that needs production secrets. For UI changes, the PR lists the steps to check by hand.
- Usage counts against the same subscription you code with. Each run logs its usage at API list price; the subscription pays, so the number only measures how much was used.

## Off

```bash
bin/uninstall         # stop the bot and the morning job
bin/uninstall --all   # also remove the image and the keychain items; then delete this folder
```

## License

MIT, see [LICENSE](LICENSE).
