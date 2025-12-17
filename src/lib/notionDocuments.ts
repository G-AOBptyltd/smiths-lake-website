import { Client } from "@notionhq/client";

const notion = new Client({
  auth: import.meta.env.NOTION_API_KEY,
});

const DATABASE_ID = import.meta.env.NOTION_DATABASE_ID as string;

export async function getPublicDocuments(displayLocation: string) {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: "Record Type",
            select: { equals: "Document" },
          },
          {
            // IMPORTANT: This is a SELECT, not a checkbox
            property: "Show on Website",
            select: { equals: "TRUE" },
          },
          {
            property: "Display Locations",
            multi_select: { contains: displayLocation },
          },
          {
            property: "Document Audience",
            select: { equals: "Public" },
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
  } catch (error) {
    // Never fail a Netlify build because Notion had a problem
    console.warn(
      "[Notion] getPublicDocuments failed. Returning empty document list.",
      error
    );
    return [];
  }
}
