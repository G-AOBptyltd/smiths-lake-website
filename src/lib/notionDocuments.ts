import { Client } from "@notionhq/client";
// @ts-ignore — plain JS helper, no type declarations needed
import { resilientFetch } from "./notion-fetch.js";

const notion = new Client({
  auth: import.meta.env.NOTION_API_KEY,
  fetch: resilientFetch,
});

const DATABASE_ID = import.meta.env.NOTION_DATABASE_ID;

/**
 * Helper to safely pull a plain text value from a Notion "rich_text" or "title" property.
 */
function getPlainText(prop: any): string {
  if (!prop) return "";
  const arr = prop?.title ?? prop?.rich_text ?? [];
  return arr?.[0]?.plain_text ?? "";
}

/**
 * Helper to safely pull a URL from a Notion "url" property.
 */
function getUrl(prop: any): string {
  return prop?.url ?? "";
}

/**
 * Helper to safely pull a select name.
 */
function getSelectName(prop: any): string {
  return prop?.select?.name ?? "";
}

/**
 * Helper to safely pull a multi-select array of names.
 */
function getMultiSelectNames(prop: any): string[] {
  return Array.isArray(prop?.multi_select)
    ? prop.multi_select.map((x: any) => x?.name).filter(Boolean)
    : [];
}

/**
 * Summary/description helper (supports multiple possible property names).
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
 * ✅ URL helper (supports your current Notion column names)
 * Your DB is currently populated with "Group Info Document" URLs (drive.google.com/...),
 * so we fall back to that if "Document URL" is empty.
 */
function getDocumentUrlFromPage(page: any): string {
  const props = page?.properties ?? {};

  const candidates = [
    "Document URL",
    "Group Info Document",      // <-- your populated column in screenshots
    "Group Info Document URL",
    "Website URL",
    "URL",
    "Link",
  ];

  for (const key of candidates) {
    const value = getUrl(props?.[key]);
    if (value) return value;
  }

  return "";
}

/**
 * Core fetcher
 * - displayLocation matches multi-select: "Display Locations"
 * - audience matches select: "Document Audience"
 * - "Show on Website" is SELECT with TRUE/FALSE
 */
export async function getDocuments(
  displayLocation: string,
  audience: "Public" | "Members" = "Public"
) {
  let response;
  try {
    response = await notion.databases.query({
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
  } catch (err) {
    // Fail-open: a Notion outage or transient fetch error must never fail the
    // production build. Page/component call sites that don't wrap this are
    // protected here — the document library just renders empty this build.
    console.warn(
      `Notion documents fetch failed for "${displayLocation}" (${audience}) — returning empty list:`,
      (err as any)?.message ?? err
    );
    return [];
  }

  return response.results.map((page: any) => ({
    id: page.id,
    title: getPlainText(page?.properties?.Title) || "Untitled",
    url: getDocumentUrlFromPage(page) || "",
    category: getSelectName(page?.properties?.["Document Category"]),
    displayLocations: getMultiSelectNames(page?.properties?.["Display Locations"]),
    summary: getSummaryFromPage(page),
    lastEdited: page.last_edited_time
      ? new Date(page.last_edited_time).toLocaleDateString("en-AU", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "",
    editedBy: page.last_edited_by?.name ?? "PPCA",
  }));
}

export async function getPublicDocuments(displayLocation: string) {
  return getDocuments(displayLocation, "Public");
}

export async function getMemberDocuments(displayLocation: string) {
  return getDocuments(displayLocation, "Members");
}

