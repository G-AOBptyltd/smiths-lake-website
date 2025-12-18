import { Client } from "@notionhq/client";

const notion = new Client({
  auth: import.meta.env.NOTION_API_KEY,
});

const DATABASE_ID = import.meta.env.NOTION_DATABASE_ID;

/** Helper to safely pull a plain text value from rich_text/title */
function getPlainText(prop: any): string {
  if (!prop) return "";
  const arr = prop?.title ?? prop?.rich_text ?? [];
  return arr?.[0]?.plain_text ?? "";
}

/** Helper to safely pull a URL from a Notion url property */
function getUrl(prop: any): string {
  return prop?.url ?? "";
}

/** Helper to safely pull a select name */
function getSelectName(prop: any): string {
  return prop?.select?.name ?? "";
}

/** Helper to safely pull multi-select names */
function getMultiSelectNames(prop: any): string[] {
  return Array.isArray(prop?.multi_select)
    ? prop.multi_select.map((x: any) => x?.name).filter(Boolean)
    : [];
}

/**
 * Try multiple possible property names for summary/description
 */
function getSummaryFromPage(page: any): string {
  const props = page?.properties ?? {};
  const candidates = ["Document Summary", "Document Description", "Description", "Summary"];

  for (const key of candidates) {
    const value = getPlainText(props?.[key]);
    if (value) return value;
  }
  return "";
}

/**
 * Try multiple possible property names for the document link.
 * Your Notion screenshot shows "Group Info Document" is where the Drive links are.
 */
function getDocumentUrlFromPage(page: any): string {
  const props = page?.properties ?? {};

  const candidates = [
    "Document URL",          // preferred
    "Group Info Document",   // what you’re currently using in Notion
    "URL",
    "Link",
  ];

  for (const key of candidates) {
    const url = getUrl(props?.[key]);
    if (url) return url;
  }

  return "";
}

/**
 * Core fetcher
 * - displayLocation matches a multi-select tag in Notion: "Display Locations"
 * - audience is a select: "Document Audience" = "Public" | "Members"
 * - "Show on Website" is a SELECT with TRUE/FALSE (not a checkbox)
 */
export async function getDocuments(
  displayLocation: string,
  audience: "Public" | "Members" = "Public"
) {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        { property: "Record Type", select: { equals: "Document" } },
        { property: "Show on Website", select: { equals: "TRUE" } },
        { property: "Display Locations", multi_select: { contains: displayLocation } },
        { property: "Document Audience", select: { equals: audience } },
      ],
    },
    sorts: [{ property: "Document Sort Order", direction: "ascending" }],
  });

  return response.results.map((page: any) => {
    const url = getDocumentUrlFromPage(page);

    return {
      id: page.id,
      title: getPlainText(page?.properties?.Title) || "Untitled",

      // IMPORTANT: Use the Drive URL you actually store
      url: url || "#",

      category: getSelectName(page?.properties?.["Document Category"]),
      displayLocations: getMultiSelectNames(page?.properties?.["Display Locations"]),

      // Your DocumentLibrary.astro reads doc.description, so provide that field
      description: getSummaryFromPage(page),

      // Optional backward-compat if anything else uses summary
      summary: getSummaryFromPage(page),

      lastEdited: page.last_edited_time
        ? new Date(page.last_edited_time).toLocaleDateString("en-AU", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "",
      editedBy: page.last_edited_by?.name ?? "PPCA",
    };
  });
}

export async function getPublicDocuments(displayLocation: string) {
  return getDocuments(displayLocation, "Public");
}

export async function getMemberDocuments(displayLocation: string) {
  return getDocuments(displayLocation, "Members");
}

