// Isolated-world boundary: raw response stays in the Backstage tab.
(() => {
  if (location.origin !== 'https://live-backstage.tiktok.com') return;
  const headerPresence = raw => ({ factionId: raw?.factionId === true, appId: raw?.appId === true,
    language: raw?.language === true, csrf: raw?.csrf === true, secsdkCsrf: raw?.secsdkCsrf === true });
  const requestPage = (action, username, timeoutMs) => new Promise(resolve => {
    const id = crypto.randomUUID();
    const finish = result => {
      window.removeEventListener('message', receive);
      clearTimeout(timer);
      resolve(result);
    };
    const receive = event => {
      if (event.source === window && event.origin === location.origin &&
          event.data?.channel === 'BTG_PAGE_API_REPLY_V1' && event.data.id === id) finish(event.data);
    };
    const timer = setTimeout(() => finish({ code: 'PAGE_TIMEOUT' }), timeoutMs);
    window.addEventListener('message', receive);
    window.postMessage({ channel: 'BTG_PAGE_API_REQUEST_V1', id, action, username }, location.origin);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'BTG_PAGE_API_PING') {
      requestPage('ping', undefined, 500).then(result => sendResponse({
        ready: result.ready === true, contextReady: result.contextReady === true,
        headerPresence: headerPresence(result.headerPresence)
      }));
      return true;
    }
    if (message?.type !== 'BTG_PAGE_API_CHECK') return;
    check(message.username).then(sendResponse).catch(() => sendResponse({
      ok: false, source: 'page-api', code: 'PAGE_ERROR', error: 'Sayfa bağlamındaki sorgu tamamlanamadı.'
    }));
    return true;
  });

  async function check(value) {
    let username;
    try { username = BTGBackstageAPI.normalizeUsername(value); }
    catch { return { ok: false, code: 'INVALID_USERNAME', source: 'page-api', error: 'Geçerli bir kullanıcı adı yazın.' }; }
    const started = Date.now();
    const raw = await requestPage('check', username, 15000);
    const extras = { source: 'page-api', username, elapsedMs: Date.now() - started };
    extras.headerPresence = headerPresence(raw.headerPresence);
    if (Number.isInteger(raw.httpStatus)) extras.httpStatus = raw.httpStatus;
    if (['json', 'html', 'text', 'other', 'unknown'].includes(raw.contentKind)) extras.contentKind = raw.contentKind;
    if (typeof raw.body === 'string' && raw.body.length <= 131072) {
      extras.responseSummary = BTGBackstageAPI.summarizeResponse(raw.body);
    }
    if (raw.signatureFields) extras.signatureFields = {
      msToken: raw.signatureFields.msToken === true,
      xBogus: raw.signatureFields.xBogus === true,
      xGnarly: raw.signatureFields.xGnarly === true
    };
    const errors = {
      PAGE_TIMEOUT: 'Arka plan sayfasından zamanında yanıt gelmedi.',
      TIMEOUT: 'Sayfa bağlamındaki istek zaman aşımına uğradı.',
      REDIRECT: 'TikTok isteği başka bir sayfaya yönlendirdi. Girişinizi kontrol edin.',
      NETWORK_ERROR: 'Sayfa bağlamından ağ bağlantısı kurulamadı.',
      INVALID_RESPONSE: 'Sayfa beklenen yanıt biçimini döndürmedi.',
      BUSY: 'Sayfa önceki sorguyu tamamlıyor.',
      CONTEXT_NOT_READY: 'Backstage ajans ve oturum başlıkları henüz hazır değil.',
      ABORTED: 'İstek tamamlanmadan durdu.'
    };
    if (raw.code) {
      const code = Object.hasOwn(errors, raw.code) ? raw.code : 'INVALID_RESPONSE';
      return { ok: false, code, error: errors[code], ...extras };
    }
    if (!Number.isInteger(raw.httpStatus) || raw.httpStatus < 200 || raw.httpStatus >= 300) {
      return { ok: false, code: 'HTTP_ERROR', error: 'TikTok sayfa bağlamındaki isteği kabul etmedi.', ...extras };
    }
    if (typeof raw.body !== 'string' || raw.body.length > 131072) {
      return { ok: false, code: 'INVALID_RESPONSE', error: errors.INVALID_RESPONSE, ...extras };
    }
    if (!raw.body.trim()) return { ok: false, code: 'EMPTY_RESPONSE', error: 'Sayfa bağlamındaki istek de boş yanıt döndürdü.', ...extras };
    let payload;
    try { payload = JSON.parse(raw.body); } catch { /* Do not forward HTML or raw response. */ }
    return { ...BTGBackstageAPI.interpret(payload, username), ...extras };
  }
})();
