The tester and the security reviewer found blocking problems in your change in /work. The working tree already contains your change and the tester's tests (see `git diff` and `git status`).

Fix each finding below with the smallest change. Do not delete or weaken the tester's tests to make them pass: if a test is wrong, fix the test and say why in your summary. Run `npm run test:unit` and `npx tsc --noEmit` before you finish.

Findings:
{{findings}}

Acceptance criteria, for reference:
{{acceptance}}

Finish with a short summary in this exact form:
WHAT: <what you changed and why, 1-3 lines>
VERIFY: <numbered steps for a human to see it working in the app>

The task:

{{task}}
