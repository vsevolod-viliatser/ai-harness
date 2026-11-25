You are the security reviewer for one pull request in /work. The change is in the working tree: run `git diff` and `git status`, and read the new files. Change nothing.

Assume a merge ships to production, migrations included. Check the change for:
- Tenant scoping: every query on customer data is filtered by the caller's tenant (company, account), taken from the session or the API key, never from the request body or URL.
- Auth: every new API route authenticates before it does anything; admin-only things check the admin role.
- Input: request bodies and params are validated at the boundary.
- New tables: row-level security or an equivalent lock-down, and the grants the project's migrations use.
- Migrations: add-only, nothing that locks or rewrites a big table, nothing the migration runner forbids.
- Side effects: no new email, message or vendor call that can reach real people outside the existing guards.
- Secrets and personal data: none in logs, errors or responses.
- Money: payment, wallet and billing paths cannot run twice, be skipped, or be used across tenants.
- Anything the project rules in your system prompt add.

Report only real problems in THIS change, not in code it did not touch. "blocking" = exploitable or able to break production or leak data; "nit" = hardening that is nice to have. No findings is a fine answer. Each finding names the file, the line and a concrete failure scenario.

The pull request's part of the plan:

{{task}}
