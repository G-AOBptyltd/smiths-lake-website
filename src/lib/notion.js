const NOTION_API_KEY = import.meta.env.NOTION_API_KEY;
const DATABASE_ID = '2c8d508adfc180bd99bbc8e0eed609e6';

export async function getProjects() {
  console.log('=== NOTION DEBUG ===');
  console.log('API Key exists:', !!NOTION_API_KEY);
  console.log('API Key length:', NOTION_API_KEY?.length || 0);
  console.log('Database ID:', DATABASE_ID);
  
  try {
    const url = `https://api.notion.com/v1/databases/${DATABASE_ID}/query`;
    console.log('Fetching URL:', url);
    
    const response = await fetch(url, {
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

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error response:', errorText);
      return [];
    }

    const data = await response.json();
    console.log('Results count:', data.results?.length || 0);
    
    if (data.results?.length > 0) {
      console.log('First result properties:', JSON.stringify(data.results[0].properties, null, 2));
    }

    return data.results.map(page => ({
      id: page.id,
      name: page.properties['Project Name']?.title?.[0]?.plain_text || 'Untitled',
      status: page.properties['Status']?.select?.name || 'Unknown',
      description: page.properties['Description']?.rich_text?.[0]?.plain_text || '',
      category: page.properties['Category']?.select?.name || 'General',
    }));
  } catch (error) {
    console.log('=== NOTION ERROR ===');
    console.log('Error:', error.message);
    return [];
  }
}
