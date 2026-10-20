/* Single-visit assessment. Missing measurements are not zero measurements. */
(() => {
  const months = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
  const english = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function number(text) {
    const m = String(text || '').trim().match(/^([\d.,]+)\s*(K|M|B|bin|mn)?$/i);
    if (!m) return null;
    const suffix = (m[2] || '').toLowerCase();
    const value = suffix ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
    return Number.isFinite(value) ? value * ({k:1000,bin:1000,m:1000000,mn:1000000,b:1000000000}[suffix] || 1) : null;
  }
  function clock(text) {
    const m = text.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m || +m[2] > 59 || +m[1] > (m[3] ? 12 : 23) || (m[3] && +m[1] < 1)) return null;
    return (m[3] ? (+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0) : +m[1]) * 60 + +m[2];
  }
  function parseHistory(text, now = new Date()) {
    const normalized = String(text).replace(/\r/g, '').replace(/\u00a0/g, ' ');
    const history = normalized.split(/(?:^|\n)(?:Geçmiş|History|Past LIVE streams)\s*\n/i)[1];
    if (history === undefined) return { known: false, sessions: [] };
    const pattern = /(?:^|\n)(Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara|Jan|Feb|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\n(\d{1,2})\s*\n([\s\S]*?)(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*·\s*([\d.,]+\s*(?:K|M|B|bin|mn)?)\s*(?:beğeni|likes?)/gi;
    const sessions = [], seen = new Set();
    for (const m of history.matchAll(pattern)) {
      let month = months.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
      if (month < 0) month = english.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
      let date = new Date(now.getFullYear(), month, +m[2]);
      if (date > now) date.setFullYear(date.getFullYear() - 1);
      if (date.getMonth() !== month || date.getDate() !== +m[2]) continue;
      const start = clock(m[4]), end = clock(m[5]), likes = number(m[6]);
      if (start === null || end === null || likes === null) continue;
      const key = `${date.getTime()}:${start}:${end}:${m[3].trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sessions.push({day: date.getTime(), start, end: end < start ? end + 1440 : end, likes});
    }
    // An unrecognised/empty panel is missing data, not proof of no past broadcasts.
    return {known: sessions.length > 0, sessions};
  }
  function median(values) {
    if (!values.length) return null;
    const a = [...values].sort((a,b)=>a-b), mid = Math.floor(a.length/2);
    return a.length % 2 ? a[mid] : (a[mid-1]+a[mid])/2;
  }
  function describe(metrics) {
    const strengths = [], weaknesses = [];
    const {followers, activeDays, medianLikes, fans} = metrics;
    if (followers !== null && followers >= 30000) strengths.push(followers >= 100000 ? 'Çok yüksek takipçi sayısı' : 'Yüksek takipçi sayısı');
    if (activeDays !== null && activeDays >= 6) strengths.push(activeDays >= 10 ? 'çok düzenli yayın' : 'düzenli yayın');
    if (medianLikes !== null && medianLikes >= 5000) strengths.push('yüksek geçmiş yayın beğenisi');
    if (fans !== null && fans >= 250) strengths.push('güçlü hayran kulübü');
    if (activeDays !== null && activeDays <= 3) weaknesses.push('seyrek yayın');
    if (followers !== null && followers < 1000) weaknesses.push('düşük takipçi sayısı');
    if (medianLikes !== null && medianLikes < 1000) weaknesses.push('düşük geçmiş yayın beğenisi');
    const capitalize = s => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
    let sentence;
    if (strengths.length && weaknesses.length) sentence = `${capitalize(strengths[0])}, ancak ${weaknesses[0]}`;
    else if (strengths.length) sentence = strengths.slice(0,2).map((s,i)=>i ? s : capitalize(s)).join(' ve ');
    else if (weaknesses.length) sentence = weaknesses.slice(0,2).map((s,i)=>i ? s : capitalize(s)).join(' ve ');
    else sentence = activeDays !== null ? `Son 14 günde ${activeDays} aktif yayın günü; belirgin güçlü veya zayıf gösterge yok` : 'Değerlendirme için veri sınırlı';
    if (activeDays === null && (strengths.length || weaknesses.length)) sentence += '; yayın geçmişi okunamadı';
    return sentence + '.';
  }
  function assess({text = '', followerCount = null, viewers = null, now = new Date()} = {}) {
    const history = parseHistory(text, now);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate()-13);
    const recent = history.sessions.filter(s=>s.day >= cutoff.getTime() && s.day <= today.getTime());
    const days = new Set(recent.map(s=>s.day)); days.add(today.getTime()); // current LIVE
    // Merge overlapping fragments so reconnects do not inflate duration.
    let minutes = 0;
    for (const day of new Set(recent.map(s=>s.day))) {
      let end = -1;
      for (const s of recent.filter(s=>s.day===day).sort((a,b)=>a.start-b.start)) {
        minutes += Math.max(0, s.end - Math.max(s.start,end)); end = Math.max(end,s.end);
      }
    }
    const fanMatch = text.match(/(?:Hayran Kulübü|Fan Club)\s*\n\s*([\d.,]+\s*(?:K|M|bin)?)/i);
    const fans = fanMatch ? number(fanMatch[1]) : null;
    const likes = median(recent.map(s=>s.likes));
    const metrics = {activeDays:history.known ? days.size : null, hours:history.known ? minutes/60 : null, medianLikes:likes, fans, followers:followerCount, viewers};
    const weights = {activeDays:35, medianLikes:25, fans:15, followers:10, hours:10, viewers:5};
    // Initial transparent thresholds; tune against agency-reviewed candidates.
    const targets = {activeDays:10, medianLikes:10000, fans:500, followers:20000, hours:20, viewers:100};
    let earned = 0, available = 0;
    for (const [key, weight] of Object.entries(weights)) {
      if (metrics[key] === null || !Number.isFinite(metrics[key])) continue;
      available += weight; earned += weight * Math.min(1, Math.max(0, metrics[key])/targets[key]);
    }
    const score = available ? Math.round(100*earned/available) : 0;
    const limited = available < 75;
    const strong = !limited && metrics.activeDays >= 7 && (likes >= 5000 || fans >= 250);
    const established = Number.isFinite(followerCount) && followerCount >= 30000;
    const nearZero = Number.isFinite(followerCount) && followerCount >= 0 && followerCount < 100 && score < 35
      && !(metrics.activeDays >= 6 || likes >= 1000 || fans >= 25 || viewers >= 20);
    const classId = established || (score >= 70 && strong) ? 3 : score >= 35 ? 2 : nearZero ? 0 : 1;
    const dayString = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const snapshot = {
      schema: 1, capturedAt: now.toISOString(), periodStart: dayString(cutoff), periodEnd: dayString(today),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      historyKnown: history.known, sessionCount: history.known ? recent.length : null,
      meanLikes: recent.length ? recent.reduce((sum,s)=>sum+s.likes,0)/recent.length : null,
      sessions: recent.map(s=>({date:dayString(new Date(s.day)),start:s.start,end:s.end,likes:s.likes})),
      source: '', coverageNote: 'Ekranda okunabilen geçmiş kayıtlar; tüm yayınların eksiksiz olduğu doğrulanmadı. Aktif gün sayısına mevcut canlı yayın dahildir; süre ve beğeni yalnız geçmiş kayıtlardır.'
    };
    return {classId, score, limited, coverage:available, metrics, snapshot, summary:describe(metrics), reason:`${classId}. sınıf · ${score} puan${nearZero ? ' · sıfıra yakın takipçi ve zayıf mevcut göstergeler' : ''}${established ? ' · 30 bin+ takipçi önceliği' : ''}${limited ? ' · veri sınırlı' : ''}`, version:4};
  }
  function activeDaysAllowed(assessment, enabled) {
    const days=assessment?.metrics?.activeDays;
    return !enabled || (Number.isFinite(days) && days >= 5);
  }
  const api = {number, clock, parseHistory, assess, describe, activeDaysAllowed, snapshotVersion:1};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.BTGTalent = api;
})();
