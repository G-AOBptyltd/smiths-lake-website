/**
 * Download Hero Images from Notion
 * 
 * Runs at build time (before Astro build) to download hero images
 * from Notion's temporary S3 URLs and save them locally.
 * 
 * This solves the problem of Notion's signed URLs expiring after 1 hour.
 * Images are saved to /public/images/projects/ and referenced by slug.
 * 
 * @version 1.0
 * @created February 2026
 */

import { fetchNotionContent } from '../lib/notion-unified.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Output directory for downloaded images
const OUTPUT_DIR = path.resolve(__dirname, '../../public/images/projects');

// Manifest file to track downloaded images (used by notion-projects.js)
const MANIFEST_PATH = path.resolve(__dirname, '../../public/images/projects/manifest.json');

/**
 * Generate a URL-safe slug from a title
 */
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Extract image URL from Notion file field
 */
function extractImageUrl(fileField) {
  if (!fileField) return null;

  // Direct string URL
  if (typeof fileField === 'string') return fileField;

  // Array of file objects (from notion-unified.js files type)
  if (Array.isArray(fileField) && fileField.length > 0) {
    const firstFile = fileField[0];
    if (firstFile.url) return firstFile.url;
    if (firstFile.external?.url) return firstFile.external.url;
    if (firstFile.file?.url) return firstFile.file.url;
  }

  // Single object with url
  if (fileField.url) return fileField.url;
  if (fileField.external?.url) return fileField.external.url;
  if (fileField.file?.url) return fileField.file.url;

  return null;
}

/**
 * Determine file extension from URL or content-type header
 */
function getExtension(url, contentType) {
  // Try from URL first (before query params)
  const urlPath = url.split('?')[0];
  const urlExt = path.extname(urlPath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(urlExt)) {
    return urlExt;
  }

  // Fall back to content-type
  if (contentType) {
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('webp')) return '.webp';
    if (contentType.includes('gif')) return '.gif';
    if (contentType.includes('svg')) return '.svg';
  }

  // Default
  return '.jpg';
}

/**
 * Download a single image
 */
async function downloadImage(url, slug) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`  ❌ Failed to download image for "${slug}": HTTP ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    const ext = getExtension(url, contentType);
    const filename = `${slug}${ext}`;
    const filepath = path.join(OUTPUT_DIR, filename);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    const sizeKB = Math.round(buffer.length / 1024);
    console.log(`  ✅ ${filename} (${sizeKB} KB)`);

    return filename;
  } catch (error) {
    console.error(`  ❌ Error downloading image for "${slug}":`, error.message);
    return null;
  }
}

/**
 * Main function - fetch projects and download hero images
 */
async function downloadHeroImages() {
  console.log('');
  console.log('🖼️  Downloading hero images from Notion...');
  console.log('');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`  📁 Created directory: ${OUTPUT_DIR}`);
  }

  try {
    // Fetch all Project Hub items from Notion
    const projects = await fetchNotionContent({
      section: 'Project Hub',
      requireShowOnWebsite: true
    });

    console.log(`  Found ${projects.length} published projects`);
    console.log('');

    const manifest = {};
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const project of projects) {
      const title = project.title || 'Untitled';
      const slug = generateSlug(title);
      const imageUrl = extractImageUrl(project.heroImageFile);

      if (!imageUrl) {
        console.log(`  ⏭️  ${title} — no hero image set`);
        skipped++;
        continue;
      }

      console.log(`  ⬇️  Downloading: ${title}`);
      const filename = await downloadImage(imageUrl, slug);

      if (filename) {
        manifest[slug] = `/images/projects/${filename}`;
        downloaded++;
      } else {
        failed++;
      }
    }

    // Write manifest file
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

    console.log('');
    console.log(`🖼️  Hero images complete: ${downloaded} downloaded, ${skipped} skipped (no image), ${failed} failed`);
    console.log(`  📄 Manifest written to: ${MANIFEST_PATH}`);
    console.log('');

  } catch (error) {
    console.error('❌ Fatal error downloading hero images:', error.message);
    console.error('  Build will continue — projects will use placeholder icons instead.');
    console.log('');

    // Write empty manifest so build doesn't break
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({}));
  }
}

// Run
downloadHeroImages();
