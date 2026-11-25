Your change in /work was opened as a pull request and CI failed on it. The working tree is that pull request's branch.

Fix what CI reports with the smallest change, then run the same check locally to confirm.

Notes:
- CI lints every changed file as a whole with `--max-warnings 0`. If it flags problems that were in a file before your change, fix them too, but only in the files CI names. Do not touch other files.
- Do not change CI configuration, lint rules or tests to make the failure go away.

Failing CI output:
{{ciLog}}

Acceptance criteria of the task, for reference:
{{acceptance}}

The task:

{{task}}
