(() => {
  if (window.__BTG_BACKSTAGE_ASSISTANT__) return;
  window.__BTG_BACKSTAGE_ASSISTANT__ = true;

  let busy = false;
  let busyOperation = null;
  let instantCandidate = null;
  // İki deneme × 6 sn, arka plandaki 20 sn Backstage yanıt süresinin içinde kalır.
  const INSTANT_SEARCH_ATTEMPTS = 2;
  const INSTANT_SEARCH_WAIT_MS = 6000;
  // Davet sihirbazı bir seferde en fazla 30 kullanıcı adı kabul ediyor (2026-10-08).
  const BATCH_CHECK_LIMIT = 30;
  const BATCH_RESULT_WAIT_MS = 25000;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BTG_BACKSTAGE_PING") {
      // Yenilemeden sonra sayfanın kontrol edilmeye hazır olduğunu doğrulamak için kullanılır.
      sendResponse({
        ok: true,
        ready: Boolean(findInviteEntryPoint()),
        busy,
        busyOperation,
        url: location.href
      });
      return;
    }

    if (!["BTG_BACKSTAGE_CHECK", "BTG_BACKSTAGE_BATCH_CHECK", "BTG_BACKSTAGE_SEND_DM"].includes(message?.type)) return;

    if (busy) {
      sendResponse({ ok: false, code: "BACKSTAGE_BUSY", busyOperation,
        error: "Backstage halen önceki kullanıcıyı kontrol ediyor." });
      return;
    }

    busy = true;
    busyOperation = message.type;
    const finish = (result) => {
      // Yanıt yeni kontrolü veya gönderimi başlatabilir; önce kilidi boşalt.
      busy = false;
      busyOperation = null;
      sendResponse(result);
    };
    Promise.resolve().then(() => (message.type === "BTG_BACKSTAGE_SEND_DM"
      ? sendInstantMessage(message.username, message.message, message.feedback === true, message.notice === true)
      : message.type === "BTG_BACKSTAGE_BATCH_CHECK"
        ? checkCreatorsBatch(message.usernames)
      : usesInstantMessageWorkflow(message.mode, message.liveProfileMessaging)
        ? checkInstantMessageCreator(message.username, message.feedback === true, message.notice === true)
        : checkCreator(message.username)))
      .then(finish, (error) => finish({ ok: false, error: error.message || String(error) }));
    return true;
  });

  async function checkCreator(username) {
    if (!location.hostname.startsWith("live-backstage.tiktok.com")) {
      throw new Error("Yanlış Backstage sayfası açık.");
    }

    let wizardRoot = findInviteWizardRoot();
    let input = findCreatorInput(wizardRoot);
    if (!input) {
      const inviteButton = findUniqueVisibleByExactText("İçerik üreticilerini davet edin", document);
      if (!inviteButton) {
        throw new Error(
          "“İçerik üreticilerini davet edin” düğmesi bulunamadı. İlişkiyi yönet sayfasını açın ve giriş durumunu kontrol edin."
        );
      }
      inviteButton.click();
      wizardRoot = await waitFor(findInviteWizardRoot, 10000, "Backstage davet kontrol ekranı açılmadı.");
      input = await waitFor(
        () => findCreatorInput(wizardRoot),
        10000,
        "Kullanıcı adı giriş alanı açılmadı."
      );
    }

    setNativeValue(input, username);
    await delay(150);

    wizardRoot = wizardRoot || findInviteWizardRoot();
    const nextButton = findUniqueVisibleByExactText("İleri", wizardRoot || document);
    if (!nextButton) {
      throw new Error("Backstage “İleri” düğmesi bulunamadı.");
    }
    nextButton.click();

    const result = await waitFor(
      () => findCreatorResult(username, wizardRoot || findInviteWizardRoot()),
      15000,
      `@${username} için Backstage sonucu zamanında gelmedi.`
    );

    const eligible = result.text.includes("Mevcut");
    const reason = eligible ? "Mevcut" : compactText(result.text).slice(0, 240);

    const backButton = await waitFor(
      () => findUniqueVisibleByExactText("Geri", wizardRoot || findInviteWizardRoot() || document),
      6000,
      "Sonuç ekranındaki “Geri” düğmesi bulunamadı."
    );
    backButton.click();

    await waitFor(
      () => findCreatorInput(wizardRoot || findInviteWizardRoot()),
      8000,
      "Backstage kullanıcı adı ekranına geri dönülemedi."
    );
    return { ok: true, eligible, reason };
  }

  // İlişkiyi yönet davet sihirbazında en fazla 30 kullanıcı adı tek seferde
  // kontrol edilir: 2. adımdaki listenin "Durum" sütunu okunur, ardından "Geri"
  // ile ilk adıma dönülür. Davet adımlarına (3–4) asla geçilmez.
  async function checkCreatorsBatch(rawUsernames) {
    if (location.pathname !== "/portal/anchor/relation") {
      throw new Error("Toplu kontrol için Backstage “İlişkiyi yönet” sayfasını açın.");
    }
    const usernames = [...new Set((Array.isArray(rawUsernames) ? rawUsernames : [])
      .map((value) => String(value || "").trim().replace(/^@/, ""))
      .filter((value) => /^[A-Za-z0-9._]{2,32}$/.test(value)))];
    if (!usernames.length || usernames.length > BATCH_CHECK_LIMIT) {
      throw new Error(`Toplu kontrol için 1–${BATCH_CHECK_LIMIT} geçerli kullanıcı adı gerekli.`);
    }

    let wizardRoot = findInviteWizardRoot();
    let input = findCreatorInput(wizardRoot);
    if (!input) {
      const inviteButton = findUniqueVisibleByExactText("İçerik üreticilerini davet edin", document);
      if (!inviteButton) {
        throw new Error("“İçerik üreticilerini davet edin” düğmesi bulunamadı. İlişkiyi yönet sayfasını açın ve giriş durumunu kontrol edin.");
      }
      inviteButton.click();
      wizardRoot = await waitFor(findInviteWizardRoot, 10000, "Backstage davet kontrol ekranı açılmadı.");
      input = await waitFor(() => findCreatorInput(wizardRoot), 10000, "Kullanıcı adı giriş alanı açılmadı.");
    }

    setNativeValue(input, usernames.join("\n"));
    await delay(250);
    wizardRoot = wizardRoot || findInviteWizardRoot();
    const nextButton = findUniqueVisibleByExactText("İleri", wizardRoot || document);
    if (!nextButton) throw new Error("Backstage “İleri” düğmesi bulunamadı.");
    nextButton.click();

    const results = {};
    const started = Date.now();
    // Arka plandaki sekmede zamanlayıcı bir dakika gecikebilir; süre dolsa da
    // son bir okuma yapılır.
    for (let expired = false; !expired; ) {
      expired = Date.now() - started >= BATCH_RESULT_WAIT_MS;
      const root = wizardRoot || findInviteWizardRoot();
      for (const username of usernames) {
        if (results[username]) continue;
        const status = readBatchStatus(username, root);
        if (status) results[username] = status;
      }
      if (Object.keys(results).length === usernames.length) break;
      if (!expired) await delay(200);
    }
    if (!Object.keys(results).length) {
      // Sonraki grup temiz başlasın diye sihirbaz mümkünse 1. adıma döndürülür.
      findUniqueVisibleByExactText("Geri", wizardRoot || findInviteWizardRoot() || document)?.click();
      throw new Error("Backstage toplu kontrol sonucu zamanında gelmedi.");
    }

    const backButton = await waitFor(
      () => findUniqueVisibleByExactText("Geri", wizardRoot || findInviteWizardRoot() || document),
      6000,
      "Sonuç ekranındaki “Geri” düğmesi bulunamadı."
    );
    backButton.click();
    await waitFor(() => findCreatorInput(wizardRoot || findInviteWizardRoot()), 15000, "Backstage kullanıcı adı ekranına geri dönülemedi.");

    for (const username of usernames) {
      if (!results[username]) results[username] = { eligible: false, unknown: true, reason: "Backstage sonucu okunamadı" };
    }
    return { ok: true, results };
  }

  // Satır metni yayıncının görünen adını da içerir; uygunluk yalnız "Durum" sütunundan okunur.
  function readBatchStatus(username, root) {
    const found = findCreatorResult(username, root);
    const row = found?.element?.closest?.("tr");
    if (!row || row.cells.length < 2) return null;
    const normalized = username.toLocaleLowerCase("tr");
    const statusPattern = /^(Mevcut|Uygun değil|Bulunamadı|Desteklenmeyen bölge)/;
    const cell = [...row.cells].find((item) => {
      const text = compactText(item.innerText || "");
      return statusPattern.test(text) && !text.toLocaleLowerCase("tr").includes(normalized);
    });
    if (!cell) return null;
    const status = compactText(cell.innerText || "");
    return { eligible: status.startsWith("Mevcut"), reason: status.slice(0, 160) };
  }

  function findMessageSearchInput() {
    return [...document.querySelectorAll('input[placeholder="İçerik üreticisi kullanıcı adı"]')].find(isVisible) || null;
  }

  function messageSearchPopup(input) {
    const id = input.getAttribute("aria-controls") || input.getAttribute("data-popupid");
    const popup = id ? document.getElementById(id) : null;
    return popup && isVisible(popup) ? popup : null;
  }

  function readMessageSearchResult(input, username, sawLoading) {
    if (!sawLoading || input.value !== username) return null;
    const popup = messageSearchPopup(input);
    if (!popup || /Yükleniyor|Loading/i.test(popup.innerText)) return null;
    const rows = [...popup.querySelectorAll('[data-id="backstage_search_result_item"]')].filter(isVisible);
    if (rows.length === 0) {
      // Uygun olmayan kart seçilebilir sonuç satırı olarak çizilmeyebilir; yalnız
      // semi-tag-content içindeki "Uygun değil" etiketi görünür. Bu taze sonuç
      // hata değil, atlanacak yayıncıdır.
      return hasIneligibleTag(popup) ? { ok: true, eligible: false, reason: "Uygun değil" } : null;
    }
    if (rows.length !== 1 || !compactText(rows[0].innerText)) return null;
    const row = rows[0];
    const blocked = hasIneligibleTag(row) || /Uygun değil|Not eligible|Ineligible/i.test(row.innerText);
    return { ok: true, eligible: !blocked, reason: blocked ? "Uygun değil" : "Anlık mesajlar arama sonucu uygun" };
  }

  function hasIneligibleTag(root) {
    const tag = /^(Tag: )?(Uygun değil|Not eligible|Ineligible)$/i;
    return [...root.querySelectorAll('[aria-label], [class*="semi-tag-content"]')].some(el =>
      tag.test(compactText(el.getAttribute?.("aria-label"))) ||
      (String(el.className || "").includes("semi-tag-content") && tag.test(compactText(el.textContent)))
    );
  }

  async function checkInstantMessageCreator(rawUsername, feedback = false, notice = false) {
    instantCandidate = null;
    if (location.pathname !== "/portal/anchor/instant-messages") {
      throw new Error("Bu akış için Backstage Anlık mesajlar sayfasını açın.");
    }
    const username = String(rawUsername || "").trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9._]{2,32}$/.test(username)) throw new Error("Geçersiz kullanıcı adı.");
    const input = findMessageSearchInput();
    if (!input) throw new Error("İçerik üreticisi kullanıcı adı arama alanı bulunamadı.");
    // Sonuç listesi odak kaybında kapanabilir veya arama hiç başlamayabilir.
    // Boş kalan arama kutu temizlenerek bir kez daha yapılır.
    let result = null;
    for (let attempt = 1; attempt <= INSTANT_SEARCH_ATTEMPTS && !result; attempt += 1) {
      result = await searchInstantMessageCreator(input, username);
    }
    if (!result) {
      return {
        ok: false,
        notFound: true,
        error: `@${username} için Backstage araması iki denemede sonuç göstermedi; mesaj gönderilmedi.`
      };
    }
    if (result.ok && (result.eligible || feedback || notice)) {
      instantCandidate = {
        username, feedback, notice, time: Date.now(),
        row: messageSearchPopup(input)?.querySelector('[data-id="backstage_search_result_item"]')
      };
    }
    if (notice && result.ok) {
      // Ajans yayıncısı davet için "Uygun değil" görünür; bilgilendirme için
      // yalnız tıklanabilir tekil sonuç kartı gerekir.
      const found = Boolean(instantCandidate?.row);
      return {
        ok: true,
        eligible: found,
        reason: !found
          ? "Arama sonucu tıklanabilir sohbet kartı göstermedi"
          : result.eligible ? "Anlık mesajlar sohbeti bulundu" : "Ajans yayıncısı (davet için Uygun değil) — bilgilendirme gönderilebilir"
      };
    }
    return result;
  }

  async function searchInstantMessageCreator(input, username) {
    // Önceki aramanın kartı yeni kullanıcı için uygunluk kanıtı değildir.
    input.click();
    setNativeValue(input, "");
    await delay(150);
    let sawLoading = false;
    const observeLoading = () => {
      const popup = messageSearchPopup(input);
      if (input.value === username && popup && /Yükleniyor|Loading/i.test(popup.innerText)) sawLoading = true;
    };
    const observer = new MutationObserver(observeLoading);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      // setNativeValue kutuya odaklanır, input/change olaylarını gönderir; ardından Enter.
      setNativeValue(input, username);
      await delay(50);
      for (const type of ["keydown", "keypress", "keyup"]) {
        input.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }
      return await waitFor(() => {
        observeLoading();
        // Odak kaydıysa liste kapanır; kutuya yeniden odaklanmak listeyi geri açar.
        if (!messageSearchPopup(input) && document.activeElement !== input) input.focus?.();
        return readMessageSearchResult(input, username, sawLoading);
      }, INSTANT_SEARCH_WAIT_MS, "").catch(() => null);
    } finally {
      observer.disconnect();
    }
  }

  function instantChatMatches(username) {
    const handles = [...document.querySelectorAll('[class*="hostInfo--"] [class*="handle--"]')].filter(isVisible);
    return handles.length === 1 && compactText(handles[0].innerText).toLowerCase() === `@${username.toLowerCase()}`;
  }

  function instantChatSurface() {
    const roots = [...document.querySelectorAll('.im-layout-content')].filter(isVisible);
    if (roots.length !== 1) return null;
    const root = roots[0];
    const input = root.querySelector('.im-input-container textarea');
    const button = root.querySelector('[data-id="backstage_IM_send_btn"]');
    const list = root.querySelector('[data-id="backstage_IM_messageList_container"]');
    return input && button && list && isVisible(input) && isVisible(button) ? {root, input, button, list} : null;
  }

  function instantOutgoing(list) {
    return [...list.querySelectorAll('.im-message-type-text-right')];
  }

  function instantMessageFailure(outgoing, expectedMessage = "") {
    if (!outgoing) return null;
    if (expectedMessage && compactText(outgoing.innerText) !== compactText(expectedMessage)) return null;
    const item = outgoing.closest('.im-message-item-layout');
    const error = item?.querySelector('.im-message-item-layout-message-error');
    const retry = item?.querySelector('[data-id="backstage_IM_error_resend_code"]');
    const detail = compactText(error?.innerText || error?.textContent || retry?.parentElement?.innerText || "");
    const visibleError = Boolean(error && isVisible(error) && detail);
    if (!retry && !visibleError) return null;
    return {
      unavailableReason: /askıya alındı|suspend(ed)?/i.test(detail)
        ? "account_suspended"
        : "message_rejected",
      failureDetail: detail.slice(0, 240)
    };
  }

  function existingInstantMessageResult(list) {
    const outgoing = instantOutgoing(list);
    for (const entry of outgoing) {
      const failure = instantMessageFailure(entry);
      if (failure) return {ok: true, unavailableSkipped: true, ...failure};
    }
    return outgoing.length ? {ok: true, alreadySent: true} : null;
  }

  async function assertInstantRunning(username, feedback = false, notice = false) {
    if (feedback) {
      const session = await chrome.runtime.sendMessage({type:"BTG_BACKSTAGE_FEEDBACK_ACTIVE", username});
      if (session?.active) return;
      throw new Error("Excel geri bildirim kuyruğu artık bu alıcı için etkin değil; mesaj gönderilmedi.");
    }
    const state = await chrome.runtime.sendMessage({type: "BTG_GET_STATE"});
    if (state?.runtime?.running &&
        usesInstantMessageWorkflow(state.runtime.mode, state.settings?.liveProfileMessaging) &&
        (!notice || (state.runtime.mode === "manual" && state.runtime.existingCreatorNotice === true))) return;
    throw new Error("Anlık mesajlar otomasyonu durduruldu; mesaj gönderilmedi.");
  }

  async function sendInstantMessage(rawUsername, rawMessage, feedback = false, notice = false) {
    const username = String(rawUsername || "").trim().replace(/^@/, "");
    const message = String(rawMessage || "").trim();
    const candidate = instantCandidate;
    instantCandidate = null; // Bir uygunluk sonucu yalnız bir gönderim denemesinde kullanılabilir.
    if (!message || location.pathname !== "/portal/anchor/instant-messages") throw new Error("Backstage mesaj metni veya sayfası geçersiz.");
    const search = findMessageSearchInput();
    const currentResult = search ? readMessageSearchResult(search, username, true) : null;
    // Geri bildirim ve mevcut yayıncı bilgilendirmesi ajansın kendi yayıncılarına
    // gider: davet uygunluğu aranmaz, var olan sohbete eklenebilir.
    const existingCreator = feedback || notice;
    if (!candidate || candidate.username !== username || Date.now() - candidate.time > 60000 ||
        Boolean(candidate.feedback) !== feedback || Boolean(candidate.notice) !== notice ||
        !candidate.row?.isConnected || !isVisible(candidate.row) ||
        !currentResult || (!existingCreator && !currentResult.eligible) ||
        messageSearchPopup(search)?.querySelector('[data-id="backstage_search_result_item"]') !== candidate.row) {
      throw new Error("Uygunluk sonucu değişti; gönderimden önce kullanıcı yeniden kontrol edilmeli.");
    }
    await assertInstantRunning(username, feedback, notice);
    candidate.row.click();
    await waitFor(() => instantChatMatches(username) && instantChatSurface(), 12000, "Seçilen Backstage sohbeti doğrulanamadı.");
    await delay(150);
    if (!instantChatMatches(username)) throw new Error("Sohbet değişti; mesaj gönderilmedi.");
    const surface = instantChatSurface();
    if (!surface) throw new Error("Backstage mesaj kutusu bulunamadı.");
    // İlk temas akışı mevcut sohbeti atlar. Excel geri bildirimi ve bilgilendirme
    // var olan sohbete eklenebilir; aynı metin veya açık teslim hatası yine engellenir.
    const previousResult = existingCreator
      ? existingFeedbackMessageResult(surface.list, message)
      : existingInstantMessageResult(surface.list);
    if (previousResult) return previousResult;
    if (surface.input.value.trim()) throw new Error("Mesaj kutusunda mevcut taslak var; üzerine yazılmadı.");
    setNativeValue(surface.input, message);
    await waitFor(() => !surface.button.disabled && surface.button.getAttribute("aria-disabled") !== "true", 4000, "Backstage Gönder düğmesi etkinleşmedi.");
    await assertInstantRunning(username, feedback, notice);
    if (!instantChatMatches(username) || instantChatSurface()?.input !== surface.input || surface.input.value !== message) {
      throw new Error("Sohbet veya taslak değişti; mesaj gönderilmedi.");
    }
    const concurrentResult = existingCreator
      ? existingFeedbackMessageResult(surface.list, message)
      : existingInstantMessageResult(surface.list);
    if (concurrentResult) {
      setNativeValue(surface.input, "");
      return concurrentResult;
    }
    const outgoingBeforeSend = instantOutgoing(surface.list);
    surface.button.click(); // Yeniden deneme yok: belirsiz sonuçta ikinci mesaj gönderilmez.
    const delivery = await waitFor(() => {
      if (!instantChatMatches(username)) throw new Error("Gönderim sırasında sohbet değişti; sonuç belirsiz.");
      const allOutgoing = instantOutgoing(surface.list);
      const outgoing = existingCreator ? allOutgoing.filter(el => !outgoingBeforeSend.includes(el)) : allOutgoing;
      const confirmed = !surface.input.value.trim() && outgoing.some(el =>
        compactText(el.innerText) === compactText(message) &&
        el.closest('.im-message-item-layout-message-content')?.querySelector('[class*="readStatusWrapper--"]')
      );
      if (confirmed) return {sent: true};
      for (const entry of outgoing) {
        const failure = instantMessageFailure(entry, message);
        if (failure) return {failed: true, ...failure};
      }
      return null;
    }, 8000, "Mesaj sohbet içinde doğrulanamadı; tekrar gönderilmedi. Backstage sohbetini kontrol edin.");
    if (delivery.failed) {
      return {
        ok: true,
        unavailableSkipped: true,
        unavailableReason: delivery.unavailableReason,
        failureDetail: delivery.failureDetail
      };
    }
    return {ok: true, sent: true};
  }

  function existingFeedbackMessageResult(list, expectedMessage) {
    const outgoing = instantOutgoing(list);
    for (const entry of outgoing) {
      const failure = instantMessageFailure(entry);
      if (failure) return {ok:true,unavailableSkipped:true,...failure};
    }
    if (outgoing.some(entry => compactText(entry.innerText) === compactText(expectedMessage))) {
      return {ok:true,alreadySent:true};
    }
    return null;
  }

  function findInviteEntryPoint() {
    if (!location.hostname.startsWith("live-backstage.tiktok.com")) return null;
    if (location.pathname === "/portal/anchor/instant-messages") return findMessageSearchInput();
    const wizardRoot = findInviteWizardRoot();
    return (
      findCreatorInput(wizardRoot) ||
      findUniqueVisibleByExactText("İçerik üreticilerini davet edin", document) ||
      null
    );
  }

  function usesInstantMessageWorkflow(mode, liveProfileMessaging = false) {
    // Kişisel mesaj yalnız uygunluk okur; açık olan Backstage sayfası kullanılır.
    if (mode === "personal") return location.pathname === "/portal/anchor/instant-messages";
    return ["manual", "live"].includes(mode) && !liveProfileMessaging;
  }

  function findInviteWizardRoot() {
    const titleMatches = [...document.querySelectorAll("body *")].filter((element) => {
      return (
        isVisible(element) &&
        element.children.length === 0 &&
        compactText(element.textContent || "") === "İçerik üreticilerini davet edin"
      );
    });

    for (const title of titleMatches) {
      let current = title.parentElement;
      for (let level = 0; level < 10 && current; level += 1, current = current.parentElement) {
        const text = compactText(current.innerText || "");
        if (
          text.includes("İçerik üreticileri ekleyin") &&
          text.includes("Daveti düzenle") &&
          text.includes("Ön izleme")
        ) {
          return current;
        }
      }
    }
    return null;
  }

  function findCreatorInput(root) {
    const scope = root || document;
    const candidates = [
      ...scope.querySelectorAll("textarea"),
      ...scope.querySelectorAll('input[type="text"]')
    ].filter(isVisible);

    return candidates.find((element) => {
      const placeholder = (element.getAttribute("placeholder") || "").toLocaleLowerCase("tr");
      const parentText = compactText(element.parentElement?.innerText || "").toLocaleLowerCase("tr");
      return (
        placeholder.includes("kullanıcı") ||
        parentText.includes("her satırda bir kullanıcı adı") ||
        parentText.includes("içerik üreticileri ekleyin")
      );
    }) || (candidates.length === 1 ? candidates[0] : null);
  }

  function findCreatorResult(username, root) {
    if (!root) return null;
    const normalized = username.toLocaleLowerCase("tr");
    const exactMatches = [...root.querySelectorAll("*")].filter((element) => {
      if (!isVisible(element) || element.children.length > 0) return false;
      const text = compactText(element.textContent || "").toLocaleLowerCase("tr");
      return text === normalized || text === `@${normalized}`;
    });

    for (const match of exactMatches) {
      let row = match.closest("tr");
      if (!row) {
        row = match;
        for (let level = 0; level < 7 && row?.parentElement; level += 1) {
          const text = compactText(row.innerText || "");
          if (
            text.toLocaleLowerCase("tr").includes(normalized) &&
            (text.includes("Mevcut") || text.length > username.length + 8)
          ) {
            break;
          }
          row = row.parentElement;
        }
      }
      const text = compactText(row?.innerText || "");
      if (text.toLocaleLowerCase("tr").includes(normalized) && text.length > username.length) {
        return { element: row, text };
      }
    }

    return null;
  }

  function findUniqueVisibleByExactText(text, root) {
    const scope = root || document;
    const matches = [...scope.querySelectorAll("button, [role='button'], a")].filter((element) => {
      return isVisible(element) && compactText(element.innerText || element.textContent || "") === text;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function setNativeValue(element, value) {
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  async function waitFor(factory, timeoutMs, errorMessage) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = factory();
      if (value) return value;
      await delay(125);
    }
    throw new Error(errorMessage);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
