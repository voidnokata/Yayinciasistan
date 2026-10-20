'use strict';
// Sender check for privileged runtime messages.
// Content scripts report the TikTok page URL in sender.url; extension documents
// (popup, panel, options) report chrome-extension:// URLs under the extension base.
function isExtensionPage(sender, extensionBase) {
  return typeof sender?.url === 'string'
    && typeof extensionBase === 'string'
    && extensionBase.length > 0
    && sender.url.startsWith(extensionBase);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { isExtensionPage };
