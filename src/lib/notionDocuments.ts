import { Client } from "@notionhq/client";

const notion = new Client({
  auth: import.meta.env.NOTION_API_KEY,
});

const DATABASE_ID = import.meta.env.NOTION_DATABASE_ID;

// If you later add "Document Audience" to Notion, set this to true.
const USE_AUDIENCE_FILTER = false;

export async function getPublicDocuments(displayLocation: string) {
  const andFilters: any[] = [
    {
      property: "Record Type",
      select: { equals: "Document" },
    },
    {
      property: "Show on Website",
      checkbox: { equals: true },
    },
    {
      property: "Display Locations",
      multi_select: { contains: displayLocation },
    },
  ];

  // Optional filter only if you actually have a "Document Audience" property in Notion
  if (USE_AUDIENCE_FILTER) {
    andFilters.push({
      property: "Document Audience",
      select: { equals: "Public" },
    });
  }

  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: { and: andFilters },
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
    displayLocations: (page.properties?.["Display Locations"]?.multi_select ?? []).map(
      (x: any) => x.name
    ),
    sortOrder: page.properties?.["Document Sort Order"]?.number ?? null,
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
