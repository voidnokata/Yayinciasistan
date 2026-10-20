const elements = {
  message: document.getElementById("message"),
  message2: document.getElementById("message2"),
  message3: document.getElementById("message3"),
  messageGroup: document.getElementById("messageGroup"),
  modeLive: document.getElementById("modeLive"),
  modeMobile: document.getElementById("modeMobile"),
  modeManual: document.getElementById("modeManual"),
  modeCollect: document.getElementById("modeCollect"),
  modePersonal: document.getElementById("modePersonal"),
  modeHint: document.getElementById("modeHint"),
  personalSourceOption: document.getElementById("personalSourceOption"),
  personalSource: document.getElementById("personalSource"),
  maxPerSessionField: document.getElementById("maxPerSessionField"),
  liveProfileMessageOption: document.getElementById("liveProfileMessageOption"),
  liveProfileMessaging: document.getElementById("liveProfileMessaging"),
  liveFollowerFilter: document.getElementById("liveFollowerFilter"),
  minFollowers: document.getElementById("minFollowers"),
  requireFiveActiveDays: document.getElementById('requireFiveActiveDays'),
  followerFilterInfo: document.getElementById("followerFilterInfo"),
  manualList: document.getElementById("manualList"),
  manualUsernames: document.getElementById("manualUsernames"),
  manualListInfo: document.getElementById("manualListInfo"),
  skipBackstageCheck: document.getElementById("skipBackstageCheck"),
  messageLabel: document.getElementById("messageLabel"),
  minDelayLabel: document.getElementById("minDelayLabel"),
  maxDelayLabel: document.getElementById("maxDelayLabel"),
  maxPerSessionLabel: document.getElementById("maxPerSessionLabel"),
  minDelay: document.getElementById("minDelay"),
  maxDelay: document.getElementById("maxDelay"),
  maxPerSession: document.getElementById("maxPerSession"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  statusText: document.getElementById("statusText"),
  activityText: document.getElementById("activityText"),
  timingText: document.getElementById("timingText"),
  statusDot: document.getElementById("statusDot"),
  sentCount: document.getElementById("sentCount"),
  sentCountLabel: document.getElementById("sentCountLabel"),
  skippedCount: document.getElementById("skippedCount"),
  failedCount: document.getElementById("failedCount"),
  failedStat: document.getElementById("failedStat"),
  historyCount: document.getElementById("historyCount"),
  exportHistoryButton: document.getElementById("exportHistoryButton"),
  importHistoryButton: document.getElementById("importHistoryButton"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  historyFileInput: document.getElementById("historyFileInput"),
  historyMessage: document.getElementById("historyMessage"),
  exportDiagnosticsButton: document.getElementById("exportDiagnosticsButton"),
  exportReportButton: document.getElementById("exportReportButton"),
  formError: document.getElementById("formError"),
  logs: document.getElementById("logs")
};

let personalizedMessages = {};
let personalizedFileName = '';
let usePersonalizedMessages = false;
// Özel Excel "Bilgilendirme Mesajı" sütunu taşıyorsa alıcılar ajansın mevcut yayıncılarıdır.
let existingCreatorNotice = false;
initialize();

function invitationDraft() {
  return {usePersonalizedMessages,messages:personalizedMessages,fileName:personalizedFileName,usernames:elements.manualUsernames.value,existingCreatorNotice};
}

document.getElementById('invitationButton').addEventListener('click', () => chrome.tabs.create({url:chrome.runtime.getURL('src/ui/invitations.html')}));
document.getElementById('standardListFile').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  elements.formError.textContent = ''; elements.startButton.disabled = true; event.target.disabled = true;
  document.getElementById('invitationFile').disabled = true;
  usePersonalizedMessages = false; personalizedMessages = {}; personalizedFileName = ''; existingCreatorNotice = false;
  elements.manualUsernames.value = ''; document.getElementById('invitationFile').value = '';
  document.getElementById('invitationFileInfo').textContent = ''; renderModeHint();
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Standart liste .xlsx dosyasını seçin.');
    const rows = await window.BTGSpreadsheetReader.readXlsxRows(await file.arrayBuffer());
    const names = window.BTGInvitations.readStandardList(rows);
    personalizedFileName = file.name; elements.manualUsernames.value = names.join('\n');
    await chrome.storage.local.set({invitationDraft:{usePersonalizedMessages:false,messages:{},fileName:file.name,usernames:elements.manualUsernames.value}});
    document.getElementById('invitationFileInfo').textContent = `${file.name}: ${names.length} kişi. Aşağıdaki ortak DM mesajı kullanılacak; 3. sınıflar bu listede yok.`;
  } catch (error) {
    elements.formError.textContent = error.message;
    await chrome.storage.local.set({invitationDraft:{usePersonalizedMessages:false,messages:{},fileName:'',usernames:''}});
  } finally { event.target.disabled = false; renderModeHint(); await refresh(); }
});
document.getElementById('invitationFile').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  elements.formError.textContent = ''; elements.startButton.disabled = true; event.target.disabled = true;
  document.getElementById('standardListFile').disabled = true;
  document.getElementById('standardListFile').value = '';
  // An unsuccessful replacement must never leave the previous recipients armed.
  usePersonalizedMessages = true; personalizedMessages = {}; personalizedFileName = ''; existingCreatorNotice = false;
  elements.manualUsernames.value = ''; renderModeHint();
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Özel davet .xlsx dosyasını seçin.');
    const rows = await window.BTGSpreadsheetReader.readXlsxRows(await file.arrayBuffer());
    const imported = window.BTGInvitations.readMessages(rows);
    personalizedMessages = imported.messages; personalizedFileName = file.name;
    existingCreatorNotice = imported.existingCreators === true;
    elements.manualUsernames.value = imported.usernames.join('\n');
    await chrome.storage.local.set({invitationDraft:invitationDraft()});
    document.getElementById('invitationFileInfo').textContent = existingCreatorNotice
      ? `${file.name}: ${imported.usernames.length} mevcut yayıncıya bilgilendirme mesajı. “Uygun değil” etiketi ve eski sohbet engel değil; aynı metni daha önce almış olan atlanır. ${imported.skipped} boş mesajlı satır alınmadı.`
      : `${file.name}: ${imported.usernames.length} kişiye özel mesaj. ${imported.skipped} boş mesajlı satır alınmadı.`;
  } catch (error) {
    elements.formError.textContent = error.message;
    await chrome.storage.local.set({invitationDraft:{messages:{},fileName:'',usernames:''}});
  } finally { event.target.disabled = false; renderModeHint(); await refresh(); }
});
document.getElementById('clearInvitationFile').addEventListener('click', async () => {
  usePersonalizedMessages = false; personalizedMessages = {}; personalizedFileName = ''; existingCreatorNotice = false;
  document.getElementById('invitationFile').value = ''; document.getElementById('invitationFileInfo').textContent = '';
  elements.manualUsernames.value = '';
  const stored = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({invitationDraft:null,settings:{...stored.settings,usePersonalizedMessages:false,personalizedMessages:{},existingCreatorNotice:false,listFileName:'',manualUsernamesText:'',listUsernames:[]}}); renderModeHint();
});

