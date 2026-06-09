# Smart Scraper — Security Audit

**Date:** 2026-06-04  
**Auditor:** Jarvis (automated audit)  
**Files:** `smart-scraper.js` (~14KB), `SKILL.md` (~4KB)

---

## Audit Results: ALL CRITICAL ISSUES FIXED ✅

### Fixes Applied

| Finding | Fix | Status |
|---------|-----|--------|
| 🔴 SSRF — No URL validation | `validateUrl()` — blocks file://, gopher://, data:, javascript://, ftp://, localhost, private IPs, cloud metadata (169.254.169.254) | ✅ FIXED |
| 🔴 SSRF — No redirect limit | `MAX_REDIRECTS = 5` with redirect count tracking | ✅ FIXED |
| 🟠 ReDoS — `<[^>]+>` pattern | Bounded to `{0,1024}` | ✅ FIXED |
| 🟠 ReDoS — `<table[\s\S]*?</table>` | Bounded to `{0,500000}` | ✅ FIXED |
| 🟠 Cache grows indefinitely | LRU eviction: max 50 entries / 10MB, TTL cleanup | ✅ FIXED |
| 🟡 No rate limiting | 100ms minimum between requests | ✅ FIXED |
| 🟡 Fake User-Agent | Changed to `Mozilla/5.0 (compatible; SmartScraper/1.0)` | ✅ FIXED |
| 🟡 No timeout on redirects | Timeout inherited on each redirect hop | ✅ FIXED |

### All regex patterns now bounded:
- `<[^>]{0,1024}>` — tag matching
- `<table[\s\S]{0,500000}?` — table matching
- `href="([^"]{0,2048})"` — attribute values
- `[^>]{0,1024}` — all tag attribute matching
- `{0,100000}` — content body matching

### Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 0 | All fixed |
| 🟠 High | 0 | All fixed |
| 🟡 Medium | 0 | All fixed |
| 🟢 Low | 2 | Noted (HTML entity decoding, JSON size limit) |
| **Total** | **10** | **8 fixed, 2 low-risk noted** |

---

## Findings

### 🔴 CRITICAL

#### 1. SSRF — No URL Validation Before Fetch
**Severity:** Critical  
**Location:** `fetchPage()` (line 56)  
**Issue:** The URL from `--extract <url>` is passed directly to `http.get()` / `https.get()` with no validation. Any URL scheme is accepted — `file://`, `http://localhost`, `https://169.254.169.254` (AWS metadata), `gopher://`, etc.

```javascript
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    const req = client.get(url, ...);  // ← no validation
```

**Impact:** An agent or user could fetch internal services, cloud metadata endpoints, or local files via `file://` URLs.

**Fix:** Validate URL scheme (http/https only), reject private IP ranges, reject `file://`/`gopher://`/`data:` URLs.

---

#### 2. SSRF — Redirect Following Has No Loop Limit
**Severity:** Critical  
**Location:** `fetchPage()` (line 62-64)  
**Issue:** Redirects are followed recursively with no maximum depth. A malicious URL that returns a redirect loop or a very long redirect chain will cause infinite recursion → stack overflow → DoS.

```javascript
if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
  fetchPage(res.headers.location).then(resolve).catch(reject);  // ← infinite recursion
```

**Impact:** Denial of service via redirect loop. Also enables SSRF by redirecting to an internal IP after an initial external redirect.

**Fix:** Add a `redirectCount` parameter with a max of 5-10. Reject redirects to private/internal IP ranges.

---

### 🟠 HIGH

#### 3. Regex ReDoS — `<[^>]+>` Pattern (line 89)
**Severity:** High (theoretical)  
**Location:** `stripHtml()` (line 89)  
**Issue:** The pattern `<[^>]+>` is a classic ReDoS vector. While V8's regex engine handles it well in practice (negated classes don't backtrack), it's still a documented vulnerability class. Malformed HTML with extremely long tag attributes could cause performance issues.

```javascript
.replace(/<[^>]+>/g, ' ')  // line 89
```

**Impact:** Theoretical DoS with crafted HTML input. Low practical risk with V8.

**Fix:** Replace with a bounded pattern: `/<[^>]{0,1024}>/g` or use a proper HTML parser.

---

