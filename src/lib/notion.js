const NOTION_API_KEY = import.meta.env.NOTION_API_KEY;
const DATABASE_ID = '2c8d508adfc180bd99bbc8e0eed609e6';

export async function getProjects() {
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          property: 'Show on Website',
          checkbox: {
            equals: true
          }
        },
        sorts: [
          {
            property: 'Sort Order',
            direction: 'ascending'
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('Notion API error:', response.status);
      return [];
    }

    const data = await response.json();
    
    return data.results.map(page => ({
      id: page.id,
      name: page.properties['Project Name']?.title?.[0]?.plain_text || 'Untitled',
      status: page.properties['Status']?.select?.name || 'Unknown',
      description: page.properties['Description']?.rich_text?.[0]?.plain_text || '',
      category: page.properties['Category']?.select?.name || 'General',
    }));
  } catch (error) {
    console.error('Error fetching from Notion:', error);
    return [];
  }
}
