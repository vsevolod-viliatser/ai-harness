Fetch the Notion task page {{url}}.

Then fetch, one level deep only, every Notion page that its body mentions or links, and the pages its relation properties point to (such as a parent feature).

Reply with the Markdown only, no words of your own before or after it:
- first line "# <task title>"
- then "Type:" and "Priority:"
- then the task body, verbatim
- then a "## Linked context" section with each linked page's title and content

Do not summarise the task body and do not add anything of your own.