document.getElementById('teamPlanButton')?.addEventListener('click', () => {
  chrome.tabs.create({url: chrome.runtime.getURL('src/ui/team-plan.html')});
});
document.getElementById('outputFolderButton')?.addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('src/ui/output-folder.html')}));

for (const input of [elements.modeLive, elements.modeMobile, elements.modeManual, elements.modeCollect, elements.modePersonal]) {
  input.addEventListener("change", renderModeHint);
}

elements.minFollowers.addEventListener("input", renderModeHint);
elements.liveProfileMessaging.addEventListener("change", renderModeHint);
elements.personalSource.addEventListener("change", renderModeHint);

elements.manualUsernames.addEventListener("input", () => {
  renderManualListInfo();
  if (usePersonalizedMessages || personalizedFileName) chrome.storage.local.set({invitationDraft:invitationDraft()}).catch(error => {elements.formError.textContent = error.message;});
});
elements.skipBackstageCheck.addEventListener("change", renderModeHint);

elements.startButton.addEventListener("click", async () => {
  elements.formError.textContent = "";
  const settings = readSettings();
  const validation = validateSettings(settings);
  if (validation) {
    elements.formError.textContent = validation;
    return;
  }

  elements.startButton.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: "BTG_START", settings });
  if (!result?.ok) {
    elements.formError.textContent = result?.error || "Başlatılamadı.";
    elements.startButton.disabled = false;
  }
  await refresh();
});

elements.stopButton.addEventListener("click", async () => {
  elements.stopButton.disabled = true;
  try {
    await stopAndExportCollection();
  } catch (error) {
    elements.formError.textContent = elements.modePersonal.checked
      ? `${error.message || String(error)} Toplanan yayıncıları “Model notu” düğmesinden tekrar kaydedebilirsiniz.`
      : `${error.message || String(error)} Toplanan isimleri “Excel çıktısı” düğmesinden tekrar kaydedebilirsiniz.`;
  } finally {
    await refresh();
  }
});

