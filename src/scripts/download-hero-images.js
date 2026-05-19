/**
 * Download Hero Images from Notion
 * 
 * Runs at build time (before Astro build) to download hero images
 * from Notion's temporary S3 URLs and save them locally.
 * 
 * Downloads TWO types of images:
 * 1. Section hero images - from Section Settings database (one per section)
 * 2. Card hero images - from main database (any item with Hero Image File set)
 * 
 * @version 2.0 - Extended to all sections + Section Settings database
 * @updated February 2026
 */

import { Client } from '@notionhq/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const MAIN_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SECTION_SETTINGS_DB = process.env.NOTION_SECTION_SETTINGS_DB;

// Output directories
const SECTION_HEROES_DIR = path.resolve(__dirname, '../../public/images/heroes');
const CARD_IMAGES_DIR = path.resolve(__dirname, '../../public/images/cards');
const PROJECT_IMAGES_DIR = path.resolve(__dirname, '../../public/images/projects');
const CONTENT_IMAGES_DIR = path.resolve(__dirname, '../../public/images/content');

// Manifest files
const SECTION_MANIFEST_PATH = path.resolve(SECTION_HEROES_DIR, 'manifest.json');
const CARD_MANIFEST_PATH = path.resolve(CARD_IMAGES_DIR, 'manifest.json');
const PROJECT_MANIFEST_PATH = path.resolve(PROJECT_IMAGES_DIR, 'manifest.json');
const CONTENT_MANIFEST_PATH = path.resolve(CONTENT_IMAGES_DIR, 'manifest.json');

function generateSlug(title) {
  if (!title) return 'untitled';
  // Must match notion-projects.js exactly so manifest keys align with lookups
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

function getExtension(url, contentType) {
  const urlPath = url.split('?')[0];
  const urlExt = path.extname(urlPath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(urlExt)) return urlExt;
  if (contentType) {
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('webp')) return '.webp';
    if (contentType.includes('gif')) return '.gif';
    if (contentType.includes('svg')) return '.svg';
  }
  return '.jpg';
}

async function downloadImage(url, slug, outputDir) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  ❌ Failed to download "${slug}": HTTP ${response.status}`);
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    const ext = getExtension(url, contentType);
    const filename = `${slug}${ext}`;
    const filepath = path.join(outputDir, filename);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    const sizeKB = Math.round(buffer.length / 1024);
    console.log(`  ✅ ${filename} (${sizeKB} KB)`);
    return filename;
  } catch (error) {
    console.error(`  ❌ Error downloading "${slug}":`, error.message);
    return null;
  }
}

function extractImageUrl(filesArray) {
  if (!filesArray || !Array.isArray(filesArray) || filesArray.length === 0) return null;
  const f = filesArray[0];
  return f?.file?.url || f?.external?.url || f?.url || null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  📁 Created: ${dir}`);
  }
}

async function downloadSectionHeroImages() {
  console.log('');
  console.log('📸 Section hero images (Section Settings database)...');

  ensureDir(SECTION_HEROES_DIR);

  if (!SECTION_SETTINGS_DB) {
    console.log('  ⚠️ NOTION_SECTION_SETTINGS_DB not set — skipping');
    fs.writeFileSync(SECTION_MANIFEST_PATH, JSON.stringify({}));
    return {};
  }

  try {
    const response = await notion.databases.query({
      database_id: SECTION_SETTINGS_DB,
      filter: { property: 'Status', select: { equals: 'Active' } },
    });

    const manifest = {};
    let downloaded = 0, skipped = 0;

    for (const page of response.results) {
      const props = page.properties || {};
      const name = props['Section Name']?.title?.[0]?.plain_text || 'Unknown';
      const slug = props['Slug']?.rich_text?.[0]?.plain_text || generateSlug(name);
      const imageUrl = extractImageUrl(props['Hero Image']?.files);

      if (!imageUrl) { console.log(`  ⏭️  ${name} — no image`); skipped++; continue; }

      console.log(`  ⬇️  ${name}`);
      const filename = await downloadImage(imageUrl, slug, SECTION_HEROES_DIR);
      if (filename) { manifest[slug] = `/images/heroes/${filename}`; downloaded++; }
    }

    fs.writeFileSync(SECTION_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`  Done: ${downloaded} downloaded, ${skipped} skipped`);
    return manifest;
  } catch (error) {
    console.error('  ❌ Error:', error.message);
    fs.writeFileSync(SECTION_MANIFEST_PATH, JSON.stringify({}));
    return {};
  }
}

