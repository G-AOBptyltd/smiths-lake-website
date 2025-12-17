import { Client } from "@notionhq/client";

const notion = new Client({
  auth: import.meta.env.NOTION_API_KEY,
});

const DATABASE_ID = import.meta.env.NOTION_DATABASE_ID as string;

type NotionPropertyType =
  | "checkbox"
  | "select"
  | "status"
  | "rich_text"
  | "title"
  | "multi_select"
  | "number"
  | "url"
  | string;

async function getDatabasePropertyTypes() {
  const db: any = await notion.databases.retrieve({ database_id: DATABASE_ID });
  const props = db?.properties ?? {};

  const types: Record<string, NotionPropertyType> = {};
  for (const [name, def] of Object.entries<any>(props)) {
    types[name] = def?.type ?? "unknown";
  }
  return types;
}

function buildShowOnWebsiteFilter(
  propertyName: string,
  propertyType: NotionPropertyType
) {
  // Checkbox (ideal)
  if (propertyType === "checkbox") {
    return { property: propertyName, checkbox: { equals: true } };
  }

  // Select / Status (common in Notion setups)
  if (propertyType === "select") {
    // Change these if your Select values differ (e.g., "Yes", "True", "Published")
    return { property: propertyName, select: { equals: "TRUE" } };
  }

  if (propertyType === "status") {
    // If you used a Status column for publishing
    return { property: propertyName, status: { equals: "Published" } };
  }

  // Fallback: no filter (so it won't crash builds)
  return null;
}

export async function getPublicDocuments(displayLocation: string) {
  try {
    const propertyTypes = await getDatabasePropertyTypes();

    const showPropName = "Show on Website";
    const showPropType = propertyTypes[showPropName];

    const filters: any[] = [
      {
        property: "Record Type",
        select: { equals: "Document" },
      },
      {
        property: "Display Locations",
        multi_select: { contains: displayLocation },
      },
    ];

    const showFilter = buildShowOnWebsiteFilter(showPropName, showPropType);
    if (showFilter) filters.push(showFilter);

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: { and: filters },
      sorts: [
        {
          property: "Document Sort Order",
          direction: "ascending",
        },
      ],
    });

    return response.results.map((page: any) => ({
      id: page.id,
      title: page.properties?.Title?.title?.[0]?.plain_text ?? "Untitled",
      url: page.properties?.["Document URL"]?.url ?? "#",
      category: page.properties?.["Document Category"]?.select?.name ?? "",
      lastEdited: page.last_edited_time
        ? new Date(page.last_edited_time).toLocaleDateString("en-AU", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "",
      editedBy: page.last_edited_by?.name ?? "PPCA",
    }));
  } catch (err) {
    // IMPORTANT: Never fail the Netlify build because Notion had an issue.
    console.warn("[Notion] getPublicDocuments failed; returning empty list.", err);
    return [];
  }
}
