/* Direct, read-only Backstage eligibility probe. No copied tokens or signatures. */
(() => {
  const ENDPOINT = "https://live-backstage.tiktok.com/creators/live/union_platform_api/agency/union_invite/batch_check_anchor/";
  const TIMEOUT_MS = 12000;
  const fail = (code, error, extra = {}) => ({ ok: false, code, error, source: "direct-api", ...extra });

  function normalizeUsername(value) {
    if (typeof value !== "string") throw new Error("Bir TikTok kullanıcı adı yazın.");
    const username = value.trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9._]{1,24}$/.test(username)) {
      throw new Error("Yalnızca kullanıcı adını yazın; bağlantı veya boşluk eklemeyin.");
    }
    return username;
  }

  function interpret(payload, username) {
    if (Number.isInteger(payload?.BaseResp?.StatusCode) && payload.BaseResp.StatusCode !== 0) {
      return fail('API_ERROR', 'TikTok sorguya hata koduyla yanıt verdi; uygunluk belirlenmedi.', {
        apiStatus: payload.BaseResp.StatusCode
      });
    }
    if (!payload || !Number.isInteger(payload.status_code)) {
      return fail("INVALID_RESPONSE", "TikTok beklenen yanıt biçimini döndürmedi.");
    }
    if (payload.status_code !== 0) {
      return fail("API_ERROR", "TikTok sorguyu tamamlamadı. Oturum veya istek doğrulaması gerekebilir.", {
        apiStatus: payload.status_code
      });
    }
    const data = payload.data;
    if (!data || !Array.isArray(data.AnchorList)) {
      return fail("INVALID_RESPONSE", "Yanıtta yayıncı listesi bulunamadı.");
    }
    // Never trust the first result: a response must belong to the requested creator.
    const matches = data.AnchorList.filter(anchor =>
      typeof anchor?.UserBaseInfo?.DisplayID === "string" &&
      anchor.UserBaseInfo.DisplayID.toLowerCase() === username.toLowerCase()
    );
    if (data.AnchorList.length !== 1 || matches.length !== 1) {
      return fail("UNMATCHED_CREATOR", "Yanıt tek ve eşleşen bir yayıncı içermiyor; uygunluk belirlenmedi.", {
        apiStatus: 0, returnedCount: data.AnchorList.length
      });
    }
    const anchor = matches[0];
    const info = anchor.UserBaseInfo;
    // Deliberate allowlist: no raw response, avatar URLs, IDs, cookies or headers in diagnostics.
    const fields = {
      anchorStatus: Number.isInteger(anchor.AnchorStatus) ? anchor.AnchorStatus : null,
      displayReason: Number.isInteger(anchor.DisplayReason) ? anchor.DisplayReason : null,
      hasBricRisk: typeof anchor.HasBricRisk === "boolean" ? anchor.HasBricRisk : null,
      noPermission: typeof info.NoPermission === "boolean" ? info.NoPermission : null,
      isBanned: typeof data.IsBanned === "boolean" ? data.IsBanned : null
    };
    const extra = { apiStatus: 0, dataReceived: true, fields };
    if (Object.values(fields).some(value => value === null)) {
      return fail("INCOMPLETE_RESULT", "Uygunluğu yorumlamak için gerekli alanlar eksik.", extra);
    }
    if (fields.isBanned || fields.noPermission || fields.hasBricRisk) {
      return fail("REVIEW_REQUIRED", "Yanıtta kısıtlama veya risk işareti var; Backstage üzerinden kontrol edilmeli.", extra);
    }
    // Observed on 2026-09-10: yett.34, API (3, 2), UI 'Uygun değil / Başka bir ajansta'.
    // No positive enum is guessed. Unknown states must never authorize automated messaging.
    if (fields.anchorStatus === 3 && fields.displayReason === 2) {
      return { ok: true, source: "direct-api", eligible: false,
        reason: "Başka bir ajansta", ...extra };
    }
    return fail("UNKNOWN_STATUS", "Doğrudan yanıt alındı; bu durum kodunun ekrandaki karşılığı henüz doğrulanmadı.", extra);
  }

  function summarizeResponse(body) {
    // Describe structure, never copy server strings, HTML, headers, identifiers or unknown keys.
    const text = typeof body === 'string' ? body : '';
    const result = { characterCount: text.length, format: 'text' };
    if (!text.trim()) return { ...result, format: 'empty' };
    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      return { ...result, format: /^\s*(?:<!doctype\s+html|<html\b)/i.test(text) ? 'html' : 'non-json',
        hasHTMLTags: /<(?:html|head|body|script|form)\b/i.test(text) };
    }
    result.format = 'json';
    const known = new Set(['status_code', 'statusCode', 'StatusCode', 'code', 'Code', 'status', 'Status',
      'error_code', 'ErrorCode', 'errorCode', 'errno', 'err_no', 'ret', 'ret_code',
      'data', 'Data', 'result', 'Result', 'BaseResp', 'base_resp', 'extra', 'Extra',
      'message', 'Message', 'msg', 'Msg', 'error', 'Error', 'error_msg', 'status_msg', 'StatusMessage',
      'prompts', 'detail', 'description', 'verify', 'verify_data', 'VerifyInfo', 'captcha',
      'AnchorList', 'AnchorStatus', 'DisplayReason', 'HasBricRisk', 'IsBanned', 'DontHaveInviteBenefit']);
    const numericCodes = new Set(['status_code', 'statusCode', 'StatusCode', 'code', 'Code', 'status', 'Status',
      'error_code', 'ErrorCode', 'errorCode', 'errno', 'err_no', 'ret', 'ret_code']);
    const messageFields = new Set(['message', 'Message', 'msg', 'Msg', 'error', 'Error', 'error_msg',
      'status_msg', 'StatusMessage', 'prompts', 'detail', 'description']);
    const describe = (value, key, depth) => {
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      const info = { type };
      if (type === 'array') info.length = value.length;
      if (numericCodes.has(key) && (type === 'number' || type === 'string') &&
          /^-?\d{1,10}$/.test(String(value)) && Number.isSafeInteger(Number(value))) info.numericCode = Number(value);
      if (type === 'string') {
        info.length = value.length;
        if (messageFields.has(key)) {
          const hints = [];
          for (const [category, pattern] of [
            ['login-or-session', /log[ -]?in|session|not logged|oturum/i],
            ['authorization', /unauthori[sz]ed|forbidden|permission|access denied/i],
            ['signature-or-token', /signature|sign error|invalid sign|token|csrf/i],
            ['verification', /captcha|verify|verification|challenge/i],
            ['request-format', /parameter|param error|invalid request|bad request|missing|required/i],
            ['rate-limit', /rate limit|too many|frequency|frequent/i]
          ]) if (pattern.test(value)) hints.push(category);
          info.hints = hints;
        }
      }
      if (type === 'object' && depth < 3) {
        const keys = Object.keys(value);
        info.fields = {};
        info.otherFieldCount = keys.filter(name => !known.has(name)).length;
        for (const name of keys) if (known.has(name)) info.fields[name] = describe(value[name], name, depth + 1);
      }
      return info;
    };
    result.structure = describe(parsed, '', 0);
    return result;
  }

  async function probe(rawUsername, fetchImpl = globalThis.fetch) {
    let username;
    try { username = normalizeUsername(rawUsername); }
    catch (error) { return fail("INVALID_USERNAME", error.message); }
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let httpStatus;
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST", credentials: "include", cache: "no-store", redirect: "manual",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ DisplayIDList: [username], RecommendDisplayIDList: [] }),
        signal: controller.signal
      });
      httpStatus = response.status;
      let result;
      if (response.type === "opaqueredirect" || (httpStatus >= 300 && httpStatus < 400)) {
        result = fail("REDIRECT", "TikTok başka bir sayfaya yönlendirdi. Backstage girişinizi kontrol edin.");
      } else if (!response.ok) {
        const error = httpStatus === 429
          ? "TikTok istek sınırına ulaşıldı. Bir süre sonra tekrar deneyin."
          : "TikTok doğrudan isteği kabul etmedi. Bu tek başına oturum veya imza nedenini ayırt etmez.";
        result = fail("HTTP_ERROR", error);
      } else {
        const body = await response.text();
        if (controller.signal.aborted) throw new Error("timeout");
        if (!body.trim()) result = fail("EMPTY_RESPONSE", "TikTok boş yanıt döndürdü; uygunluk belirlenmedi.");
        else if (body.length > 131072) result = fail("INVALID_RESPONSE", "Yanıt beklenenden büyük; uygunluk belirlenmedi.");
        else {
          let payload;
          try { payload = JSON.parse(body); } catch { /* HTML/login responses are not eligibility results. */ }
          result = { ...interpret(payload, username), responseSummary: summarizeResponse(body) };
        }
      }
      return { ...result, username, httpStatus, elapsedMs: Date.now() - started };
    } catch {
      return fail(controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
        controller.signal.aborted ? "Doğrudan sorgu 12 saniyede tamamlanmadı."
          : "Doğrudan bağlantı kurulamadı. Ağ, oturum veya tarayıcı erişim koşulları kontrol edilmeli.",
        { username, ...(httpStatus === undefined ? {} : { httpStatus }), elapsedMs: Date.now() - started });
    } finally {
      clearTimeout(timer);
    }
  }

  const api = { ENDPOINT, normalizeUsername, interpret, probe, summarizeResponse };
  globalThis.BTGBackstageAPI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