async function downloadCardHeroImages() {
  console.log('');
  console.log('🖼️  Card hero images (all sections)...');

  ensureDir(CARD_IMAGES_DIR);
  ensureDir(PROJECT_IMAGES_DIR);

  if (!MAIN_DATABASE_ID) {
    console.log('  ⚠️ NOTION_DATABASE_ID not set — skipping');
    fs.writeFileSync(CARD_MANIFEST_PATH, JSON.stringify({}));
    fs.writeFileSync(PROJECT_MANIFEST_PATH, JSON.stringify({}));
    return {};
  }

  try {
    const response = await notion.databases.query({
      database_id: MAIN_DATABASE_ID,
      filter: {
        or: [
          { property: 'Status on Web', select: { equals: 'Published' } },
          { property: 'Show on Website', select: { equals: 'TRUE' } },
        ],
      },
    });

    const cardManifest = {};
    const projectManifest = {};
    let downloaded = 0, skipped = 0;

    for (const page of response.results) {
      const props = page.properties || {};
      const title = props.Title?.title?.[0]?.plain_text || '';
      if (!title) continue;

      const section = props.Section?.select?.name || '';
      const imageUrl = extractImageUrl(props['Hero Image File']?.files);
      if (!imageUrl) { skipped++; continue; }

      const slug = generateSlug(title);
      const isProject = section === 'Project Hub';
      const targetDir = isProject ? PROJECT_IMAGES_DIR : CARD_IMAGES_DIR;

      console.log(`  ⬇️  [${section || 'No section'}] ${title}`);
      const filename = await downloadImage(imageUrl, slug, targetDir);

      if (filename) {
        const imagePath = isProject ? `/images/projects/${filename}` : `/images/cards/${filename}`;
        cardManifest[slug] = imagePath;
        if (isProject) projectManifest[slug] = imagePath;
        downloaded++;
      }
    }

    fs.writeFileSync(CARD_MANIFEST_PATH, JSON.stringify(cardManifest, null, 2));
    fs.writeFileSync(PROJECT_MANIFEST_PATH, JSON.stringify(projectManifest, null, 2));
    console.log(`  Done: ${downloaded} downloaded, ${skipped} without images`);
    return cardManifest;
  } catch (error) {
    console.error('  ❌ Error:', error.message);
    fs.writeFileSync(CARD_MANIFEST_PATH, JSON.stringify({}));
    fs.writeFileSync(PROJECT_MANIFEST_PATH, JSON.stringify({}));
    return {};
  }
}

async function downloadPageContentImages() {
  console.log('');
  console.log('🖼️  Inline page content images (Notion body blocks)...');

  ensureDir(CONTENT_IMAGES_DIR);

  if (!MAIN_DATABASE_ID) {
    console.log('  ⚠️ NOTION_DATABASE_ID not set — skipping');
    fs.writeFileSync(CONTENT_MANIFEST_PATH, JSON.stringify({}));
    return {};
  }

  try {
    // Fetch all published items
    const dbResponse = await notion.databases.query({
      database_id: MAIN_DATABASE_ID,
      filter: {
        or: [
          { property: 'Status on Web', select: { equals: 'Published' } },
          { property: 'Show on Website', select: { equals: 'TRUE' } },
        ],
      },
    });

    const manifest = {};
    let downloaded = 0, skipped = 0;

    for (const page of dbResponse.results) {
      // Fetch all blocks for this page
      let blocks = [];
      let cursor = undefined;
      do {
        const blockResponse = await notion.blocks.children.list({
          block_id: page.id,
          start_cursor: cursor,
          page_size: 100,
        });
        blocks.push(...blockResponse.results);
        cursor = blockResponse.has_more ? blockResponse.next_cursor : undefined;
      } while (cursor);

      // Download only Notion-hosted file images (these have expiring S3 URLs)
      for (const block of blocks) {
        if (block.type !== 'image') continue;
        if (block.image?.type !== 'file') continue; // external URLs are stable, skip

        const imageUrl = block.image.file?.url;
        if (!imageUrl) continue;

        const safeId = block.id.replace(/-/g, '');
        const filename = await downloadImage(imageUrl, safeId, CONTENT_IMAGES_DIR);
        if (filename) {
          manifest[block.id] = `/images/content/${filename}`;
          downloaded++;
        } else {
          skipped++;
        }
      }
    }

    fs.writeFileSync(CONTENT_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`  Done: ${downloaded} downloaded, ${skipped} failed`);
    return manifest;
  } catch (error) {
    console.error('  ❌ Error:', error.message);
    fs.writeFileSync(CONTENT_MANIFEST_PATH, JSON.stringify({}));
    return {};
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Hero Image Download — Build Time Script  ');
  console.log('═══════════════════════════════════════════');

  const sectionManifest = await downloadSectionHeroImages();
  const cardManifest = await downloadCardHeroImages();
  const contentManifest = await downloadPageContentImages();

  console.log('');
  console.log(`✅ Complete: ${Object.keys(sectionManifest).length} section heroes, ${Object.keys(cardManifest).length} card images, ${Object.keys(contentManifest).length} content images`);
  console.log('');
}

main();
