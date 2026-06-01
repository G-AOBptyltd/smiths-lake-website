/**
 * get-google-token.mjs
 * One-time script to get a Google OAuth refresh token for admin@villagefirst.org.au
 *
 * Usage:
 *   1. Fill in CLIENT_ID and CLIENT_SECRET below (from Google Cloud Console)
 *   2. Run: node scripts/get-google-token.mjs
 *   3. Open the URL it prints in your browser
 *   4. Sign in as admin@villagefirst.org.au and authorise
 *   5. You'll be redirected to a localhost URL — copy the "code" param from it
 *   6. Paste the code when prompted
 *   7. Copy the refresh_token it prints → add to Netlify as GOOGLE_REFRESH_TOKEN
 */

import { createInterface } from 'readline';

// ── FILL THESE IN ──────────────────────────────────────────────────────────
const CLIENT_ID = process.env.CLIENT_ID || 'PASTE_YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'PASTE_YOUR_CLIENT_SECRET_HERE';
// ──────────────────────────────────────────────────────────────────────────

const REDIRECT_URI = 'http://localhost';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent` +
  `&login_hint=greg%40agilityopsbusinessptyltd.com.au`;

console.log('\n─────────────────────────────────────────────────────');
console.log('Step 1: Open this URL in your browser and sign in as admin@villagefirst.org.au:');
console.log('\n' + authUrl + '\n');
console.log('Step 2: After authorising, you\'ll be redirected to a localhost URL.');
console.log('        Copy the full URL from the browser address bar.');
console.log('─────────────────────────────────────────────────────\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });

rl.question('Paste the full redirect URL here: ', async (redirectUrl) => {
  rl.close();

  let code;
  try {
    const url = new URL(redirectUrl);
    code = url.searchParams.get('code');
  } catch (e) {
    // Maybe they just pasted the code itself
    code = redirectUrl.trim();
  }

  if (!code) {
    console.error('Could not extract code from URL. Try pasting just the code value.');
    process.exit(1);
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();

  if (tokens.error) {
    console.error('\n❌ Error:', tokens.error, tokens.error_description);
    process.exit(1);
  }

  console.log('\n─────────────────────────────────────────────────────');
  console.log('✅ Success! Add these to Netlify environment variables:');
  console.log('─────────────────────────────────────────────────────');
  console.log(`\nGOOGLE_CLIENT_ID=${CLIENT_ID}`);
  console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\n─────────────────────────────────────────────────────');
  console.log('The refresh_token does not expire unless access is revoked.');
  console.log('Store all three as Netlify env vars → All scopes → Save → Done.');
  console.log('─────────────────────────────────────────────────────\n');
});
