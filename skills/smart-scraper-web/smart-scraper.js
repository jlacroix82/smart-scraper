#!/usr/bin/env node
/**
 * Smart Web Scraping — Extract structured data from websites
 * 
 * Modes:
 *   --extract <url>                      → Extract structured data from page
 *   --extract --table <url>              → Extract tables from page
 *   --extract --list <url>               → Extract lists from page
 *   --extract --price <url>              → Extract prices from page
 *   --extract --article <url>            → Extract article content
 *   --extract --all <url>                → Extract everything
 *   --parse <html>                       → Parse raw HTML
 *   --status                             → Scraping status
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const WORKSPACE = (() => {
  if (process.env.SCRAPER_DIR) return process.env.SCRAPER_DIR;
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'MEMORY.md'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return path.resolve(__dirname, '..', '..');
})();

const CACHE_DIR = path.join(WORKSPACE, 'memory', 'scraper-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'cache.json');

// ── Cache limits ─────────────────────────────────────────────────────────────
const MAX_CACHE_ENTRIES = 50;
const MAX_CACHE_BYTES = 10 * 1024 * 1024; // 10MB
const CACHE_TTL = 300000; // 5 minutes

// ── Redirect limits ──────────────────────────────────────────────────────────
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT = 15000; // 15 seconds
const RATE_LIMIT_MS = 100; // minimum delay between requests

// ── SSRF blocklist ───────────────────────────────────────────────────────────
const BLOCKED_SCHEMES = ['file:', 'gopher:', 'data:', 'javascript:', 'ftp:'];
const PRIVATE_IP_RANGES = [
  /^127\./,          // localhost
  /^10\./,           // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,     // 192.168.0.0/16
  /^169\.254\./,     // link-local
  /^0\./,            // 0.0.0.0/8
  /^::1$/,           // IPv6 localhost
  /^fc[0-9a-f]{2}:/, // IPv6 unique local
  /^fe[89ab][0-9a-f]:/, // IPv6 link-local
];
const CLOUD_METADATA_IPS = [
  '169.254.169.254',
  '169.254.170.2',
  '169.254.169.253',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    const data = fs.readFileSync(file, 'utf8');
    return JSON.parse(data);
  } catch { return fallback || {}; }
}

function saveJSON(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// ─── URL VALIDATION ────────────────────────────────────────────────────────

function validateUrl(inputUrl) {
  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return { valid: false, error: `Invalid URL: ${inputUrl}` };
  }

  // Block dangerous schemes
  if (BLOCKED_SCHEMES.includes(parsed.protocol)) {
    return { valid: false, error: `Blocked scheme: ${parsed.protocol}` };
  }

  // Only allow http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Only http/https URLs allowed, got: ${parsed.protocol}` };
  }

  // Block cloud metadata endpoints
  if (CLOUD_METADATA_IPS.includes(parsed.hostname)) {
    return { valid: false, error: `Blocked cloud metadata endpoint: ${parsed.hostname}` };
  }

  // Block private/internal IPs
  const ip = parsed.hostname;
  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(ip)) {
      return { valid: false, error: `Blocked private/internal IP: ${ip}` };
    }
  }

  // Block localhost variants
  if (['localhost', '0.0.0.0', '[::]', '::1'].includes(parsed.hostname)) {
    return { valid: false, error: `Blocked localhost: ${parsed.hostname}` };
  }

  return { valid: true, parsed };
}

// ─── HTTP FETCH (safe, with redirect limit and rate limiting) ────────────

let lastRequestTime = 0;

async function fetchPage(url, redirectCount = 0, originalUrl = null) {
  // Rate limiting
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();

  // Max redirect limit
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (${MAX_REDIRECTS})`);
  }

  // Re-validate redirect target to prevent SSRF bypass
  if (redirectCount > 0) {
    const redirectValidation = validateUrl(url);
    if (!redirectValidation.valid) {
      throw new Error(`Redirect blocked: ${redirectValidation.error} (redirect target: ${url})`);
    }
    if (!originalUrl) {
      originalUrl = url;
    }
  }

  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;

    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SmartScraper/1.0)' },
      timeout: REQUEST_TIMEOUT
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        fetchPage(res.headers.location, redirectCount + 1, originalUrl || url)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── HTML PARSING ──────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]{0,1000000}?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]{0,1000000}?<\/style>/gi, '')
    .replace(/<[^>]{0,1024}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHtml(html) {
  // Simple HTML parser for common patterns
  const result = {
    title: '',
    headings: [],
    paragraphs: [],
    links: [],
    tables: [],
    lists: [],
    prices: [],
    images: [],
    metadata: {}
  };
  
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) result.title = titleMatch[1].trim();
  
  // Extract headings
  const headingRegex = /<h([1-6])[^>]{0,1024}>([^<]{0,10000})<\/h\1>/gi;
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    result.headings.push({ level: parseInt(match[1]), text: match[2].trim() });
  }
  
  // Extract paragraphs
  const paraRegex = /<p[^>]{0,1024}>([\s\S]{0,100000})<\/p>/gi;
  while ((match = paraRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]).trim();
    if (text.length > 20) result.paragraphs.push(text);
  }
  
  // Extract links
  const linkRegex = /<a[^>]{0,1024}href="([^"]{0,2048})"[^>]{0,1024}>([^<]{0,10000})<\/a>/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    result.links.push({ url: match[1], text: match[2].trim() });
  }
  
  // Extract images
  const imgRegex = /<img[^>]{0,1024}src="([^"]{0,2048})"[^>]{0,1024}alt="([^"]{0,2048})"[^>]{0,1024}\/?\?>/gi;
  while ((match = imgRegex.exec(html)) !== null) {
    result.images.push({ src: match[1], alt: match[2] });
  }
  
  // Extract tables
  const tableRegex = /<table[\s\S]{0,500000}?<\/table>/gi;
  while ((match = tableRegex.exec(html)) !== null) {
    const tableHtml = match[0];
    const rows = [];
    const rowRegex = /<tr[\s\S]{0,500000}?<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cells = [];
      const cellRegex = /<(th|td)[^>]{0,1024}>([\s\S]{0,100000})<\/\1>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
        cells.push(stripHtml(cellMatch[2]).trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) result.tables.push(rows);
  }
  
  // Extract lists
  const listRegex = /<ul[\s\S]{0,500000}?<\/ul>|<ol[\s\S]{0,500000}?<\/ol>/gi;
  while ((match = listRegex.exec(html)) !== null) {
    const listHtml = match[0];
    const items = [];
    const itemRegex = /<li[^>]{0,1024}>([\s\S]{0,100000})<\/li>/gi;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(listHtml)) !== null) {
      const text = stripHtml(itemMatch[1]).trim();
      if (text.length > 0) items.push(text);
    }
    if (items.length > 0) result.lists.push(items);
  }
  
  // Extract prices (common patterns)
  const priceRegex = /[\$€£¥]\s*\d+(?:,\d{3})*(?:\.\d{2})?/g;
  let priceMatch;
  while ((priceMatch = priceRegex.exec(html)) !== null) {
    result.prices.push(priceMatch[0]);
  }
  
  // Extract meta tags
  const metaRegex = /<meta[^>]*(?:name|property|itemprop)=["']([^"']+)["'][^>]*content=["']([^"']+)["'][^>]*\/?>/gi;
  while ((match = metaRegex.exec(html)) !== null) {
    result.metadata[match[1]] = match[2];
  }
  
  return result;
}

// ─── EXTRACT ───────────────────────────────────────────────────────────────

async function extractFromUrl(url, mode = 'all') {
  // Validate URL before fetching
  const validation = validateUrl(url);
  if (!validation.valid) {
    console.error(`[smart-scraper] Invalid URL: ${validation.error}`);
    console.error(`[smart-scraper] Only http/https URLs to public hosts are allowed.`);
    process.exit(1);
  }

  // Check cache
  const cache = loadJSON(CACHE_FILE, {});
  const cacheKey = url;
  let data = null;
  if (cache[cacheKey] && (Date.now() - cache[cacheKey].timestamp < CACHE_TTL)) {
    console.log(`[smart-scraper] Cache hit: ${url}`);
    data = cache[cacheKey].data;
  } else {
    // Evict expired entries
    const now = Date.now();
    for (const [key, entry] of Object.entries(cache)) {
      if (now - entry.timestamp > CACHE_TTL) {
        delete cache[key];
      }
    }
    // Evict oldest if over limit
    while (Object.keys(cache).length >= MAX_CACHE_ENTRIES) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, entry] of Object.entries(cache)) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) delete cache[oldestKey];
    }
    saveJSON(CACHE_FILE, cache);

    // Fetch page
    const html = await fetchPage(url);

    // Parse
    data = parseHtml(html);
    data.url = url;
    data.fetchedAt = new Date().toISOString();
    data.contentLength = html.length;

    // Cache
    cache[cacheKey] = { timestamp: Date.now(), data };
    saveJSON(CACHE_FILE, cache);
  }
  
  // Output based on mode
  switch (mode) {
    case 'table':
      console.log(`[smart-scraper] Tables found (${data.tables.length}):\n`);
      for (const table of data.tables.slice(0, 3)) {
        for (const row of table.slice(0, 5)) {
          console.log('  ' + row.join(' | '));
        }
        console.log('');
      }
      break;
    case 'list':
      console.log(`[smart-scraper] Lists found (${data.lists.length}):\n`);
      for (const list of data.lists.slice(0, 3)) {
        console.log(`  ${list.length} items:`);
        for (const item of list.slice(0, 10)) {
          console.log(`    • ${item.substring(0, 80)}`);
        }
        console.log('');
      }
      break;
    case 'price':
      console.log(`[smart-scraper] Prices found (${data.prices.length}):\n`);
      for (const price of data.prices.slice(0, 20)) {
        console.log(`  ${price}`);
      }
      break;
    case 'article':
      console.log(`[smart-scraper] Article content:\n`);
      console.log(`  Title: ${data.title}`);
      console.log(`  Headings: ${data.headings.length}`);
      console.log(`  Paragraphs: ${data.paragraphs.length}`);
      console.log('\n  First paragraphs:');
      for (const p of data.paragraphs.slice(0, 5)) {
        console.log(`    ${p.substring(0, 120)}...`);
      }
      break;
    default: // all
      console.log(`[smart-scraper] Extracted from ${url}:\n`);
      console.log(`  Title: ${data.title}`);
      console.log(`  Headings: ${data.headings.length}`);
      console.log(`  Paragraphs: ${data.paragraphs.length}`);
      console.log(`  Links: ${data.links.length}`);
      console.log(`  Tables: ${data.tables.length}`);
      console.log(`  Lists: ${data.lists.length}`);
      console.log(`  Prices: ${data.prices.length}`);
      console.log(`  Images: ${data.images.length}`);
      console.log(`  Metadata keys: ${Object.keys(data.metadata).length}`);
      console.log(`  Content length: ${data.contentLength.toLocaleString()} chars`);
      break;
  }
  
  return data;
}

// ─── STATUS ────────────────────────────────────────────────────────────────

function showStatus() {
  const cache = loadJSON(CACHE_FILE, {});
  let cacheSize = 0;
  for (const [, data] of Object.entries(cache)) {
    cacheSize += JSON.stringify(data.data).length;
  }
  
  console.log('[smart-scraper] Status:\n');
  console.log(`  Cached pages: ${Object.keys(cache).length}`);
  console.log(`  Cache size: ${formatBytes(cacheSize)}`);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let cliMode = 'status';
let searchQuery = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--extract') cliMode = 'extract';
  if (args[i] === '--parse') cliMode = 'parse';
  if (args[i] === '--status') cliMode = 'status';
  if (args[i] === '--table') searchQuery = 'table';
  if (args[i] === '--list') searchQuery = 'list';
  if (args[i] === '--price') searchQuery = 'price';
  if (args[i] === '--article') searchQuery = 'article';
  if (args[i] === '--all') searchQuery = 'all';
  if (args[i] === '--dir' && i + 1 < args.length) process.env.SCRAPER_DIR = args[i + 1];
}

// Find the first non-flag argument (URL or HTML)
function findArg() {
  for (const a of args) {
    if (!a.startsWith('--')) return a;
  }
  return null;
}

(async () => {
  switch (cliMode) {
    case 'extract': {
      const url = findArg();
      if (!url) {
        console.log('Usage: smart-scraper.js --extract <url>');
      } else {
        await extractFromUrl(url, searchQuery || 'all');
      }
      break;
    }
    case 'parse': {
      const html = findArg();
      if (!html) {
        console.log('Usage: smart-scraper.js --parse "<html content>"');
      } else {
        const data = parseHtml(html);
        console.log('[smart-scraper] Parsed HTML:\n');
        console.log(`  Title: ${data.title}`);
        console.log(`  Headings: ${data.headings.length}`);
        console.log(`  Paragraphs: ${data.paragraphs.length}`);
        console.log(`  Links: ${data.links.length}`);
        console.log(`  Tables: ${data.tables.length}`);
        console.log(`  Lists: ${data.lists.length}`);
        console.log(`  Prices: ${data.prices.length}`);
      }
      break;
    }
    default:
      showStatus();
      break;
  }
})();
