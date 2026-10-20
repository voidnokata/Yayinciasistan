'use strict';
// Validates a reply from the local mobile bridge. The bridge must answer with an
// object whose `ok` field is a boolean; anything else is treated as not a bridge reply.
function bridgeReplyResult(payload, status) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.ok === 'boolean') return payload;
    return { ok: false, error: 'Mobil köprü bulunamadı' };
  }
  return { ok: false, error: `Mobil köprü geçersiz yanıt verdi (HTTP ${status}).` };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { bridgeReplyResult };
