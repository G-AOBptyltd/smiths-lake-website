import { Client } from "@notionhq/client";

const notion = new Client({
  auth: import.meta.env.NOTION_API_KEY,
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
 * Try multiple possible property names for "description" so you can name it whatever
 * you prefer in Notion without breaking the site.
 */
function getDescriptionFromPage(page: any): string {
  const props = page?.properties ?? {};

  // Preferred names (create any ONE of these in Notion)
  const candidates = ["Document Summary", "Document Description", "Description"];

  for (const key of candidates) {
    const value = getPlainText(props?.[key]);
    if (value) return value;
  }

  return "";
}

/**
 * Core fetcher (use this everywhere).
 * - displayLocation matches a multi-select tag in Notion: "Display Locations"
 * - audience is a select: "Document Audience" = "Public" | "Members"
 *
 * NOTE: Your "Show on Website" is a SELECT with TRUE/FALSE (not a checkbox).
 */
export async function getDocuments(
  displayLocation: string,
  audience: "Public" | "Members" = "Public"
) {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        // Only Document records
        {
          property: "Record Type",
          select: { equals: "Document" },
        },

        // "Show on Website" is a SELECT in your DB (TRUE/FALSE)
        {
          property: "Show on Website",
          select: { equals: "TRUE" },
        },

        // Controls where it appears (multi-select)
        {
          property: "Display Locations",
          multi_select: { contains: displayLocation },
        },

        // Audience gate (select)
        {
          property: "Document Audience",
          select: { equals: audience },
        },
      ],
    },
    sorts: [
      {
        property: "Document Sort Order",
        direction: "ascending",
      },
    ],
  });

  return response.results.map((page: any) => ({
    id: page.id,
    title: getPlainText(page?.properties?.Title) || "Untitled",
    url: getUrl(page?.properties?.["Document URL"]) || "#",
    category: getSelectName(page?.properties?.["Document Category"]),
    description: getDescriptionFromPage(page),
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

/**
 * Backwards-compatible function used by your About page right now.
 * (So you don’t have to change anything else yet.)
 */
export async function getPublicDocuments(displayLocation: string) {
  return getDocuments(displayLocation, "Public");
}

/**
 * Convenience function for members-only documents (we’ll wire this into the UI next).
 */
export async function getMemberDocuments(displayLocation: string) {
  return getDocuments(displayLocation, "Members");
}
