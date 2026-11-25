# Project rules for the agents

Appended to the system prompt of every agent that runs in the box. The repo's own CLAUDE.md applies too;
put here what the agents must know that is not in the repo. Keep it short and concrete.

## Safety
- Never call a path that sends email, charges money or talks to a vendor just to "check" something. Tests use no network and no database.
- Every query on tenant data is scoped to the caller's tenant id.
- Validate request input at the route boundary.
- Never log secrets, tokens or personal data.

## Database
- How schema changes are written and shipped (migration folder, naming, what a migration may not contain).

## Code style
- The conventions a reviewer would otherwise flag.

## Checks you may run
The commands in project/config.json "coderCommands". Never: build, dev server, migrations, end-to-end tests, git commit, git push.
