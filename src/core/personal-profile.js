/* Kişisel mesaj: uygun yayıncının herkese açık TikTok verilerini toplar ve model notu için özetler. */
(() => {
  const VERSION = 1;
  const TIMEOUT_MS = 8000;
  const TIME_ZONE = 'Europe/Istanbul';
  const DAY_MS = 86400000;
  // Yeniden bağlanma parçaları birleştirilir; çok kısa denemeler yayın sayılmaz.
  const MERGE_GAP_S = 600;
  const MIN_STREAM_S = 300;
  // Yayıncı kartı en fazla ~100 geçmiş kayıt döndürür; dolu liste 30 günü kapsamayabilir.
  const HISTORY_CAP = 100;
  const RANK_CAP = 99;
  const WEBCAST = 'https://webcast.tiktok.com/webcast';
  const GENERIC_TAGS = /^(fyp|fy|foryou|foryoupage|fypage|fypシ|keşfet|kesfet|keşfetteyiz|kesfetteyiz|keşfetbeniöneçıkar|viral|tiktok|trend|xyzbca|capcut)$/i;
  // JS büyük/küçük harf eşlemesi Türkçe İ'yi i saymaz; bu harf ayrıca yazıldı.
  const CONTACT_LINE = /(whats\s*app|telegram|[iİ]nstagram|snap\s*chat|discord|e-?posta|e-?mail|[iİ]leti[sş]im|contact|business|[iİ][sş]\s*birli[gğ]i|reklam|telefon|(?<![\p{L}\p{N}_])(?:wp|[iİ]g|[iİ]nsta|snap|dc|mail|tel)(?![\p{L}\p{N}_]))/iu;

  const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
  const dayLabelFormat = new Intl.DateTimeFormat('tr-TR', {timeZone: TIME_ZONE, day: 'numeric', month: 'long'});
  const clockFormat = new Intl.DateTimeFormat('tr-TR', {timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit'});
  const dayKey = ms => dayKeyFormat.format(new Date(ms));
  const dayLabel = ms => dayLabelFormat.format(new Date(ms));

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function seconds(value) {
    const n = finite(value);
    if (!n || n <= 0) return null;
    return n > 1e12 ? Math.round(n / 1000) : n;
  }
  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }
  function cleanText(value, max = 200) {
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f​-‍⁠﻿]/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
  }
  // Biyografi ve açıklamalardan iletişim bilgisi, bağlantı ve başka hesap adları çıkarılır.
  function redact(value, max = 240) {
    const lines = String(value ?? '').split(/\r?\n/)
      .filter(line => !CONTACT_LINE.test(line))
      .map(line => line
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
        .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
        .replace(/\b[\w-]+\.(?:com|net|org|link|me|io|co|tr|app|bio|ly|gg)(?:\/\S*)?/gi, ' ')
        .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ')
        .replace(/@[A-Za-z0-9._]{2,}/g, ' '))
      .map(line => cleanText(line, max))
      .filter(Boolean);
    return cleanText(lines.join(' / '), max);
  }

  async function fetchJson(fetchImpl, url, timeoutMs) {
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { abort?.abort(); reject(new Error('zaman aşımı')); }, timeoutMs);
    });
    try {
      const response = await Promise.race([fetchImpl(url, {credentials: 'include', signal: abort?.signal}), timeout]);
      if (!response?.ok) throw new Error(`HTTP ${response?.status}`);
      const text = await Promise.race([response.text(), timeout]);
      const json = JSON.parse(text);
      const code = json?.status_code ?? json?.statusCode ?? 0;
      if (Number(code) !== 0) throw new Error(`kod ${code}`);
      return {text, json};
    } finally {
      clearTimeout(timer);
    }
  }

  // Yalnız profil ve takipçi: Backstage kontrolünden önce hızlı filtre için kullanılır.
  async function readBasics(username, options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
    const url = `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(username)}&sourceType=54`;
    const response = await fetchJson(fetchImpl, url, options.timeoutMs || TIMEOUT_MS);
    const data = response.json?.data;
    if (!data?.user || String(data.user.uniqueId || '').toLowerCase() !== String(username).toLowerCase()) {
      throw Object.assign(new Error('Profil yanıtı bu yayıncıya ait değil.'), {permanent: true});
    }
    // Uzun kimlikler JSON sayısı olarak gelirse hassasiyet kaybolur; ham metinden okunur.
    const rawId = typeof data.user.id === 'string' ? data.user.id : response.text.match(/"user"\s*:\s*\{[^]*?"id"\s*:\s*"?(\d{5,})/)?.[1];
    return {data, userId: /^\d+$/.test(String(rawId || '')) ? String(rawId) : '', followers: finite(data.stats?.followerCount)};
  }

  // TikTok kısa sürede çok istek gelirse birkaç saniye boş 403 döndürüyor
  // (2026-10-07 ölçümü, ~1 dk içinde düzeldi); başarısız istek beklenip yeniden denenir.
  async function withRetry(task, delays, wait) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await task(); }
      catch (error) {
        if (error?.permanent || attempt >= delays.length) throw error;
        await wait(delays[attempt]);
      }
    }
  }

  async function collect(username, options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
    const now = finite(options.now) ?? Date.now();
    const timeoutMs = options.timeoutMs || TIMEOUT_MS;
    const delays = Array.isArray(options.retryDelays) ? options.retryDelays : [3000, 8000];
    const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const missing = [];
    const load = (label, url) => withRetry(() => fetchJson(fetchImpl, url, timeoutMs), delays.slice(0, 1), wait)
      .catch(() => { missing.push(label); return null; });
    const basics = options.basics || await withRetry(() => readBasics(username, {fetch: fetchImpl, timeoutMs}), delays, wait).catch(() => null);
    if (!basics) return summarize({}, {username, now, missing: ['profil']});
    const user = basics.data.user;
    const userId = basics.userId;
    const roomId = /^\d+$/.test(String(user.roomId || '')) ? String(user.roomId) : '';
    const secUid = String(user.secUid || '');
    if (!roomId) missing.push('yayın bilgisi');
    const [room, card, audience, videos] = await Promise.all([
      roomId ? load('yayın bilgisi', `${WEBCAST}/room/info/?aid=1988&room_id=${roomId}`) : null,
      userId ? load('yayıncı kartı', `${WEBCAST}/anchor/live_dynamic/detail/?aid=1988&anchor_id=${userId}`) : null,
      roomId && userId ? load('izleyici sıralaması', `${WEBCAST}/ranklist/online_audience/?aid=1988&room_id=${roomId}&anchor_id=${userId}`) : null,
      secUid ? load('videolar', `https://www.tiktok.com/api/creator/item_list/?aid=1988&count=15&cursor=${now}&type=1&secUid=${encodeURIComponent(secUid)}`) : null
    ]);
    let cohost = null;
    const rival = room?.text.match(/"rival_anchor_id"\s*:\s*"?(\d{5,})/)?.[1];
    if (rival && rival !== userId && /"linker_map"\s*:\s*\{\s*"/.test(room.text)) {
      cohost = await load('eşli yayın', `${WEBCAST}/user/?aid=1988&target_uid=${rival}`);
    }
    return summarize({
      user: basics.data, room: room?.json?.data, card: card?.json?.data,
      audience: audience?.json?.data, videos: videos?.json, cohost: cohost?.json?.data, roomId
    }, {username, now, missing});
  }

  function summarizeLive(parts, now) {
    const room = parts.room || {};
    const liveRoom = parts.user?.liveRoom || {};
    const status = finite(room.status) ?? finite(liveRoom.status);
    const isLive = status === 2;
    const startS = seconds(liveRoom.startTime) ?? seconds(room.create_time);
    // Yayın kapalıyken room/info ve sıralama son (bitmiş) yayına aittir; anlık izleyici
    // ve hediye verisi okunmaz, yalnız son yayının kategori, oyun ve uğrayan sayısı kalır.
    const ranks = isLive && Array.isArray(parts.audience?.ranks) ? parts.audience.ranks : null;
    const scores = ranks ? ranks.map(rank => Math.max(0, finite(rank?.score) || 0)) : [];
    return {
      isLive,
      title: cleanText(room.title || liveRoom.title, 100),
      category: cleanText(room.hashtag?.title, 40),
      game: cleanText(room.game_tag?.[0]?.show_name, 60),
      minutesLive: isLive && startS ? Math.max(0, Math.round((now / 1000 - startS) / 60)) : null,
      viewersNow: isLive ? finite(room.user_count) : null,
      visitors: finite(room.stats?.total_user),
      rankedViewers: ranks ? (finite(parts.audience.total) ?? ranks.length) : null,
      gifters: ranks ? scores.filter(score => score > 0).length : null,
      giftersPartial: Boolean(ranks) && ranks.length >= RANK_CAP && scores.every(score => score > 0),
      coins: ranks ? scores.reduce((sum, score) => sum + score, 0) : null
    };
  }

  function summarizeHistory(list, {now, isLive, roomId}) {
    if (!Array.isArray(list)) return null;
    const raw = list
      .map(item => ({
        start: seconds(item?.start_time), end: seconds(item?.end_time),
        likes: Math.max(0, finite(item?.like_cnt) || 0), title: cleanText(item?.title, 80), roomId: String(item?.room_id ?? '')
      }))
      .filter(item => item.start && item.end && item.end > item.start && !(isLive && roomId && item.roomId === roomId))
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const item of raw) {
      const last = merged[merged.length - 1];
      if (last && item.start - last.end <= MERGE_GAP_S) {
        last.end = Math.max(last.end, item.end);
        last.likes += item.likes;
        if (!last.title) last.title = item.title;
      } else {
        merged.push({...item});
      }
    }
    const streams = merged.filter(stream => stream.end - stream.start >= MIN_STREAM_S);
    const nowS = now / 1000;
    const windowStart = nowS - 30 * 86400;
    const capped = list.length >= HISTORY_CAP;
    const oldest = raw.length ? raw[0].start : null;
    const coverageDays = capped && oldest && oldest > windowStart ? Math.max(1, Math.round((nowS - oldest) / 86400)) : 30;
    const recent = streams.filter(stream => stream.start >= windowStart);
    const activeDays = days => {
      const calendar = new Set();
      for (let i = 0; i < days; i += 1) calendar.add(dayKey(now - i * DAY_MS));
      const hit = new Set(recent.map(stream => dayKey(stream.start * 1000)).filter(key => calendar.has(key)));
      if (isLive) hit.add(dayKey(now));
      return hit.size;
    };
    const best = recent.reduce((top, stream) => !top || stream.likes > top.likes ? stream : top, null);
    const last = streams[streams.length - 1];
    return {
      records: list.length, capped, coverageDays,
      streams30: recent.length,
      days30: activeDays(30), days14: activeDays(14), days7: activeDays(7),
      avgMinutes: recent.length ? Math.round(average(recent.map(stream => (stream.end - stream.start) / 60))) : null,
      avgLikes: recent.length ? Math.round(average(recent.map(stream => stream.likes))) : null,
      lastStream: last ? dayLabel(last.start * 1000) : null,
      best: best ? {date: dayLabel(best.start * 1000), minutes: Math.round((best.end - best.start) / 60), likes: best.likes, title: best.title} : null
    };
  }

  function summarizeVideos(items, now) {
    if (!Array.isArray(items)) return null;
    const list = items.map(item => ({
      created: seconds(item?.createTime),
      plays: finite(item?.stats?.playCount ?? item?.statsV2?.playCount),
      likes: finite(item?.stats?.diggCount ?? item?.statsV2?.diggCount),
      desc: redact(item?.desc, 120),
      tags: Array.isArray(item?.textExtra)
        ? item.textExtra.map(tag => cleanText(tag?.hashtagName, 30).toLocaleLowerCase('tr-TR')).filter(tag => tag && !GENERIC_TAGS.test(tag))
        : []
    })).filter(video => video.created);
    const counts = new Map();
    for (const video of list) for (const tag of new Set(video.tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
    const latest = list.reduce((max, video) => Math.max(max, video.created), 0);
    // Eski videolar mesajda yeniymiş gibi anılmasın diye en çok izlenen yalnız son 30 günden seçilir.
    const best = list.filter(video => video.created >= now / 1000 - 30 * 86400)
      .reduce((top, video) => (video.plays || 0) > (top?.plays || 0) ? video : top, null);
    return {
      count: list.length,
      latestDate: latest ? dayLabel(latest * 1000) : null,
      posted30: list.filter(video => video.created >= now / 1000 - 30 * 86400).length,
      best: best?.plays ? {date: dayLabel(best.created * 1000), plays: best.plays, likes: best.likes, desc: best.desc} : null,
      hashtags: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag]) => tag)
    };
  }

  // Mesajda kullanılabilecek gözlemler; eşikler kasıtlı olarak açık ve sade tutuldu.
  function pickAngles(profile) {
    const angles = [];
    const live = profile.live || {};
    const history = profile.history || {};
    const longEnough = Number.isFinite(live.minutesLive) && live.minutesLive >= 30;
    const ratio = live.visitors > 0 && Number.isFinite(live.viewersNow) ? live.viewersNow / live.visitors : null;
    if (longEnough && live.visitors >= 300 && Number.isFinite(live.gifters) && live.gifters <= 3) angles.push('hediye');
    if (longEnough && live.visitors >= 500 && ratio !== null && ratio < 0.05) angles.push('trafik');
    if (live.viewersNow >= 100 && ((ratio !== null && ratio >= 0.1) || !longEnough)) angles.push('izleniyor');
    if (history.days30 >= 15 || history.days7 >= 5) angles.push('duzen');
    if (history.avgLikes >= 5000 && Number.isFinite(profile.followers) && profile.followers < 10000 && history.avgLikes >= 2 * profile.followers) angles.push('begeni_takipci');
    if (profile.videos?.best?.plays >= 10000) angles.push('video');
    if (profile.cohost?.username) angles.push('esli');
    return angles;
  }

  function pickNotes(profile) {
    const notes = [];
    if (!profile.live?.isLive) notes.push('Veri toplanırken yayın açık görünmedi; anlık izleyici verilerini kullanma.');
    else if (Number.isFinite(profile.live.minutesLive) && profile.live.minutesLive < 30) notes.push('Yayın yeni açılmıştı; ziyaretçi ve hediye sayıları henüz olgunlaşmadı.');
    if (profile.live?.giftersPartial) notes.push('İzleyici sıralaması sınırlı; hediye atan sayısı en az bu kadar.');
    if (profile.history?.capped && profile.history.coverageDays < 30) notes.push(`Yayın geçmişi ${profile.history.records} kayıtla sınırlı; yalnız son ${profile.history.coverageDays} günü kapsıyor.`);
    if (profile.missing.length) notes.push(`Okunamayan kaynaklar: ${profile.missing.join(', ')}.`);
    return notes;
  }

  function summarize(parts = {}, {username = '', now = Date.now(), missing = []} = {}) {
    const user = parts.user?.user || {};
    const live = summarizeLive(parts, now);
    const card = parts.card;
    const gallery = card?.live_dynamic_revenue_info?.live_dynamic_gift_gallery;
    const cohost = parts.cohost;
    const profile = {
      schema: VERSION,
      username,
      collectedAt: new Date(now).toISOString(),
      collectedLabel: `${dayLabel(now)} ${clockFormat.format(new Date(now))}`,
      nickname: cleanText(user.nickname, 60),
      followers: finite(parts.user?.stats?.followerCount),
      bio: redact(user.signature),
      live,
      card: card ? {
        about: redact(card.live_dynamic_anchor?.about_me, 200),
        fansClub: finite(card.live_dynamic_revenue_info?.live_dynamic_fans_club?.fans_club_count),
        giftsLit: finite(gallery?.lighted_gift_count),
        giftsTotal: finite(gallery?.total_gift_count)
      } : null,
      history: summarizeHistory(card?.live_dynamic_history_room_list, {now, isLive: live.isLive, roomId: parts.roomId}),
      videos: summarizeVideos(parts.videos?.itemList, now),
      cohost: cohost?.display_id ? {
        username: cleanText(cohost.display_id, 32),
        followers: finite(cohost.follow_info?.follower_count)
      } : null,
      missing: [...new Set(missing)]
    };
    profile.angles = pickAngles(profile);
    profile.notes = pickNotes(profile);
    return profile;
  }

  const api = {version: VERSION, readBasics, collect, summarize, redact, dayKey};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.BTGPersonalProfile = api;
})();
