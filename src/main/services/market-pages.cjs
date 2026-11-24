// Paging of the game's market lists (market:getMarketPlayers, market:getMyPlayerListings).
// The page size is the game's choice: 8 listings until 2026-11, 15 since (checked 2026-11-24:
// Luka Doncic APK, total 180 = 12 pages × 15). It is read off page 1 instead of being fixed,
// so a new size neither skips listings nor asks for empty pages.

// Listings on one page: page 1's length when there are more listings than that; any
// smaller first page is the only page.
function pageSizeOf(first) {
  return Math.max(1, (first?.tickets || []).length);
}

// How many pages hold `first.total` listings (1 when page 1 already has them all).
function pageCount(first) {
  const n = (first?.tickets || []).length;
  const total = Number(first?.total);
  if (!n || !Number.isFinite(total) || total <= n) return 1;
  return Math.ceil(total / n);
}

// After reading `page` (its reply `data`, `read` listings so far, `size` from page 1): is this
// the last page? An empty or short page, or every listing of `total` read.
function isLastPage(data, page, size, read) {
  const n = (data?.tickets || []).length;
  if (!n) return true;
  if (page > 1 && n < size) return true;
  const total = Number(data?.total);
  if (data?.total == null || !(total > 0)) return false; // no total: the next page tells
  return read >= total;
}

module.exports = { pageSizeOf, pageCount, isLastPage };
