Run exactly this one query with the Notion query tool (mode "sql", data_source_urls ["{{source}}"]) and return its rows. Do not change the query, do not call any other tool, do not add or drop rows.

{{sql}}

Return every row as {url, title, priority, type}: url from the "url" column, title from "Name", priority from "Priority", type from "Type" (empty string when null).
