# Smart Scraper — Security Audit

**Date:** 2026-06-09  
**Auditor:** Jarvis (automated audit)  
**Files:** `smart-scraper.js` (~15KB), `SKILL.md` (~5KB), `manifest.json` (~1KB)

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
| 🟡 Silent cache persistence | `--no-cache` flag + visible warning before caching | ✅ FIXED |
| 🟡 Manifest missing capabilities | `manifest.json` declares network, cache, file I/O permissions | ✅ FIXED |

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
| **Total** | **12** | **10 fixed, 2 low-risk noted** |

---

## Findings

### 🔴 CRITICAL

#### 1. SSRF — No URL Validation Before Fetch
**Severity:** Critical  
**Location:** `fetchPage()`  
**Issue:** The URL from `--extract <url>` is passed directly to `http.get()` / `https.get()` with no validation. Any URL scheme is accepted — `file://`, `http://localhost`, `https://169.254.169.254` (AWS metadata), `gopher://`, etc.

**Impact:** An agent or user could fetch internal services, cloud metadata endpoints, or local files via `file://` URLs.

**Fix:** Validate URL scheme (http/https only), reject private IP ranges, reject `file://`/`gopher://`/`data:` URLs.

---

#### 2. SSRF — Redirect Following Has No Loop Limit
**Severity:** Critical  
**Location:** `fetchPage()`  
**Issue:** Redirects are followed recursively with no maximum depth. A malicious URL that returns a redirect loop or a very long redirect chain will cause infinite recursion → stack overflow → DoS.

**Impact:** Denial of service via redirect loop. Also enables SSRF by redirecting to an internal IP after an initial external redirect.

**Fix:** Add a `redirectCount` parameter with a max of 5. Reject redirects to private/internal IP ranges.

---

### 🟠 HIGH

#### 3. Regex ReDoS — `<[^>]+>` Pattern
**Severity:** High (theoretical)  
**Location:** `stripHtml()`  
**Issue:** The pattern `<[^>]+>` is a classic ReDoS vector. While V8's regex engine handles it well in practice (negated classes don't backtrack), it's still a documented vulnerability class.

**Impact:** Theoretical DoS with crafted HTML input. Low practical risk with V8.

**Fix:** Replace with a bounded pattern: `/<[^>]{0,1024}>/g`

---

#### 4. Regex ReDoS — `<table[\s\S]*?</table>`
**Severity:** High  
**Location:** `parseHtml()`  
**Issue:** `<table[\s\S]*?</table>` uses non-greedy cross-line matching on unbounded input.

**Impact:** CPU exhaustion on pages with unclosed `<table>` tags in large documents.

**Fix:** Add a max character limit: `<table[\s\S]{0,500000}?</table>`

---

#### 5. Cache Grows Indefinitely — No Eviction
**Severity:** High  
**Location:** `extractFromUrl()`  
**Issue:** Cache entries are written to `cache.json` but never evicted.

**Impact:** Disk space exhaustion over time. Cache becomes slower as it grows.

**Fix:** Implement LRU eviction (max N entries or max size). Remove expired entries on each access.

---

### 🟡 MEDIUM

#### 6. No Rate Limiting / Request Throttling
**Severity:** Medium  
**Location:** `fetchPage()`  
**Issue:** No rate limiting between requests.

**Impact:** IP blocking, abuse detection, wasted bandwidth.

**Fix:** Add configurable delay between requests (e.g., 100ms default).

---

#### 7. User-Agent Spoofing
**Severity:** Medium  
**Location:** `fetchPage()`  
**Issue:** Uses a fake User-Agent which is easily detectable.

**Impact:** IP blocking, ToS violation.

**Fix:** Use a more realistic User-Agent or make it configurable.

---

#### 8. No Timeout on Redirect Resolution
**Severity:** Medium  
**Location:** `fetchPage()`  
**Issue:** The redirect `fetchPage()` call inherits no timeout.

**Impact:** Resource exhaustion, stuck requests.

**Fix:** Pass timeout to recursive calls.

---

#### 9. Silent Cache Persistence (Data Exfiltration)
**Severity:** Medium  
**Location:** `extractFromUrl()`  
**Issue:** Scraper silently stores parsed content on disk without disclosure or consent.

**Impact:** Cached files may contain sensitive page content, URLs, or metadata.

**Fix:** 
- Added `--no-cache` flag for privacy mode (no local storage)
- Added visible warning before caching: `⚠️ Caching page content to disk`
- Documented cache location and privacy implications in SKILL.md
- Cache is opt-in via `--no-cache` for sensitive material

---

#### 10. Manifest Missing Capability Declarations
**Severity:** Medium  
**Location:** Skill manifest  
**Issue:** No manifest.json declaring network access and caching permissions.

**Impact:** Agents cannot determine what permissions the skill requires before using it.

**Fix:** Created `manifest.json` with declared capabilities:
- Network: outbound http/https with SSRF protection
- Cache: location, limits, opt-out flag
- File I/O: read/write paths
- Security: validation settings

---

### 🟢 LOW

#### 11. JSON Parse — No Size Limit
**Severity:** Low  
**Location:** `loadJSON()`  
**Issue:** `JSON.parse()` has no size limit.

**Impact:** Minimal — the try/catch provides protection.

**Fix:** Add a max file size check before parsing.

---

#### 12. stripHtml Does Not Handle All HTML Entities
**Severity:** Low  
**Location:** `stripHtml()`  
**Issue:** `stripHtml()` removes script/style tags and strips remaining HTML tags, but does not decode HTML entities.

**Impact:** Minor — extracted text may have entity codes instead of readable characters.

**Fix:** Add HTML entity decoding.

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
| SSRF bypass | ✅ URL validation + redirect re-validation |
| Redirect loops | ✅ Max 5 redirects with validation |

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 0 |
| 🟡 Medium | 0 |
| 🟢 Low | 2 |
| **Total** | **12** |

### Current State

All critical and high-severity findings have been resolved. Medium-severity findings (silent cache persistence, missing manifest) have been addressed with:
- `--no-cache` flag for privacy mode
- Visible warnings before caching
- `manifest.json` with capability declarations
- Updated documentation

Low-severity findings are documented but not yet fixed (HTML entity decoding, JSON size limit).