async function stopAndExportCollection() {
  const stopped = await chrome.runtime.sendMessage({ type: "BTG_STOP" });
  if (!stopped?.ok) throw new Error(stopped?.error || "İşlem durdurulamadı.");
  if (stopped.collectionExportHandled) return;
  const report = await chrome.runtime.sendMessage({ type: "BTG_EXPORT_REPORT" });
  if (!report?.ok) throw new Error(report?.error || "Excel çıktısı hazırlanamadı.");
  if (report.mode === "collect" && report.rows?.length) {
    await window.BTGXlsxWriter.downloadNameCollection(report.rows);
  }
  if (report.mode === "personal" && report.count) {
    const saved = await chrome.runtime.sendMessage({ type: "BTG_EXPORT_PERSONAL" });
    if (!saved?.ok) throw new Error(saved?.error || "Model notu kaydedilemedi.");
  }
}

elements.exportHistoryButton.addEventListener("click", async () => {
  elements.historyMessage.textContent = "";
  const result = await chrome.runtime.sendMessage({ type: "BTG_EXPORT_HISTORY" });
  if (!result?.ok) {
    elements.historyMessage.textContent = result?.error || "Geçmiş dosyası hazırlanamadı.";
    return;
  }

  const blob = new Blob([JSON.stringify(result.data, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  try { await window.BTGOutput.save(`btg-denenmis-yayincilar-${new Date().toISOString().slice(0, 10)}.json`, blob); } catch(error) { elements.formError.textContent=error.message; return; }
  elements.historyMessage.textContent = `${result.data.total} yayıncının geçmiş dosyası çıktı klasörüne kaydedildi.`;
});

elements.importHistoryButton.addEventListener("click", () => {
  elements.historyFileInput.value = "";
  elements.historyFileInput.click();
});

elements.historyFileInput.addEventListener("change", async () => {
  const file = elements.historyFileInput.files?.[0];
  if (!file) return;
  elements.historyMessage.textContent = "";
  try {
    const data = JSON.parse(await file.text());
    const publishers = Array.isArray(data) ? data : data?.publishers;
    const result = await chrome.runtime.sendMessage({
      type: "BTG_IMPORT_HISTORY",
      publishers
    });
    if (!result?.ok) throw new Error(result?.error || "Geçmiş dosyası yüklenemedi.");
    elements.historyMessage.textContent =
      `${result.imported} yeni yayıncı eklendi; toplam ${result.count}.`;
    await refresh();
  } catch (error) {
    elements.historyMessage.textContent = error.message || "Geçersiz geçmiş dosyası.";
  }
});

elements.clearHistoryButton.addEventListener("click", async () => {
  if (!window.confirm("Denenmiş yayıncı geçmişinin tamamı silinsin mi?")) return;
  const result = await chrome.runtime.sendMessage({ type: "BTG_CLEAR_HISTORY" });
  if (!result?.ok) {
    elements.historyMessage.textContent = result?.error || "Geçmiş temizlenemedi.";
    return;
  }
  elements.historyMessage.textContent = "Denenmiş yayıncı geçmişi temizlendi.";
  await refresh();
});

elements.exportDiagnosticsButton.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "BTG_EXPORT_DIAGNOSTICS" });
  if (!result?.ok) {
    elements.formError.textContent = result?.error || "Tanılama dosyası hazırlanamadı.";
    return;
  }

  const blob = new Blob([JSON.stringify(result.data, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  try { await window.BTGOutput.save(`btg-tanilama-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, blob); } catch(error) { elements.formError.textContent=error.message; return; }
  elements.formError.textContent = "Tanılama dosyası çıktı klasörüne kaydedildi.";
});

elements.exportReportButton.addEventListener("click", async () => {
  elements.formError.textContent = "";
  const result = await chrome.runtime.sendMessage({ type: "BTG_EXPORT_REPORT" });
  if (!result?.ok) {
    elements.formError.textContent = result?.error || "Excel raporu hazırlanamadı.";
    return;
  }
  if (result.mode === "personal") {
    const saved = await chrome.runtime.sendMessage({ type: "BTG_EXPORT_PERSONAL" });
    elements.formError.textContent = saved?.ok
      ? `${saved.count} yayıncılık model notu çıktı klasörüne kaydedildi: ${saved.name}`
      : saved?.error || "Model notu kaydedilemedi.";
    return;
  }
  if (!Array.isArray(result.rows) || !result.rows.length) {
    elements.formError.textContent = "Rapora eklenecek tamamlanmış kontrol bulunmuyor.";
    return;
  }
  try {
    if (result.mode === "collect") await window.BTGXlsxWriter.downloadNameCollection(result.rows);
    else await window.BTGXlsxWriter.downloadReport(result.rows);
    elements.formError.textContent = `${result.rows.length} satırlık Excel çıktı klasörüne kaydedildi.`;
  } catch(error) { elements.formError.textContent=error.message || String(error); }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.runtime) {
    renderRuntime(changes.runtime.newValue || {});
  }
  if (areaName === "local" && changes.publisherHistory) {
    refresh();
  }
});

async function initialize() {
  await refresh(true);
  const stored = await chrome.storage.local.get('invitationDraft');
  if (stored.invitationDraft) {
    personalizedMessages = stored.invitationDraft.messages || {};
    personalizedFileName = stored.invitationDraft.fileName || '';
    usePersonalizedMessages = stored.invitationDraft.usePersonalizedMessages !== false;
    existingCreatorNotice = usePersonalizedMessages && stored.invitationDraft.existingCreatorNotice === true;
    elements.manualUsernames.value = stored.invitationDraft.usernames || '';
    document.getElementById('invitationFileInfo').textContent = usePersonalizedMessages ? `${personalizedFileName || 'Dosya bekleniyor'}: ${Object.keys(personalizedMessages).length} ${existingCreatorNotice ? 'mevcut yayıncıya bilgilendirme mesajı' : 'özel mesaj'} kayıtlı.` : `${personalizedFileName || 'Standart liste'}: ortak DM mesajı kullanılacak.`;
    renderModeHint();
  }
}

async function refresh(loadSettings = false) {
  const state = await chrome.runtime.sendMessage({ type: "BTG_GET_STATE" });
  if (!state?.ok) return;
  if (loadSettings) renderSettings(state.settings);
  renderRuntime(state.runtime);
  renderHistory(state.history);
}

function renderSettings(settings) {
  const mode = ["live", "mobile", "manual", "collect", "personal"].includes(settings.mode)
    ? settings.mode
    : "live";
  elements.modeLive.checked = mode === "live";
  elements.modeMobile.checked = mode === "mobile";
  elements.modeManual.checked = mode === "manual";
  elements.modeCollect.checked = mode === "collect";
  elements.modePersonal.checked = mode === "personal";
  elements.liveProfileMessaging.checked = settings.liveProfileMessaging === true;
  elements.personalSource.value = settings.personalSource === "tikleap" ? "tikleap" : "feed";
  elements.manualUsernames.value = String(settings.manualUsernamesText || "");
  elements.skipBackstageCheck.checked = false;
  personalizedMessages = settings.personalizedMessages || {};
  usePersonalizedMessages = settings.usePersonalizedMessages === true;
  existingCreatorNotice = usePersonalizedMessages && settings.existingCreatorNotice === true;
  personalizedFileName = settings.listFileName || '';
  renderModeHint();
  const messages = Array.isArray(settings.messages) && settings.messages.length
    ? settings.messages
    : [settings.message || ""];
  elements.message.value = messages[0] || "";
  elements.message2.value = messages[1] || "";
  elements.message3.value = messages[2] || "";
  elements.minFollowers.value = Number(settings.minFollowers || 0) > 0 ? settings.minFollowers : "";
  elements.requireFiveActiveDays.checked = settings.requireFiveActiveDays === true;
  elements.minDelay.value = settings.minDelaySeconds ?? 4;
  elements.maxDelay.value = settings.maxDelaySeconds ?? 7;
  elements.maxPerSession.value = settings.maxPerSession ?? 50;
  window.BTGPopupLayout?.refresh();
}

function renderRuntime(runtime) {
  const running = Boolean(runtime.running);
  const hasError = !running && Number(runtime.failed || 0) > 0;
  elements.statusText.textContent = runtime.status || "Hazır";
  elements.statusText.title = elements.statusText.textContent;
  elements.activityText.textContent = formatActivity(runtime);
  if (hasError) {
    const lastError = (runtime.logs || []).find(log => log.level === "error" && log.message);
    if (lastError) elements.activityText.textContent += ` • ${lastError.message}`;
  }
  elements.activityText.title = elements.activityText.textContent;
  elements.activityText.classList.toggle("error", hasError);
  elements.timingText.textContent = formatTimings(runtime.timings);
  elements.statusDot.className = `status-dot${running ? " running" : hasError ? " error" : ""}`;
  elements.sentCount.textContent = runtime.sent || 0;
  elements.skippedCount.textContent = runtime.skipped || 0;
  elements.failedCount.textContent = runtime.failed || 0;
  elements.failedStat?.classList.toggle("has-error", Number(runtime.failed || 0) > 0);
  const reportRowCount = Array.isArray(runtime.reportRows) ? runtime.reportRows.length : 0;
  const collectionRowCount = Array.isArray(runtime.collectionRows) ? runtime.collectionRows.length : 0;
  const personalRowCount = Array.isArray(runtime.personalRows) ? runtime.personalRows.length : 0;
  const personalMode = running ? runtime.mode === "personal" : elements.modePersonal.checked || runtime.mode === "personal";
  const collectionMode = !personalMode && (elements.modeCollect.checked || runtime.mode === "collect");
  const exportRowCount = personalMode ? personalRowCount : collectionMode ? collectionRowCount : reportRowCount;
  elements.exportReportButton.disabled = exportRowCount === 0;
  elements.exportReportButton.textContent = personalMode
    ? (exportRowCount ? `Model notu (${exportRowCount})` : "Model notu")
    : collectionMode
    ? (exportRowCount ? `Excel çıktısı (${exportRowCount})` : "Excel çıktısı")
    : (exportRowCount ? `Excel raporu (${exportRowCount})` : "Excel raporu");
  elements.sentCountLabel.textContent = collectionMode || personalMode ? "Toplandı" : "Gönderildi";
  elements.startButton.disabled = running;
  elements.stopButton.disabled = !running;
  elements.importHistoryButton.disabled = running;
  elements.clearHistoryButton.disabled = running;

  for (const input of [
    document.getElementById('standardListFile'),
    document.getElementById('invitationFile'),
    document.getElementById('clearInvitationFile'),
    elements.message,
    elements.message2,
    elements.message3,
    elements.modeLive,
    elements.modeMobile,
    elements.modeManual,
    elements.modeCollect,
    elements.modePersonal,
    elements.personalSource,
    elements.liveProfileMessaging,
    elements.manualUsernames,
    elements.skipBackstageCheck,
    elements.minFollowers,
    elements.requireFiveActiveDays,
    elements.minDelay,
    elements.maxDelay,
    elements.maxPerSession
  ]) {
    input.disabled = running;
  }
  renderLogs(runtime.logs || []);
  window.BTGPopupLayout?.refresh();
}

function formatActivity(runtime) {
  if (!runtime?.lastActivityAt) return "";
  const time = new Date(runtime.lastActivityAt);
  const formattedTime = Number.isNaN(time.getTime())
    ? ""
    : time.toLocaleTimeString("tr-TR");
  const step = runtime.lastStep || "";
  return [formattedTime ? `Son hareket ${formattedTime}` : "", step]
    .filter(Boolean)
    .join(" • ");
}

// Son yayıncının aşama süreleri ve son 10 yayıncının ortalaması.
function formatTimings(timings) {
  if (!Array.isArray(timings) || !timings.length) return "";
  const last = timings[timings.length - 1] || {};
  const recent = timings.slice(-10);
  const average =
    recent.reduce((sum, item) => sum + Number(item?.total || 0), 0) / recent.length;
  const phases = Object.entries(last.phases || {})
    .filter(([, ms]) => Number(ms) >= 100)
    .map(([name, ms]) => {
      const breakdown = Object.entries(last.details?.[name] || {})
        .filter(([, value]) => Number(value) >= 100)
        .map(([key, value]) => `${key} ${formatSeconds(value)}`)
        .join(", ");
      return `${name} ${formatSeconds(ms)}${breakdown ? ` [${breakdown}]` : ""}`;
    })
    .join(" · ");
  const label = last.username ? `@${last.username}` : "Son yayıncı";
  return (
    `${label}: ${formatSeconds(last.total)} sn${phases ? ` (${phases})` : ""}` +
    ` • son ${recent.length} yayıncı ortalama ${formatSeconds(average)} sn`
  );
}

function formatSeconds(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toLocaleString("tr-TR", {
    maximumFractionDigits: 1
  });
}

function renderHistory(history) {
  elements.historyCount.textContent = Number(history?.count || 0);
}

function renderLogs(logs) {
  if (!logs.length) {
    elements.logs.innerHTML = '<p class="empty">Henüz işlem yok.</p>';
    return;
  }

  elements.logs.replaceChildren(
    ...logs.slice(0, 30).map((log) => {
      const row = document.createElement("div");
      row.className = `log ${log.level || "info"}`;

      const dot = document.createElement("span");
      dot.className = "log-dot";

      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = log.username ? `@${log.username}` : "Sistem";
      const detail = document.createElement("span");
      detail.textContent = log.message || "";
      content.append(title, detail);
      row.append(dot, content);
      return row;
    })
  );
}

function readSettings() {
  const mode = elements.modeManual.checked
    ? "manual"
    : elements.modeCollect.checked
      ? "collect"
    : elements.modePersonal.checked
      ? "personal"
    : elements.modeMobile.checked
      ? "mobile"
      : "live";
  return {
    mode,
    message: readMessageVariants().find(Boolean) || "",
    messages: readMessageVariants(),
    liveProfileMessaging: ["live", "manual"].includes(mode) && elements.liveProfileMessaging.checked,
    minFollowers: elements.minFollowers.value.trim() === "" ? 0 : Number(elements.minFollowers.value),
    requireFiveActiveDays: elements.requireFiveActiveDays.checked,
    personalSource: mode === "personal" && elements.personalSource.value === "tikleap" ? "tikleap" : "feed",
    minDelaySeconds: Number(elements.minDelay.value),
    maxDelaySeconds: Number(elements.maxDelay.value),
    maxPerSession: Number(elements.maxPerSession.value),
    listUsernames: mode === "manual"
      ? window.BTGManualListParser.parse(elements.manualUsernames.value).valid
      : [],
    listFileName: mode === 'manual' && usePersonalizedMessages ? personalizedFileName : '',
    usePersonalizedMessages: mode === 'manual' && usePersonalizedMessages,
    personalizedMessages: mode === 'manual' && usePersonalizedMessages ? personalizedMessages : {},
    existingCreatorNotice: mode === 'manual' && usePersonalizedMessages && existingCreatorNotice,
    manualUsernamesText: elements.manualUsernames.value,
    skipBackstageCheck: false
  };
}

function renderModeHint() {
  const manualMode = elements.modeManual.checked;
  const liveMode = elements.modeLive.checked;
  const collectMode = elements.modeCollect.checked;
  const personalMode = elements.modePersonal.checked;
  const gatheringMode = collectMode || personalMode;
  document.getElementById('invitationTools').hidden = !collectMode;
  document.getElementById('clearInvitationFile').hidden = !usePersonalizedMessages;
  document.getElementById('collectActiveDaysFilter').hidden = !gatheringMode;
  const tikleapSource = personalMode && elements.personalSource.value === "tikleap";
  elements.personalSourceOption.hidden = !personalMode;
  elements.maxPerSessionField.hidden = tikleapSource;
  elements.liveFollowerFilter.hidden = !(liveMode || gatheringMode);
  elements.liveProfileMessageOption.hidden = !(liveMode || manualMode);
  document.getElementById("manualBackstageInfo").textContent = usePersonalizedMessages && existingCreatorNotice
    ? "Backstage “Anlık mesajlar” sekmesi açık olmalıdır. Bilgilendirme mesajında “Uygun değil” etiketi ve eski sohbet engel değildir; aynı metni daha önce almış hesaplar atlanır."
    : elements.liveProfileMessaging.checked
    ? "Backstage “İlişkiyi yönet” sekmesi açık olmalıdır; mesaj TikTok profilinden gönderilir. Uygun olmayan ve geçmişte işlenen hesaplar atlanır."
    : "Backstage “Anlık mesajlar” sekmesi açık olmalıdır. Uygun olmayan ve geçmişte işlenen hesaplar atlanır.";
  elements.manualList.hidden = !manualMode;
  elements.messageLabel.hidden = gatheringMode || (manualMode && usePersonalizedMessages);
  elements.message.hidden = gatheringMode || (manualMode && usePersonalizedMessages);
  elements.messageGroup.hidden = elements.message.hidden;
  elements.minDelayLabel.hidden = gatheringMode;
  elements.maxDelayLabel.hidden = gatheringMode;
  elements.maxPerSessionLabel.textContent = personalMode ? "Toplanacak yayıncı sayısı" : collectMode ? "Toplanacak isim sayısı" : "Başarılı DM limiti";
  elements.sentCountLabel.textContent = gatheringMode ? "Toplandı" : "Gönderildi";
  window.BTGPopupLayout?.refresh();
  if (tikleapSource) {
    elements.modeHint.textContent =
      "Tikleap Türkiye liglerindeki (A1–D5) tüm yayıncıları alır; o an canlı olanlar önce işlenir ve anlık yayın verisi de toplanır, canlı olmayanlar profildeki yayın geçmişiyle devam eder. Backstage İlişkiyi yönet sihirbazında 30'arlı toplu kontrol edilir (davet gönderilmez). Uygun çıkanların profilini yeni sekmede açıp verileri toplar; liste bitince ya da durdurunca Sonnet/Haiku için tek model notu (.md) kaydeder. DM gönderilmez.";
    elements.followerFilterInfo.textContent = elements.minFollowers.value.trim()
      ? "Bu değerin altındaki yayıncılar Backstage kontrolü yapılmadan atlanır."
      : "Boş bırakırsanız minimum takipçi filtresi uygulanmaz.";
    return;
  }
  if (personalMode) {
    elements.modeHint.textContent =
      "Açık LIVE akışını kaydırır, yayıncıları Backstage Anlık mesajlar veya İlişkiyi yönet sayfasında kontrol eder. Uygun olanların yayın verilerini toplar; durdurunca ya da hedefe ulaşınca Sonnet/Haiku için model notu (.md) kaydeder. DM gönderilmez.";
    elements.followerFilterInfo.textContent = elements.minFollowers.value.trim()
      ? "Bu değerin altındaki yayıncılar Backstage kontrolü yapılmadan atlanır."
      : "Boş bırakırsanız minimum takipçi filtresi uygulanmaz.";
    return;
  }
  if (collectMode) {
    elements.modeHint.textContent =
      "Açık LIVE yayınındaki hesapları takipçi sayısına göre filtreler; Backstage'de uygun bulunanların ID ve takipçi sayısını Excel'e toplar.";
    elements.followerFilterInfo.textContent = elements.minFollowers.value.trim()
      ? "Bu değerin altındaki yayıncılar Backstage kontrolü yapılmadan atlanır."
      : "Filtre uygulanmaz; takipçi sayısı yine Excel çıktısı için okunur.";
    return;
  }
  if (manualMode) {
    elements.modeHint.textContent = elements.liveProfileMessaging.checked
      ? "İlişkiyi yönet sayfasında kullanıcı adını kontrol eder. “Uygun değil” olanları ve geçmişte işlenen/yazılan hesapları atlar; uygun hesaplara profillerine girerek DM gönderir."
      : "Anlık mesajlar sekmesinde kullanıcı adını arar. “Uygun değil” olanları ve geçmişte işlenen/yazılan hesapları atlar; uygun hesaplara DM gönderir.";
    renderManualListInfo();
    return;
  }
  if (liveMode) {
    elements.followerFilterInfo.textContent = elements.minFollowers.value.trim()
      ? "Takip\u00e7i say\u0131s\u0131 yay\u0131n ekran\u0131ndaki yay\u0131nc\u0131 kart\u0131ndan okunur; bu de\u011ferin alt\u0131nda kalan yay\u0131nc\u0131lar i\u00e7in Backstage kontrol\u00fc yap\u0131lmaz ve mesaj g\u00f6nderilmez. Bu hesaplar \u201cDenenmi\u015f yay\u0131nc\u0131lar\u201d listesine eklenir ve bir daha kontrol edilmez."
      : "Boş bırakırsanız minimum takipçi filtresi uygulanmaz.";
    elements.modeHint.textContent = elements.liveProfileMessaging.checked
      ? "Açık TikTok CANLI Yayın akışındaki yayıncıları Backstage üzerinde kontrol eder; uygun hesaplara profillerine girerek DM gönderir."
      : "Açık TikTok CANLI Yayın akışındaki yayıncıları Backstage Anlık mesajlar üzerinden kontrol eder ve mesajlar.";
    return;
  }
  if (elements.modeMobile.checked) {
    elements.modeHint.textContent =
      "BTG Mobil Yayıncı Asistanı köprüsünden telefondaki LIVE yayıncısının ID'sini alır. Web işlemi bitince telefonda sonraki yayına geçer.";
    return;
  }
  elements.modeHint.textContent = "Açık TikTok CANLI Yayın akışındaki yayıncıları sırayla işler.";
}

function renderManualListInfo() {
  const parsed = window.BTGManualListParser.parse(elements.manualUsernames.value);
  if (usePersonalizedMessages) {
    const missing = parsed.valid.filter(name => !Object.hasOwn(personalizedMessages,name.toLowerCase()) || !personalizedMessages[name.toLowerCase()]?.trim());
    elements.manualListInfo.classList.toggle('error', missing.length > 0 || parsed.invalid.length > 0);
    elements.manualListInfo.textContent = `${parsed.valid.length} ${existingCreatorNotice ? 'mevcut yayıncı; her kişiye Excel’deki kendi bilgilendirme mesajı gönderilecek' : 'kullanıcı; her kişiye Excel’deki kendi mesajı gönderilecek'}.${missing.length ? ` ${missing.length} kişi için mesaj eksik; başlatılamaz.` : ''}${parsed.invalid.length ? ' Geçersiz kullanıcı satırlarını düzeltin.' : ''}`;
    return;
  }
  elements.manualListInfo.classList.toggle("error", parsed.invalid.length > 0);
  if (!parsed.valid.length && !parsed.invalid.length) {
    elements.manualListInfo.textContent = "Her satıra bir TikTok kullanıcı adı girin; @ işareti isteğe bağlıdır.";
    return;
  }
  elements.manualListInfo.textContent = parsed.invalid.length
    ? `${parsed.valid.length} geçerli, ${parsed.invalid.length} geçersiz satır. Geçersiz satırlar işlenmez.`
    : `${parsed.valid.length} benzersiz kullanıcı adı hazır. Sıralama yukarıdan aşağıya korunacak.`;
}

function readMessageVariants() {
  return [elements.message, elements.message2, elements.message3].map((element) => element.value.trim());
}

function validateSettings(settings) {
  if (!Number.isInteger(settings.minFollowers) || settings.minFollowers < 0 || settings.minFollowers > 1000000000) {
    return "Minimum takipçi sayısı 0 ile 1.000.000.000 arasında bir tam sayı olmalı.";
  }
  if (settings.mode === 'manual' && settings.usePersonalizedMessages) {
    if (window.BTGManualListParser.parse(settings.manualUsernamesText).invalid.length) return 'Geçersiz kullanıcı satırlarını düzeltin.';
    const missing = settings.listUsernames.find(name => !Object.hasOwn(settings.personalizedMessages,name.toLowerCase()) || !settings.personalizedMessages[name.toLowerCase()]?.trim());
    if (missing) return `@${missing} için özel mesaj yok. Excel’i yeniden yükleyin veya kullanıcıyı listeden çıkarın.`;
    if (settings.existingCreatorNotice && settings.liveProfileMessaging) {
      return "Bilgilendirme mesajları yalnız Backstage Anlık mesajlar üzerinden gönderilir; “Mesajı profil üzerinden gönder” seçeneğini kapatın.";
    }
  }
  const gathering = settings.mode === "collect" || settings.mode === "personal";
  if (!gathering && !settings.usePersonalizedMessages && !settings.message) return "Hazır DM mesajı boş olamaz.";
  if (settings.mode === "manual" && !settings.listUsernames.length) {
    return "Listeden Kontrol modu için her satıra bir kullanıcı adı girin.";
  }
  if (!gathering && settings.minDelaySeconds < 2) return "En az bekleme 2 saniye olmalı.";
  if (!gathering && settings.maxDelaySeconds < settings.minDelaySeconds) {
    return "En fazla bekleme, en az beklemeden küçük olamaz.";
  }
  if (settings.maxPerSession < 1) return gathering
    ? settings.mode === "personal" ? "Toplanacak yayıncı sayısı en az 1 olmalı." : "Toplanacak isim sayısı en az 1 olmalı."
    : "Başarılı DM limiti en az 1 olmalı.";
  return "";
}


document.getElementById('backstageAPITestButton')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/backstage-api-test.html') });
});



(() => {
  const picker=document.getElementById('workspaceSelect');
  function workspace(mode,persist=true){const selected=mode==='feedback'?'feedback':'normal';picker.value=selected;document.getElementById('normalWorkspace').hidden=selected==='feedback';document.getElementById('feedbackWorkspace').hidden=selected!=='feedback';if(persist)chrome.storage.local.set({'btg.popup.workspace':selected}).catch(()=>{});}
  let changed=false;
  picker.addEventListener('change',()=>{changed=true;workspace(picker.value);});
  document.getElementById('weeklyStatusButton').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('src/ui/feedback.html?view=weekly')}));
  chrome.storage.local.get('btg.popup.workspace').then(saved=>{if(!changed)workspace(saved['btg.popup.workspace']||'normal',false);}).catch(()=>{});
})();

