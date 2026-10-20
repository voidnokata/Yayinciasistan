// Tikleap Türkiye liglerindeki (A1–D5) tüm yayıncıları, o an canlı olup olmadıklarıyla okur.
// tikleap.com sekmesine enjekte edilip orada çalışır; Cloudflare çerezleri o sekmede geçerlidir.
(() => {
  const LEAGUES = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'b4', 'b5', 'c1', 'c2', 'c3', 'c4', 'c5', 'd1', 'd2', 'd3', 'd4', 'd5'];
  const CONCURRENCY = 3;
  const MAX_TRIES = 3;
  const CHALLENGE_TITLE = /moment|dakika|cloudflare|attention/i;

  const decode = text => String(text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();

  // Satırlar DOM yerine metinden okunur; böylece Node testlerinde de aynı kod çalışır.
  function parseLeagueHtml(html, league) {
    const text = String(html || '');
    const rows = [];
    const rowStart = /<a\b[^>]*class="([^"]*\branklist-table-row\b[^"]*)"[^>]*>/g;
    const starts = [...text.matchAll(rowStart)];
    starts.forEach((match, index) => {
      const end = index + 1 < starts.length ? starts[index + 1].index : text.length;
      const body = text.slice(match.index, end);
      const handle = decode(body.match(/class="[^"]*\branklist-handle\b[^"]*"[^>]*>([^<]*)</)?.[1]).replace(/^@/, '');
      if (!handle) return;
      const place = parseInt(decode(body.match(/class="[^"]*\branklist-place-number\b[^"]*"[^>]*>([^<]*)</)?.[1]), 10);
      rows.push({
        username: handle,
        league: String(league || '').toUpperCase(),
        rank: Number.isFinite(place) ? place : rows.length + 1,
        live: /\bis-live\b/.test(match[1])
      });
    });
    const title = decode(text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
    return {rows, challenge: !rows.length && CHALLENGE_TITLE.test(title)};
  }

  // Tüm lig yayıncıları kuyruğa girer: önce o an canlı olanlar (anlık yayın verisi yayın
  // bitmeden okunsun), sonra canlı olmayanlar. Her grup kendi içinde lig sırasına
  // (A1 → D5), lig içinde sıraya göre dizilir; aynı kişi iki ligde görünürse ilki kalır.
  function buildQueue(resultsByLeague, leagues = LEAGUES) {
    const seen = new Set();
    const queue = [];
    for (const wantLive of [true, false]) {
      for (const code of leagues) {
        const rows = (resultsByLeague[code] || []).filter(row => Boolean(row.live) === wantLive).sort((a, b) => a.rank - b.rank);
        for (const row of rows) {
          const key = row.username.toLocaleLowerCase('tr');
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({username: row.username, league: row.league, rank: row.rank, live: wantLive});
        }
      }
    }
    return queue;
  }

  async function readQueue(options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
    const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const leagues = options.leagues || LEAGUES;
    const results = {};
    const errors = {};
    let total = 0;

    async function readLeague(code) {
      let lastError = '';
      for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
        try {
          const response = await fetchImpl(`/country/tr/league/${code}`, {credentials: 'include', cache: 'no-store'});
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const parsed = parseLeagueHtml(await response.text(), code);
          if (parsed.rows.length) return parsed.rows;
          lastError = parsed.challenge ? 'Cloudflare doğrulaması' : 'tablo boş';
        } catch (error) {
          lastError = error?.message || String(error);
        }
        if (attempt < MAX_TRIES) await wait(800 * attempt);
      }
      throw new Error(lastError);
    }

    const pending = [...leagues];
    await Promise.all(Array.from({length: CONCURRENCY}, async () => {
      while (pending.length) {
        const code = pending.shift();
        try {
          results[code] = await readLeague(code);
          total += results[code].length;
        } catch (error) {
          errors[code] = error.message;
        }
      }
    }));
    const queue = buildQueue(results, leagues);
    return {queue, liveCount: queue.filter(item => item.live).length, total, errors};
  }

  const api = {LEAGUES, parseLeagueHtml, buildQueue, readQueue};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.BTGTikleap = api;
})();
