import { Client as NotionClient } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const notion = NOTION_TOKEN ? new NotionClient({ auth: NOTION_TOKEN }) : null;

// Default root page ID (My life)
let cachedRootPageId = '3ec3762b-86ba-80f9-b7ef-fb663ecea911';

export async function getRootPageId() {
  if (cachedRootPageId) return cachedRootPageId;
  if (!notion) return null;

  try {
    const searchRes = await notion.search({ filter: { property: 'object', value: 'page' }, page_size: 1 });
    if (searchRes.results && searchRes.results.length > 0) {
      cachedRootPageId = searchRes.results[0].id;
      return cachedRootPageId;
    }
  } catch (e) {
    console.error('[NOTION] Error finding root page:', e.message);
  }
  return null;
}

export async function getNotionPagesContent(query = '') {
  if (!notion) return null;

  try {
    const searchRes = await notion.search({
      query: query,
      page_size: 10
    });

    if (!searchRes.results || searchRes.results.length === 0) {
      return null;
    }

    let resultText = '';

    for (const page of searchRes.results) {
      let title = 'Без названия';
      if (page.properties?.title?.title?.[0]?.plain_text) {
        title = page.properties.title.title[0].plain_text;
      } else if (page.properties?.Name?.title?.[0]?.plain_text) {
        title = page.properties.Name.title[0].plain_text;
      }

      resultText += `\n\n=== СТРАНИЦА NOTION: "${title}" (ID: ${page.id}) ===\n`;

      try {
        const blocks = await notion.blocks.children.list({
          block_id: page.id,
          page_size: 40
        });

        for (const block of blocks.results) {
          const type = block.type;
          if (block[type]?.rich_text) {
            const text = block[type].rich_text.map(t => t.plain_text).join('');
            if (text.trim()) {
              resultText += `- ${text}\n`;
            }
          }
        }
      } catch (blockErr) {
        console.error('Error fetching blocks for page', page.id, blockErr.message);
      }
    }

    return resultText;
  } catch (err) {
    console.error('Notion search error:', err.message);
    return null;
  }
}

export async function createNotionPage(title, contentText = '', links = []) {
  if (!notion) return null;

  try {
    const parentId = await getRootPageId();
    if (!parentId) return null;

    const children = [];

    if (contentText) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: contentText } }]
        }
      });
    }

    if (links && links.length > 0) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: '🔗 Ссылки и каналы' } }]
        }
      });

      for (const link of links) {
        children.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              { type: 'text', text: { content: link.title || link.url, link: { url: link.url } } }
            ]
          }
        });
      }
    }

    const newPage = await notion.pages.create({
      parent: { page_id: parentId },
      icon: { type: 'emoji', emoji: '📄' },
      properties: {
        title: {
          title: [{ text: { content: title } }]
        }
      },
      children: children.length > 0 ? children : undefined
    });

    console.log(`[NOTION] Created new page "${title}" successfully! URL: ${newPage.url}`);
    return newPage;
  } catch (err) {
    console.error('[NOTION] Error creating page:', err.message);
    return null;
  }
}