#### 4. Regex ReDoS — `<table[\s\S]*?</table>` (line 139)
**Severity:** High  
**Location:** `parseHtml()` (line 139)  
**Issue:** `<table[\s\S]*?</table>` uses non-greedy cross-line matching on unbounded input. If a page has a `<table>` tag without a closing `</table>` (common in malformed HTML), the regex scans the entire document. With very large HTML (10MB+), this causes significant CPU usage.

```javascript
const tableRegex = /<table[\s\S]*?<\/table>/gi;
```

**Impact:** CPU exhaustion on pages with unclosed `<table>` tags in large documents.

**Fix:** Add a max character limit: `<table[\s\S]{0,500000}?</table>` or use a proper HTML parser.

---

#### 5. Cache Grows Indefinitely — No Eviction
**Severity:** High  
**Location:** `extractFromUrl()` (line 208)  
**Issue:** Cache entries are written to `cache.json` but never evicted. Each unique URL adds a new entry. The cache grows indefinitely, consuming disk space and memory.

```javascript
cache[cacheKey] = { timestamp: Date.now(), data };
saveJSON(CACHE_FILE, cache);  // ← never cleaned up
```

**Impact:** Disk space exhaustion over time. Cache becomes slower as it grows.

**Fix:** Implement LRU eviction (max N entries or max size). Remove expired entries on each access.

---

### 🟡 MEDIUM

#### 6. No Rate Limiting / Request Throttling
**Severity:** Medium  
**Location:** `fetchPage()` (line 56)  
**Issue:** No rate limiting between requests. An agent could spam URLs rapidly, potentially getting the host's IP blocked or triggering abuse detection.

**Impact:** IP blocking, abuse detection, wasted bandwidth.

**Fix:** Add configurable delay between requests (e.g., 100ms default).

---

#### 7. User-Agent Spoofing
**Severity:** Medium  
**Location:** `fetchPage()` (line 61)  
**Issue:** Uses a fake User-Agent (`Mozilla/5.0 (SmartScraper/1.0)`) which is easily detectable and may violate terms of service on some sites.

```javascript
headers: { 'User-Agent': 'Mozilla/5.0 (SmartScraper/1.0)' }
```

**Impact:** IP blocking, ToS violation.

**Fix:** Use a more realistic User-Agent or make it configurable.

---

#### 8. No Timeout on Redirect Resolution
**Severity:** Medium  
**Location:** `fetchPage()` (line 64)  
**Issue:** The redirect `fetchPage()` call inherits no timeout. If a redirect target hangs, the whole request hangs.

**Impact:** Resource exhaustion, stuck requests.

**Fix:** Pass timeout to recursive calls.

---

### 🟢 LOW

#### 9. JSON Parse — No Size Limit
**Severity:** Low  
**Location:** `loadJSON()` (line 39)  
**Issue:** `JSON.parse()` has no size limit. A very large cache file would consume memory but would also fail gracefully (throws error caught by try/catch).

**Impact:** Minimal — the try/catch provides protection.

**Fix:** Add a max file size check before parsing.

---

#### 10. stripHtml Does Not Handle All HTML Entities
**Severity:** Low  
**Location:** `stripHtml()` (line 85)  
**Issue:** `stripHtml()` removes script/style tags and strips remaining HTML tags, but does not decode HTML entities (`&amp;`, `&lt;`, `&#x27;`, etc.). This means extracted text may contain undecoded entities.

**Impact:** Minor — extracted text may have entity codes instead of readable characters.

**Fix:** Add HTML entity decoding (e.g., `DOMParser` or a simple decode function).

---

## Not Found (Clean)

| Category | Status |
|----------|--------|
| Command injection | ✅ No execSync with user input |
| eval / Function() | ✅ No dynamic code execution |
| Path traversal | ✅ No user-controlled file paths |
| eval on fetched content | ✅ No eval on HTTP responses |
| Credential handling | ✅ No credentials stored or transmitted |
| Unencrypted network | ✅ Only HTTPS (and HTTP) to user-specified URLs |

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 2 |
| 🟠 High | 3 |
| 🟡 Medium | 3 |
| 🟢 Low | 2 |
| **Total** | **10** |

### Top Priorities

1. **SSRF URL validation** — block `file://`, `gopher://`, `data:`, private IPs, cloud metadata endpoints
2. **Redirect loop limit** — max 5-10 redirects, validate each redirect target
3. **Cache eviction** — LRU with size limit (e.g., 50 entries or 10MB)
4. **Regex bounds** — add `{0,1024}` limits to `<[^>]*>` and `<table[\s\S]*?>` patterns
