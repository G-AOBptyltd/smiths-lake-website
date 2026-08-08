/**
 * Paginated Notion database query.
 *
 * WHY THIS EXISTS
 * ---------------
 * `notion.databases.query()` returns at most 100 rows per call and signals more
 * with `has_more` / `next_cursor`. Every build-time query in src/lib/ used to
 * call it once and use `response.results` directly, so once the PPCA content
 * database passed 100 published rows, whatever sorted past position 100 silently
 * vanished from the built site — no error, no warning, just missing pages.
 *
 * That is precisely the "it's live in News Desk but not on the website" class of
 * bug: the Netlify functions behind the admin UI already paginate correctly, so
 * the admin saw all the rows while the static build saw the first 100.
 *
 * Use this instead of calling databases.query() directly anywhere the result set
 * can grow with content.
 *
 * @param {import('@notionhq/client').Client} notion - Notion client
 * @param {object} params - Same params as notion.databases.query(), minus paging
 * @returns {Promise<Array>} Every result page concatenated, in query order
 */
export async function queryAllPages(notion, params) {
  const all = [];
  let cursor = undefined;
  // Hard stop so a malformed cursor can never spin a build forever.
  // 100 pages x 100 rows = 10,000 rows, far beyond any village content database.
  const MAX_PAGES = 100;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await notion.databases.query({
      ...params,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    all.push(...(response.results || []));

    if (!response.has_more || !response.next_cursor) return all;
    cursor = response.next_cursor;
  }

  console.warn(
    `[notion-query-all] Stopped at ${MAX_PAGES} pages (${all.length} rows). ` +
    `Results may be truncated — raise MAX_PAGES if the database really is this large.`
  );
  return all;
}

export default { queryAllPages };
