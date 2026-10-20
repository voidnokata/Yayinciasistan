(() => {
  if (window.__BTG_TIKTOK_ASSISTANT__) return;
  window.__BTG_TIKTOK_ASSISTANT__ = true;

  // Profil sekmesi hiç açılmayan (geçmişte bulunan, geçme listesindeki,
  // takipçi filtresine takılan veya Backstage'de uygun çıkmayan) yayıncıdan
  // sonra kullanıcı ayarındaki uzun bekleme uygulanmaz; yalnız yayın geçişinin
  // yerleşmesi için kısa bir aralık bırakılır. Ayarlanan bekleme yalnız gerçekten
  // DM denemesi yapılan yayıncıdan sonra uygulanır.
  const SKIP_PACING_RANGE_MS = [600, 1200];
  // Kişisel mesaj: TikTok profil isteklerini boş 403 ile engelleyebiliyor ve engel
  // dakikalarca sürebiliyor. Veri okunamazsa artan sürelerle beklenip yeniden denenir;
  // yine okunamazsa boş kart yazılmaz, yayıncı atlanır. Üst üste bu kadar yayıncı
  // engele takılırsa koşu durdurulur ve o ana kadar toplananlar kaydedilir.
  const PERSONAL_PROFILE_RETRY_WAITS_MS = [45000, 90000, 180000];
  const PERSONAL_BLOCKED_STREAK_LIMIT = 2;
  // Profili yeni sekmede açıp veri toplamak TikTok'a çok istek gönderdiği için,
  // veri toplanan yayıncıdan sonra bir sonrakine geçmeden bu kadar beklenir.
  // (Ölçüm: 3 sn arayla toplama engellenmedi; 1 sn altı aralıkla engel geldi.)
  const PERSONAL_COLLECT_PACING_RANGE_MS = [4000, 7000];
  // Backstage davet sihirbazı bir seferde en fazla 30 kullanıcı adı kabul ediyor.
  const TIKLEAP_BATCH_SIZE = 30;
  // Arka plan toplu kontrolü, sihirbaz hatasında sekmeyi yenileyip 2 kez daha denediği için
  // en kötü durumda ~250 sn sürer; bu süre onun altında kalırsa taşma beklenmeyen hata olur.
  const BACKSTAGE_BATCH_TIMEOUT_MS = 290000;

  const controller = {
    running: false,
    settings: null,
    loopPromise: null,
    currentUsername: "",
    // Yayıncı kartı üst üste açılmazsa birkaç yayıncı boyunca kart yolu
    // atlanır (sayaç profil sekmesinden okunur), sonra kart yeniden denenir.
    liveCardFailures: 0,
    liveCardCooldown: 0,
    // Döngü neden bittiyse PING yanıtında görünür; yeni yüklenen bir kopya boş döner.
    exitReason: "",
    pageLoadedAt: Date.now()
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BTG_CONTROLLER_PING") {
      if (window.top !== window) return;
      sendResponse({ ok: true, running: controller.running, url: location.href,
        pageLoadedAt: controller.pageLoadedAt, exitReason: controller.exitReason,
        collectionDataVersion: window.BTGTalent?.snapshotVersion === 1 && window.BTGXlsxWriter?.collectionDataVersion === 1 ? 1 : 0,
        personalDataVersion: window.BTGPersonalProfile?.version === 1 ? 1 : 0 });
      return;
    }

    if (message?.type === "BTG_COLLECT_PERSONAL") {
      if (window.top !== window) return;
      if (window.BTGPersonalProfile?.version !== 1) {
        sendResponse({ ok: false, error: "Kişisel mesaj veri modülü bu sekmede yüklenmedi." });
        return;
      }
      window.BTGPersonalProfile.collect(message.username)
        .then((profile) => sendResponse({ ok: true, profile }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message?.type === "BTG_START_CONTROLLER") {
      if (window.top !== window) return;
      const requestedMode = message.settings?.mode;
      const mode = ["live", "foryou", "list", "mobile", "manual", "collect", "personal"].includes(requestedMode)
        ? requestedMode
        : "live";
      if (!isControllerPage(mode, message.settings?.liveProfileMessaging === true, message.settings?.personalSource)) {
        sendResponse({
          ok: false,
          error:
            mode === "list"
              ? "Bu sekme TikTok kontrol sayfası olarak kullanılamıyor."
              : mode === "manual"
                ? message.settings?.liveProfileMessaging === true
                  ? "Listeden Kontrol profil gönderimi bu sekmede çalışamıyor."
                  : "Listeden Kontrol için Backstage Anlık mesajlar sekmesini açın."
              : mode === "mobile"
                ? "Bu sekme mobil telefon akışı için kontrol sayfası olarak kullanılamıyor."
              : mode === "foryou"
                ? "Bu sekme TikTok Sizin İçin ana akışı değil."
                : mode === "collect"
                  ? "Bu sekme bir TikTok LIVE yayın sayfası değil."
                : "Bu sekme bir TikTok LIVE yayın sayfası değil."
        });
        return;
      }
      controller.settings = { ...message.settings, mode };
      controller.collectionExport = null;
      controller.collectionExportKey = '';
      controller.personalExport = null;
      controller.personalExportKey = '';
      controller.reloading = false;
      controller.running = true;
      controller.liveCardFailures = 0;
      controller.liveCardCooldown = 0;
      if (!controller.loopPromise) {
        controller.loopPromise = runController()
          .catch(reportUnexpectedControllerError)
          .finally(() => {
            controller.loopPromise = null;
          });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "BTG_STOP_CONTROLLER") {
      if (window.top !== window) return;
      controller.running = false;
      if (isNameCollectionMode()) {
        saveCollectedOnExit().then(() => sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));
        return true;
      }
      if (isPersonalMessageMode()) {
        savePersonalOnExit().then(() => sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));
        return true;
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "BTG_OPEN_PROFILE_MESSAGE") {
      if (window.top !== window) return;
      openProfileMessage(Boolean(message.needPoint))
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message?.type === "BTG_READ_FOLLOWER_COUNT") {
      if (window.top !== window) return;
      readProfileFollowerCount(message.username)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message?.type === "BTG_PROBE_DM_SURFACE") {
      const pageError = findMessagePageError();
      const composer = findDmComposer();
      const conversationUsername = findOpenConversationUsername();
      const targetMatches = usernamesMatch(conversationUsername, message.username);
      sendResponse({
        ok: true,
        hasComposer: Boolean(composer) && !pageError && targetMatches,
        pageError,
        conversationUsername,
        targetMatches,
        // Tanılama: hedef sohbet açılmadığında ekranda ne olduğu günlüğe yazılır.
        composerPresent: Boolean(composer),
        listPresent: Boolean(findDmConversationList()),
        listItems: countDmConversations(),
        route: describeDmRoute(),
        frameUrl: location.href
      });
      return;
    }

    if (message?.type === "BTG_RECOVER_DM_TARGET") {
      recoverDmTarget(message.userId, message.username)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({
            ok: false,
            applicable: true,
            error: error.message || String(error)
          })
        );
      return true;
    }

    if (message?.type === "BTG_SEND_PROFILE_DM") {
      sendProfileDm(message.message, message.username, message.knownMessages)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({
            ok: false,
            retryable: true,
            error: error.message || String(error)
          })
        );
      return true;
    }

    if (message?.type === "BTG_PREPARE_PROFILE_DM") {
      prepareProfileDmInput(message.message, message.username, Boolean(message.focus), message.knownMessages)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({
            ok: false,
            retryable: true,
            error: error.message || String(error)
          })
        );
      return true;
    }

    if (message?.type === "BTG_VERIFY_PROFILE_DM_TEXT") {
      sendResponse(verifyProfileDmText(message.message, message.username));
      return;
    }

    if (message?.type === "BTG_VERIFY_PROFILE_DM_SENT") {
      verifyProfileDmSent(message.message, message.username)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error.message || String(error)
          })
        );
      return true;
    }
  });

  async function runController() {
    if (isNameCollectionMode()) {
      try { await runNameCollectionController(); }
      finally { await saveCollectedOnExit(); }
      return;
    }
    if (isPersonalMessageMode()) {
      // Sekme yenilenip akış sürecekse not yazılmaz; kayıtlar depoda korunur.
      try { await runPersonalMessageController(); }
      finally { if (!controller.reloading) await savePersonalOnExit().catch(() => {}); }
      return;
    }
    if (isMobileMode()) {
      await runMobileController();
      return;
    }
    if (isListMode()) {
      await runListController();
      return;
    }

    await runtimePatch({ status: "Çalışıyor" });

    while (controller.running) {
      // Her yayıncı için aşama süreleri ölçülür; eklenti penceresinde ve
      // tanılama dosyasında hangi adımın ne kadar sürdüğü görülür.
      const timer = createPhaseTimer();
      let outcome = "";
      let attemptedDm = false;
      const username = getCurrentUsername();
      if (!username) {
        await stopWithError(
          isForYouMode()
            ? "Görünür videonun kullanıcı adı ana akıştan okunamadı."
            : "Canlı yayın kullanıcı adı URL’den okunamadı."
        );
        return;
      }

      const state = await getState();
      if (!state?.runtime?.running) {
        controller.running = false;
        return;
      }

      const successfulMessages = Number(state.runtime.sent || 0);
      if (successfulMessages >= Number(controller.settings.maxPerSession || 50)) {
        await finishNormally("Başarılı DM limiti tamamlandı");
        return;
      }

      const processed = Array.isArray(state.runtime.processed) ? state.runtime.processed : [];
      const seenThisSession = processed.some(
        (item) => item.username.toLocaleLowerCase("tr") === username.toLocaleLowerCase("tr")
      );
      const historyCheck = seenThisSession
        ? { found: true, messaged: true, sessionOnly: true }
        : await sendRuntimeMessageWithTimeout(
            {
              type: isForYouMode() ? "BTG_HISTORY_HAS" : "BTG_MESSAGE_HISTORY_HAS",
              username
            },
            15000,
            isForYouMode()
              ? "Kalıcı yayıncı geçmişi kontrolü yanıt vermedi."
              : "Mesaj gönderilmiş yayıncı geçmişi kontrolü yanıt vermedi."
          );

      timer.mark("geçmiş");
      const manualSkip = isManualSkipUsername(username);
      const alreadyChecked = Boolean(
        seenThisSession || (isForYouMode() ? historyCheck?.found : historyCheck?.messaged)
      );
      // CANLI Yayın modunda takipçi filtresi Backstage kontrolünden önce, yayın
      // ekranındaki yayıncı kartından uygulanır. Eşiği geçmeyen hesap için
      // Backstage sorgusu veya sohbet açılmaz; zaman kaybı ortadan kalkar.
      const followerGate =
        manualSkip || alreadyChecked ? { skip: false, count: null } : await applyLiveFollowerGate(username);
      timer.mark("takipçi");
      if (!controller.running) return;

      if (manualSkip) {
        outcome = "manual_skip";
        if (historyCheck?.found) {
          await runtimePatch(
            { currentUsername: username, status: `@${username} geçme listesinde` },
            {
              level: "skip",
              username,
              message: "Özel geçme listesinde — Backstage ve DM işlemleri yapılmadan atlandı"
            }
          );
        } else {
          await runtimePatch(
            {
              currentUsername: username,
              skipped: Number(state.runtime.skipped || 0) + 1,
              processed: [
                ...processed,
                { username, result: "manual_skip", time: new Date().toISOString() }
              ],
              status: `@${username} geçme listesinde; sonraki ${nextItemName()} geçiliyor`
            },
            {
              level: "skip",
              username,
              message: "Özel geçme listesinde — Backstage ve DM işlemleri yapılmadan atlandı"
            }
          );
        }
      } else if (alreadyChecked) {
        outcome = "history";
        await runtimePatch(
          {
            currentUsername: username,
            status: historyCheck.sessionOnly
              ? `@${username} bu oturumda daha önce işlendi`
              : isForYouMode()
                ? `@${username} daha önce kontrol edildi`
                : `@${username} daha önce mesaj almış`
          },
          {
            level: "info",
            username,
            message: historyCheck.sessionOnly
              ? "Bu oturumda daha önce işlendi — atlandı"
              : isForYouMode()
                ? "Kalıcı geçmişte bulundu — yeniden kontrol edilmeden atlandı"
                : "Mesaj gönderilmiş yayıncı geçmişinde bulundu — yeniden mesaj gönderilmedi"
          }
        );
      } else if (followerGate.skip) {
        // Kayıt ve günlük satırı applyLiveFollowerGate içinde yazıldı; burada
        // yalnız Backstage ve DM adımları atlanır.
        outcome = "low_followers";
      } else {
        await runtimePatch({
          currentUsername: username,
          status: `@${username} Backstage üzerinde kontrol ediliyor`
        });

        const eligibility = await sendRuntimeMessageWithTimeout(
          {
            type: "BTG_CHECK_ELIGIBILITY",
            username
          },
          70000,
          "Backstage uygunluk kontrolü 70 saniye içinde tamamlanmadı."
        );

        if (!eligibility?.ok) {
          await stopWithError(eligibility?.error || "Backstage uygunluk kontrolü başarısız.");
          return;
        }

        timer.mark("backstage");
        if (eligibility.transientSkipped) {
          const notFound = eligibility.transientResult === "backstage_not_found";
          outcome = notFound ? "backstage_not_found" : "backstage_timeout";
          const latest = await getState();
          const latestProcessed = Array.isArray(latest.runtime.processed) ? latest.runtime.processed : [];
          await runtimePatch(
            {
              skipped: Number(latest.runtime.skipped || 0) + 1,
              processed: [
                ...latestProcessed,
                // backstageChecked:false — sonraki oturumlarda yeniden aranabilir.
                { username, result: outcome, time: new Date().toISOString(), backstageChecked: false }
              ],
              status: notFound
                ? `@${username} Backstage aramasında bulunamadı; atlandı, sonraki ${nextItemName()} geçiliyor`
                : `@${username} Backstage zaman aşımı nedeniyle geçici olarak atlandı; sonraki ${nextItemName()} geçiliyor`
            },
            {
              level: "skip",
              username,
              message: eligibility.reason || "Backstage zaman aşımı — yayıncı geçici olarak atlandı"
            }
          );
        } else if (eligibility.eligible) {
          attemptedDm = true;
          const outreach = pickOutreachMessage(controller.settings);
          const profileDm = isForYouMode() || isLiveProfileMessaging();
          await runtimePatch({
            status: profileDm
              ? `@${username} uygun; profil üzerinden DM gönderiliyor`
              : `@${username} uygun; Backstage üzerinden DM gönderiliyor`
          });
          const dm = await sendRuntimeMessageWithTimeout(
            {
              type: "BTG_SEND_DM",
              username,
              message: outreach.text,
              // Sayaç yayın kartından okunduysa profil sekmesinde yeniden okunmaz;
              // yalnız okunamadığı durumda profil üzerinden yedek okuma yapılır.
              followerCount: followerGate.count
            },
            profileDm ? 420000 : 45000,
            profileDm
              ? "TikTok DM işlemi 7 dakika içinde tamamlanmadı."
              : "Backstage mesaj işlemi 45 saniye içinde tamamlanmadı."
          );
          timer.mark("dm");
          timer.detail("dm", dm?.timing);
          outcome = describeDmOutcome(dm);
          // Takipçi sayısı profil sekmesinden okunup eşiğin altında kalan hesapta
          // sohbet hiç açılmadı; uzun bekleme yerine kısa geçiş aralığı yeterlidir.
          if (dm?.ok && dm.followerSkipped) attemptedDm = false;

          const latest = await getState();
          const latestProcessed = Array.isArray(latest.runtime.processed) ? latest.runtime.processed : [];
          if (dm?.ok) {
            if (dm.followerSkipped) {
              const followerResult =
                dm.followerReason === "low_followers" ? "low_followers" : "follower_unknown";
              const followerLog =
                followerResult === "low_followers"
                  ? `Takipçi sayısı ${formatFollowerCount(dm.followerCount)}; en az ${formatFollowerCount(dm.minFollowers)} isteniyor — mesaj gönderilmeden atlandı`
                  : `Takipçi sayısı okunamadı (en az ${formatFollowerCount(dm.minFollowers)} isteniyor) — mesaj gönderilmeden atlandı${
                      dm.followerDetail ? `: ${dm.followerDetail}` : ""
                    }`;
              await runtimePatch(
                {
                  skipped: Number(latest.runtime.skipped || 0) + 1,
                  processed: [
                    ...latestProcessed,
                    {
                      username,
                      result: followerResult,
                      time: new Date().toISOString(),
                      backstageChecked: true,
                      followerCount:
                        typeof dm.followerCount === "number" && Number.isFinite(dm.followerCount)
                          ? dm.followerCount
                          : null,
                      minFollowers: Number(dm.minFollowers || 0)
                    }
                  ],
                  status: `@${username} takipçi filtresine uymadı; sonraki ${nextItemName()} geçiliyor`
                },
                {
                  level: "skip",
                  username,
                  message: followerLog
                }
              );
            } else if (dm.unavailableSkipped) {
              const unavailableReason = dm.unavailableReason || "dm_surface";
              const unavailableLog =
                unavailableReason === "account_suspended"
                  ? `Backstage hedef hesabın askıya alındığını bildirdi — mesaj yeniden denenmeden atlandı${
                      dm.failureDetail ? `: ${dm.failureDetail}` : ""
                    }`
                  : unavailableReason === "message_rejected"
                    ? `Backstage mesajı reddetti — yeniden denenmeden atlandı${
                        dm.failureDetail ? `: ${dm.failureDetail}` : ""
                      }`
                : unavailableReason === "message_permission"
                  ? "Profil yüklendi ancak Mesaj düğmesi yok — atlandı"
                  : unavailableReason === "profile_load_failed"
                    ? `Profil ${dm.reloadCount || 3} yenilemeden sonra yüklenemedi — atlandı`
                    : `Mesaj kutusu ${dm.reloadCount || 3} yenilemeden sonra açılamadı — atlandı`;
              await runtimePatch(
                {
                  skipped: Number(latest.runtime.skipped || 0) + 1,
                  processed: [
                    ...latestProcessed,
                    { username, result: unavailableReason, time: new Date().toISOString(), backstageChecked: true }
                  ],
                  status: unavailableReason === "account_suspended"
                    ? `@${username} hesabı askıya alınmış; sonraki ${nextItemName()} geçiliyor`
                    : unavailableReason === "message_rejected"
                      ? `@${username} mesajı Backstage tarafından reddedildi; sonraki ${nextItemName()} geçiliyor`
                      : `@${username} için DM açılamadı; sonraki ${nextItemName()} geçiliyor`
                },
                {
                  level: "skip",
                  username,
                  message: unavailableLog
                }
              );
            } else if (dm.alreadySent) {
              await runtimePatch(
                {
                  skipped: Number(latest.runtime.skipped || 0) + 1,
                  processed: [
                    ...latestProcessed,
                    { username, result: "already_sent", time: new Date().toISOString(), backstageChecked: true }
                  ],
                  status: `@${username} daha önce mesaj almış; sonraki ${nextItemName()} geçiliyor`
                },
                {
                  level: "info",
                  username,
                  message: profileDm
                    ? "Aynı DM gerçek gönderilmiş mesaj balonunda doğrulandı — atlandı"
                    : "Backstage sohbetinde daha önce gönderilmiş mesaj bulundu — yeniden gönderilmedi"
                }
              );
            } else {
              const nextSent = Number(latest.runtime.sent || 0) + 1;
              await runtimePatch(
                {
                  sent: nextSent,
                  processed: [
                    ...latestProcessed,
                    {
                      username,
                      result: "sent",
                      time: new Date().toISOString(),
                      backstageChecked: true,
                      ...(outreach.variant ? { messageVariant: outreach.variant } : {})
                    }
                  ],
                  status: `@${username} mesajı gönderildi`
                },
                {
                  level: "success",
                  username,
                  message: `Mevcut — DM gönderildi${outreach.total > 1 ? ` (Mesaj ${outreach.variant})` : ""}`
                }
              );
              if (nextSent >= Number(controller.settings.maxPerSession || 50)) {
                await finishNormally("Başarılı DM limiti tamamlandı");
                return;
              }
            }
          } else {
            await runtimePatch(
              {
                failed: Number(latest.runtime.failed || 0) + 1,
                processed: [
                  ...latestProcessed,
                  { username, result: "dm_failed", time: new Date().toISOString(), backstageChecked: true }
                ],
                running: false,
                status: `@${username} DM gönderilemedi`
              },
              {
                level: "error",
                username,
                message: dm?.error || "DM gönderilemedi; profil sekmesi açık bırakıldı"
              }
            );
            controller.running = false;
            return;
          }
        } else {
          outcome = "not_eligible";
          const latest = await getState();
          const latestProcessed = Array.isArray(latest.runtime.processed) ? latest.runtime.processed : [];
          await runtimePatch(
            {
              skipped: Number(latest.runtime.skipped || 0) + 1,
              processed: [
                ...latestProcessed,
                { username, result: "not_eligible", time: new Date().toISOString(), backstageChecked: true }
              ],
              status: `@${username} uygun değil; sonraki ${nextItemName()} geçiliyor`
            },
            {
              level: "skip",
              username,
              message: `Uygun değil — ${eligibility.reason || "Mevcut durumu görülmedi"}`
            }
          );
        }
      }

      if (!controller.running) return;
      await runtimePatch({
        status: isForYouMode()
          ? "Sizin İçin sekmesine dönülüyor"
          : "Canlı yayın sekmesine dönülüyor"
      });
      const activation = await sendRuntimeMessageWithTimeout(
        { type: "BTG_ACTIVATE_CONTROLLER" },
        10000,
        "TikTok akış sekmesi etkinleştirilemedi."
      );
      if (!activation?.ok) {
        await stopWithError(activation?.error || "TikTok akış sekmesi etkinleştirilemedi.");
        return;
      }
      if (attemptedDm) {
        // Mesaj denemesi tamamlandı; TikTok'un akış sekmesine dönüşte
        // toparlanması için kısa süre beklenir.
        await interruptibleDelay(500);
        if (!controller.running) return;
      }

      // Ayarlanan bekleme yalnız DM denemesi yapılan yayıncıdan sonra uygulanır;
      // profil sekmesi hiç açılmayan yayıncılarda kısa bir geçiş aralığı yeterlidir.
      const waitMs = attemptedDm ? randomDelayMs(controller.settings) : randomSkipPacingMs();
      await runtimePatch({
        status: `Sonraki ${nextItemName()} geçmeden önce ${formatSeconds(waitMs)} sn bekleniyor`
      });
      await interruptibleDelay(waitMs);
      timer.mark("bekleme");
      if (!controller.running) return;

      await runtimePatch({
        status: isForYouMode()
          ? "Sonraki Sizin İçin videosuna geçiliyor"
          : "Sonraki canlı yayına geçiliyor"
      });
      const previous = username;
      const transition = await goToNextItemWithRetry(previous);
      timer.mark("geçiş");
      await recordTiming(username, outcome, timer);
      if (!transition.ok) {
        if (transition.stopped) return;
        if (!isForYouMode()) {
          // Geçiş doğrulanamadıysa akış durdurulmaz; sekme yenilenir ve akış
          // aynı ayarlarla yeniden başlar (oturum başına sınırlı sayıda).
          const reason = transition.stuck
            ? `Yayın geçişi yarım kaldı (adres @${transition.urlUsername}, ekran @${previous}); canlı yayın sekmesi yenileniyor`
            : transition.buttonMissing
              ? "Aşağı/sonraki ok düğmesi bulunamadı; canlı yayın sekmesi yenileniyor"
              : "Sonraki yayına geçiş doğrulanamadı; canlı yayın sekmesi yenileniyor";
          const reload = await sendRuntimeMessageWithTimeout(
            { type: "BTG_RELOAD_CONTROLLER", reason },
            10000,
            "Canlı yayın sekmesini yenileme isteği yanıt vermedi."
          );
          if (reload?.ok) {
            controller.running = false;
            return;
          }
          await stopWithError(reload?.error || "Sonraki yayıncıya geçiş iki denemede de doğrulanamadı.");
          return;
        }
        await stopWithError(
          isForYouMode()
            ? transition.buttonMissing
              ? "Sizin İçin akışındaki aşağı düğmesi veya sonraki video iki denemede de bulunamadı."
              : "Sonraki videonun sahibine geçiş iki denemede de doğrulanamadı."
            : transition.buttonMissing
              ? "Canlı yayın sayfasındaki aşağı/sonraki ok düğmesi iki denemede de bulunamadı."
              : "Sonraki yayıncıya geçiş iki denemede de doğrulanamadı."
        );
        return;
      }
    }
  }

  async function runNameCollectionController() {
    await runtimePatch({
      status: "İsim toplama çalışıyor",
      collectionRows: [],
      sent: 0,
      skipped: 0,
      failed: 0
    });

    while (controller.running) {
      const timer = createPhaseTimer();
      const state = await getState();
      if (!state?.runtime?.running) {
        controller.running = false;
        return;
      }

      const rows = Array.isArray(state.runtime.collectionRows)
        ? state.runtime.collectionRows
        : [];
      const target = Math.max(1, Number(controller.settings.maxPerSession || 50));
      if (rows.length >= target) {
        await finishNameCollection("İstenen sayıda isim toplandı");
        return;
      }

      const username = getCurrentUsername();
      if (!username) {
        await stopWithError("Canlı yayın kullanıcı adı URL’den okunamadı.");
        return;
      }

      const alreadyCollected = rows.some(
        (row) => String(row?.username || "").toLocaleLowerCase("tr") === username.toLocaleLowerCase("tr")
      );
      // İsim Toplama yalnız bu oturumun tekrarlarını eler; kalıcı geçmişe bakmaz.
      let outcome = "duplicate";
      let followerCount = null;

      if (alreadyCollected) {
        await runtimePatch(
          {
            currentUsername: username,
            skipped: Number(state.runtime.skipped || 0) + 1,
            status: `@${username} bu isim listesinde zaten var; sonraki yayına geçiliyor`
          },
          { level: "info", username, message: "Bu oturumda zaten toplandı — atlandı" }
        );
      } else {
        await runtimePatch({
          currentUsername: username,
          status: `@${username} takipçi sayısı okunuyor`
        });
        const followerReading = await readLiveFollowerCount(username);
        timer.mark("takipçi");
        if (!controller.running) return;

        // Takipçi sayısı okunamazsa takipçi şartı karşılanmış sayılır; yayıncı geçilmez.
        const followerReadable = Boolean(followerReading?.ok) && isReadableFollowerCount(followerReading.count);
        if (!followerReadable) {
          await runtimePatch(
            { status: `@${username} takipçi sayısı okunamadı; takipçi şartı karşılanmış sayılıyor` },
            {
              level: "info",
              username,
              message: `Takipçi sayısı okunamadı (${followerReading?.error || "yayıncı kartı bulunamadı"}) — takipçi şartı karşılanmış sayıldı`
            }
          );
        } else {
          followerCount = Math.max(0, Math.round(Number(followerReading.count)));
        }
        {
          const minFollowers = clampFollowerThreshold(controller.settings.minFollowers);
          if (followerReadable && followerCount < minFollowers) {
            outcome = "low_followers";
            await runtimePatch(
              {
                skipped: Number(state.runtime.skipped || 0) + 1,
                status: `@${username} takipçi filtresine uymadı; sonraki yayına geçiliyor`
              },
              {
                level: "skip",
                username,
                message: `Takipçi sayısı ${formatFollowerCount(followerCount)}; en az ${formatFollowerCount(minFollowers)} isteniyor`
              }
            );
          } else {
            await runtimePatch({
              status: `@${username} Backstage üzerinde kontrol ediliyor`
            });
            const eligibility = await sendRuntimeMessageWithTimeout(
              { type: "BTG_CHECK_ELIGIBILITY", username },
              70000,
              "Backstage uygunluk kontrolü 70 saniye içinde tamamlanmadı."
            );
            timer.mark("backstage");
            if (!eligibility?.ok) {
              await stopWithError(eligibility?.error || "Backstage uygunluk kontrolü başarısız.");
              return;
            }

            if (eligibility.eligible) {
              await runtimePatch({ status: `@${username} yayın geçmişi değerlendiriliyor` });
              const assessment = await readTalentAssessment(username, followerCount);
              timer.mark("sınıflandırma");
              if (!controller.running) return;
              if (!usernamesMatch(getLiveUsername(), username)) {
                await stopWithError("Değerlendirme sırasında yayıncı değişti; kayıt yapılmadı.");
                return;
              }
              if (!window.BTGTalent.activeDaysAllowed(assessment, controller.settings.requireFiveActiveDays)) {
                outcome = 'low_active_days';
                const days = assessment.metrics.activeDays;
                const detail = Number.isFinite(days) ? `Son 14 günde ${days} aktif gün; en az 5 gün gerekiyor` : 'Yayın geçmişi okunamadı; en az 5 aktif gün doğrulanamadı';
                await runtimePatch({skipped:Number(state.runtime.skipped||0)+1,status:`@${username} aktif gün filtresine uymadı`},{level:'skip',username,message:detail});
              } else {
              outcome = "collected";
              const latest = await getState();
              const latestRows = Array.isArray(latest.runtime.collectionRows)
                ? latest.runtime.collectionRows
                : [];
              const nextRows = [
                ...latestRows,
                { username, followerCount, classId: assessment.classId, assessment, checkedAt: new Date().toISOString() }
              ];
              await runtimePatch(
                {
                  collectionRows: nextRows,
                  sent: nextRows.length,
                  status: `@${username} isim listesine eklendi (${nextRows.length}/${target})`
                },
                {
                  level: "success",
                  username,
                  message: `Mevcut — ${assessment.reason}`
                }
              );
              if (nextRows.length >= target) {
                await recordTiming(username, outcome, timer);
                await finishNameCollection("İstenen sayıda isim toplandı");
                return;
              }
              }
            } else {
              outcome = "not_eligible";
              await runtimePatch(
                {
                  skipped: Number(state.runtime.skipped || 0) + 1,
                  status: `@${username} uygun değil; sonraki yayına geçiliyor`
                },
                {
                  level: "skip",
                  username,
                  message: `Uygun değil — ${eligibility.reason || "Mevcut durumu görülmedi"}`
                }
              );
            }
          }
        }
      }

      if (!controller.running) return;
      const activation = await sendRuntimeMessageWithTimeout(
        { type: "BTG_ACTIVATE_CONTROLLER" },
        10000,
        "TikTok canlı yayın sekmesi etkinleştirilemedi."
      );
      if (!activation?.ok) {
        await stopWithError(activation?.error || "TikTok canlı yayın sekmesi etkinleştirilemedi.");
        return;
      }

      await interruptibleDelay(randomSkipPacingMs());
      if (!controller.running) return;
      const transition = await goToNextItemWithRetry(username);
      timer.mark("geçiş");
      await recordTiming(username, outcome, timer);
      if (!transition.ok) {
        if (transition.stopped) return;
        await stopWithError(
          transition.buttonMissing
            ? "Canlı yayın sayfasındaki aşağı/sonraki ok düğmesi iki denemede de bulunamadı."
            : "Sonraki yayıncıya geçiş iki denemede de doğrulanamadı."
        );
        return;
      }
    }
  }

  async function finishNameCollection(message) {
    controller.running = false;
    const state = await getState();
    const rows = Array.isArray(state?.runtime?.collectionRows)
      ? state.runtime.collectionRows
      : [];
    let downloadError = "";
    try {
      if (!window.BTGXlsxWriter?.downloadNameCollection) {
        throw new Error("Excel yazıcısı yüklenemedi.");
      }
      await saveCollectedOnExit();
    } catch (error) {
      downloadError = error?.message || String(error);
    }
    await runtimePatch(
      {
        running: false,
        status: downloadError
          ? `${message}; klasör iznini kontrol edip Excel çıktısını tekrar kaydedin`
          : `${message}; Excel çıktı klasörüne kaydedildi`
      },
      downloadError
        ? { level: "error", username: "", message: `Otomatik Excel kaydı başarısız: ${downloadError}` }
        : { level: "success", username: "", message: `${rows.length} isimlik Excel çıktı klasörüne kaydedildi` }
    );
  }

  async function saveCollectedOnExit() {
    const stored = await chrome.storage.local.get('runtime');
    const rows = stored.runtime?.collectionRows || [];
    if (!rows.length) return;
    const key = JSON.stringify(rows);
    if (controller.collectionExportKey === key && controller.collectionExport) return controller.collectionExport;
    controller.collectionExportKey = key;
    controller.collectionExport = (async () => {
      try {
        await window.BTGXlsxWriter.downloadNameCollection(rows);
        await runtimePatch({}, {level:'success',username:'',message:`Durum ne olursa olsun mevcut ${rows.length} isim Excel olarak çıktı klasörüne kaydedildi.`});
      } catch (error) {
        // Retain rows for retry; never turn a write failure into a successful export.
        controller.collectionExportKey = '';
        await runtimePatch({}, {level:'error',username:'',message:`${rows.length} isim korunuyor; Excel kaydı başarısız: ${error.message || error}. Çıktı klasörü iznini kontrol edip Excel çıktısını tekrar kaydedin.`});
        throw error;
      }
    })();
    return controller.collectionExport;
  }

  async function readTalentAssessment(username, followerCount) {
    if (!window.BTGTalent) throw new Error("Sınıflandırma modülü yüklenemedi; eklentiyi ve TikTok sekmesini yenileyin.");
    const viewerLabel = Array.from(document.querySelectorAll('div')).find(e =>
      e.children.length === 0 && /^(İzleyiciler|Viewers)$/.test(e.textContent.trim()) && isVisible(e)
    );
    const viewers = window.BTGTalent.number(viewerLabel?.nextElementSibling?.textContent.replace(/^\s*·\s*/, '').trim());
    const findPanel = () => Array.from(document.querySelectorAll('[role="dialog"]')).find(
      panel => isRenderedPopover(panel) && livePopoverBelongsTo(panel, username) && /Hayran Kulübü|Fan Club|Geçmiş|History/.test(panel.innerText)
    );
    let panel = findPanel();
    let opened = false;
    try {
      if (!panel) {
        const anchor = findLiveAnchorHoverTrigger(username);
        const trigger = anchor && (document.querySelector('[data-e2e="room-header-anchor-name"]') || anchor);
        if (trigger && usernamesMatch(getLiveUsername(), username)) {
          trigger.click();
          opened = true;
          panel = await waitFor(findPanel, 5000);
        }
      }
      if (panel) {
        // Identity is checked after content finishes loading as well as before the click.
        await waitFor(() => !controller.running || /Geçmiş|History|Past LIVE|henüz|No past/i.test(panel.innerText), 2500);
        if (!usernamesMatch(getLiveUsername(), username) || !livePopoverBelongsTo(panel, username)) panel = null;
      }
      const assessment = window.BTGTalent.assess({ text: panel?.innerText || '', followerCount, viewers });
      assessment.snapshot.source = `https://www.tiktok.com/@${username}/live`;
      return assessment;
    } finally {
      if (opened) {
        const current = findPanel();
        const close = current?.querySelector('[data-testid="tux-web-nav-bar-icon-action"]');
        if (close instanceof HTMLElement) close.click();
      }
    }
  }

  async function runMobileController() {
    let requestSequence = 0;
    await runtimePatch({
      status: "Mobil telefon köprüsü hazır; ilk yayıncı ID'si okunuyor",
      listIndex: 0,
      listTotal: 0
    });

    while (controller.running) {
      let state = await getState();
      if (!state?.runtime?.running) {
        controller.running = false;
        return;
      }
      if (Number(state.runtime.sent || 0) >= Number(controller.settings.maxPerSession || 50)) {
        await finishNormally("Başarılı DM limiti tamamlandı");
        return;
      }

      requestSequence += 1;
      await runtimePatch({ status: "Telefonda canlı yayıncının profili açılıyor ve ID okunuyor" });
      const mobileProfile = await sendRuntimeMessageWithTimeout(
        {
          type: "BTG_MOBILE_NEXT",
          requestId: `mobile-${Date.now()}-${requestSequence}`
        },
        40000,
        "Telefon 40 saniye içinde yayıncı ID'si vermedi."
      );

      if (!mobileProfile?.ok) {
        if (mobileProfile?.recoverable && mobileProfile?.token) {
          state = await getState();
          const processed = Array.isArray(state.runtime.processed) ? state.runtime.processed : [];
          const scanLabel = `mobil-okuma-${requestSequence}`;
          await runtimePatch(
            {
              skipped: Number(state.runtime.skipped || 0) + 1,
              processed: [
                ...processed,
                {
                  username: scanLabel,
                  result: "mobile_scan_failed",
                  time: new Date().toISOString(),
                  backstageChecked: false
                }
              ],
              status: "Telefonda yayıncı ID'si okunamadı; sonraki canlı yayına geçiliyor"
            },
            {
              level: "skip",
              username: "",
              message: mobileProfile.error || "Mini profilde yayıncı ID'si okunamadı"
            }
          );
          const skippedCompletion = await sendRuntimeMessageWithTimeout(
            {
              type: "BTG_MOBILE_COMPLETE",
              token: mobileProfile.token,
              username: "",
              result: "mobile_scan_failed",
              advance: true
            },
            30000,
            "Telefon okunamayan yayını atlayamadı."
          );
          if (!skippedCompletion?.ok) {
            await stopWithError(skippedCompletion?.error || "Telefon sonraki canlı yayına geçirilemedi.");
            return;
          }
          await interruptibleDelay(randomDelayMs(controller.settings));
          continue;
        }
        await stopWithError(mobileProfile?.error || "Mobil telefon köprüsünden yayıncı ID'si alınamadı.");
        return;
      }

      const username = String(mobileProfile.username || "").replace(/^@/, "").trim();
      if (!/^[A-Za-z0-9._]{2,32}$/.test(username)) {
        await stopWithError("Telefon köprüsü geçersiz bir TikTok kullanıcı ID'si döndürdü.");
        return;
      }
      controller.currentUsername = username;

      state = await getState();
      if (!state?.runtime?.running) {
        controller.running = false;
        return;
      }
      const processed = Array.isArray(state.runtime.processed) ? state.runtime.processed : [];
      const sessionEntry = processed.find(
        (item) => String(item?.username || "").toLocaleLowerCase("tr") === username.toLocaleLowerCase("tr")
      );
      const historyCheck = sessionEntry
        ? { found: true, sessionOnly: true, entry: sessionEntry }
        : await sendRuntimeMessageWithTimeout(
            { type: "BTG_HISTORY_HAS", username },
            15000,
            "Kalıcı yayıncı geçmişi kontrolü yanıt vermedi."
          );

      await runtimePatch({
        currentUsername: username,
        status: `@${username} telefondan okundu; işleniyor`
      });

      let mobileResult = "checked";
      let reachedLimit = false;

      if (isManualSkipUsername(username)) {
        mobileResult = "manual_skip";
        if (historyCheck?.found) {
          await runtimePatch(
            { status: `@${username} özel geçme listesinde; telefonda sonraki yayına geçilecek` },
            {
              level: "skip",
              username,
              message: "Özel geçme listesinde — Backstage ve DM işlemleri yapılmadan atlandı"
            }
          );
        } else {
          await runtimePatch(
            {
              skipped: Number(state.runtime.skipped || 0) + 1,
              processed: [
                ...processed,
                { username, result: "manual_skip", time: new Date().toISOString(), backstageChecked: false }
              ],
              status: `@${username} özel geçme listesinde; telefonda sonraki yayına geçilecek`
            },
            {
              level: "skip",
              username,
              message: "Özel geçme listesinde — Backstage ve DM işlemleri yapılmadan atlandı"
            }
          );
        }
      } else if (historyHasBackstageCheck(historyCheck)) {
        mobileResult = "history_skip";
        await runtimePatch(
          { status: `@${username} daha önce Backstage üzerinde kontrol edildi; telefonda sonraki yayına geçilecek` },
          {
            level: "info",
            username,
            message: historyCheck.sessionOnly
              ? "Bu oturumda daha önce işlendi — atlandı"
              : "Kalıcı geçmişte Backstage kontrolü var — yeniden kontrol edilmeden atlandı"
          }
        );
      } else {
        await runtimePatch({ status: `@${username} Backstage üzerinde kontrol ediliyor` });
        const eligibility = await sendRuntimeMessageWithTimeout(
          { type: "BTG_CHECK_ELIGIBILITY", username },
          70000,
          "Backstage uygunluk kontrolü 70 saniye içinde tamamlanmadı."
        );
        if (!eligibility?.ok) {
          await stopWithError(eligibility?.error || "Backstage uygunluk kontrolü başarısız.");
          return;
        }

        if (eligibility.eligible) {
          await runtimePatch({ status: `@${username} Mevcut; profiline giriliyor ve DM gönderiliyor` });
          const dm = await sendRuntimeMessageWithTimeout(
            {
              type: "BTG_SEND_DM",
              username,
              message: pickOutreachMessage(controller.settings).text
            },
            420000,
            "TikTok DM işlemi 7 dakika içinde tamamlanmadı."
          );
          const latest = await getState();
          const latestProcessed = Array.isArray(latest.runtime.processed) ? latest.runtime.processed : [];

          if (!dm?.ok) {
            await runtimePatch(
              {
                failed: Number(latest.runtime.failed || 0) + 1,
                processed: [
                  ...latestProcessed,
                  {
                    username,
                    result: "dm_failed",
                    time: new Date().toISOString(),
                    backstageChecked: true
                  }
                ],
                running: false,
                status: `@${username} Mevcut ancak DM gönderilemedi`
              },
              {
                level: "error",
                username,
                message: dm?.error || "Mevcut — DM gönderilemedi; web profili ve mobil profil inceleme için açık bırakıldı"
              }
            );
            controller.running = false;
            return;
          }

          if (dm.unavailableSkipped) {
            mobileResult = dm.unavailableReason || "dm_surface";
            await runtimePatch(
              {
                skipped: Number(latest.runtime.skipped || 0) + 1,
                processed: [
                  ...latestProcessed,
                  {
                    username,
                    result: mobileResult,
                    time: new Date().toISOString(),
                    backstageChecked: true
                  }
                ],
                status: `@${username} Mevcut ancak DM açılamadı; telefonda sonraki yayına geçilecek`
              },
              { level: "skip", username, message: "Mevcut — mesaj ekranı açılamadı; atlandı" }
            );
          } else if (dm.alreadySent) {
            mobileResult = "already_sent";
            await runtimePatch(
              {
                skipped: Number(latest.runtime.skipped || 0) + 1,
                processed: [
                  ...latestProcessed,
                  {
                    username,
                    result: "already_sent",
                    time: new Date().toISOString(),
                    backstageChecked: true
                  }
                ],
                status: `@${username} aynı mesajı daha önce almış; telefonda sonraki yayına geçilecek`
              },
              {
                level: "info",
                username,
                message: "Mevcut — aynı DM gerçek gönderilmiş mesaj balonunda doğrulandı; atlandı"
              }
            );
          } else {
            mobileResult = "sent";
            const nextSent = Number(latest.runtime.sent || 0) + 1;
            reachedLimit = nextSent >= Number(controller.settings.maxPerSession || 50);
            await runtimePatch(
              {
                sent: nextSent,
                processed: [
                  ...latestProcessed,
                  {
                    username,
                    result: "sent",
                    time: new Date().toISOString(),
                    backstageChecked: true
                  }
                ],
                status: `@${username} Mevcut — mesaj gönderildi`
              },
              { level: "success", username, message: "Mobil telefon — Mevcut; DM gönderildi" }
            );
          }
        } else {
          mobileResult = "not_eligible";
          const latest = await getState();
          const latestProcessed = Array.isArray(latest.runtime.processed) ? latest.runtime.processed : [];
          await runtimePatch(
            {
              skipped: Number(latest.runtime.skipped || 0) + 1,
              processed: [
                ...latestProcessed,
                {
                  username,
                  result: "not_eligible",
                  time: new Date().toISOString(),
                  backstageChecked: true
                }
              ],
              status: `@${username} Mevcut değil; telefonda sonraki yayına geçilecek`
            },
            {
              level: "skip",
              username,
              message: `Mevcut değil — ${eligibility.reason || "Backstage sonucu uygun görünmedi"}`
            }
          );
        }
      }

      if (!controller.running) return;
      const activation = await sendRuntimeMessageWithTimeout(
        { type: "BTG_ACTIVATE_CONTROLLER" },
        10000,
        "TikTok kontrol sekmesi etkinleştirilemedi."
      );
      if (!activation?.ok) {
        await stopWithError(activation?.error || "TikTok kontrol sekmesi etkinleştirilemedi.");
        return;
      }

      const completion = await sendRuntimeMessageWithTimeout(
        {
          type: "BTG_MOBILE_COMPLETE",
          token: mobileProfile.token,
          username,
          result: mobileResult,
          advance: !reachedLimit
        },
        30000,
        "Telefon 30 saniye içinde sonraki canlı yayına geçemedi."
      );
      if (!completion?.ok) {
        await stopWithError(completion?.error || "Telefon sonraki canlı yayına geçirilemedi.");
        return;
      }

      if (reachedLimit) {
        await finishNormally("Başarılı DM limiti tamamlandı");
        return;
      }
      await runtimePatch({ status: "Telefon sonraki canlı yayında; yeni profil için bekleniyor" });
      await interruptibleDelay(randomDelayMs(controller.settings));
    }
  }

  function listMessageForUsername(settings, username) {
    if (settings.mode !== 'manual' || !settings.usePersonalizedMessages) return pickOutreachMessage(settings).text;
    const key = username.toLowerCase(), messages = settings.personalizedMessages || {};
    return Object.hasOwn(messages,key) && typeof messages[key] === 'string' ? messages[key].trim() : '';
  }

  // Eklenti penceresindeki dolu mesaj kutularından biri rastgele seçilir.
  // variant, kutunun penceredeki sırasıdır (1-3).
  function pickOutreachMessage(settings) {
    const variants = Array.isArray(settings?.messages)
      ? settings.messages
          .map((text, index) => ({ text: typeof text === "string" ? text.trim() : "", variant: index + 1 }))
          .filter((item) => item.text)
      : [];
    if (!variants.length) return { text: String(settings?.message || "").trim(), variant: 0, total: 1 };
    const picked = variants[Math.floor(Math.random() * variants.length)];
    return { ...picked, total: variants.length };
  }

  async function runListController() {
    const sourceName = isManualListMode() ? "Listeden Kontrol" : "Excel listesi";
    const skipBackstageCheck = false; // Liste uygunluk kontrolü zorunludur.
    const usernames = Array.isArray(controller.settings?.listUsernames)
      ? controller.settings.listUsernames
          .map((item) => String(item || "").replace(/^@/, "").trim())
          .filter(Boolean)
      : [];
    const total = usernames.length;
    if (!total) {
      await stopWithError(`${sourceName} içinde işlenecek kullanıcı adı bulunamadı.`);
      return;
    }

    await runtimePatch({
      status: skipBackstageCheck
        ? `${sourceName} doğrudan mesaj gönderimi başlıyor (0/${total})`
        : `${sourceName} Backstage üzerinde kontrol ediliyor (0/${total})`,
      listIndex: 0,
      listTotal: total
    });

    for (let index = 0; index < total && controller.running; index += 1) {
      const username = usernames[index];
      const message = listMessageForUsername(controller.settings, username);
      if (!message) { await stopWithError(`@${username} için özel mesaj bulunamadı; gönderim durduruldu.`); return; }
      controller.currentUsername = username;
      const position = index + 1;
      const progress = `${position}/${total}`;
      let reportRow = null;
      let reachedLimit = false;
      const timer = createPhaseTimer();
      let outcome = "";
      let attemptedDm = false;
      const state = await getState();
      if (!state?.runtime?.running) {
        controller.running = false;
        return;
      }

      if (Number(state.runtime.sent || 0) >= Number(controller.settings.maxPerSession || 50)) {
        await finishNormally("Başarılı DM limiti tamamlandı");
        return;
      }

      const processed = Array.isArray(state.runtime.processed) ? state.runtime.processed : [];
      const sessionEntry = processed.find(
        (item) => String(item?.username || "").toLocaleLowerCase("tr") === username.toLocaleLowerCase("tr")
      );
      // Mevcut yayıncı bilgilendirmesinde ilk temas geçmişi engel değildir;
      // aynı metnin ikinci kez gitmesini Backstage sohbet kontrolü önler.
      const existingCreatorNotice = isManualListMode() && controller.settings?.existingCreatorNotice === true;
      let historyCheck = sessionEntry
        ? { found: true, sessionOnly: true, entry: sessionEntry }
        : existingCreatorNotice
        ? { ok: true, found: false }
        : await sendRuntimeMessageWithTimeout(
            { type: "BTG_HISTORY_HAS", username },
            15000,
            "Kalıcı yayıncı geçmişi kontrolü yanıt vermedi."
          );

      if (isManualListMode() && !existingCreatorNotice) {
        const messageHistory = await sendRuntimeMessageWithTimeout(
          { type: "BTG_MESSAGE_HISTORY_HAS", username }, 15000, "Mesaj geçmişi kontrolü yanıt vermedi."
        );
        if (!messageHistory?.ok || !historyCheck?.ok && !historyCheck?.sessionOnly) {
          await stopWithError("Yayıncı geçmişi doğrulanamadı; işlem durduruldu.");
          return;
        }
        if (messageHistory.messaged) historyCheck = { found: true, entry: messageHistory.entry };
      }
      timer.mark("geçmiş");
      await runtimePatch({
        currentUsername: username,
        listIndex: position,
        listTotal: total,
        status: `[${progress}] @${username} işleniyor`
      });

      if (isManualSkipUsername(username)) {
        outcome = "manual_skip";
        reportRow = makeListReportRow(
          position,
          username,
          "Özel geçme listesi",
          "Atlandı",
          "Backstage ve DM işlemleri yapılmadı"
        );
        if (historyCheck?.found) {
          await runtimePatch(
            { status: `[${progress}] @${username} özel geçme listesinde` },
            {
              level: "skip",
              username,
              message: "Özel geçme listesinde — Backstage ve DM işlemleri yapılmadan atlandı"
            }
          );
        } else {
          await runtimePatch(
            {
              skipped: Number(state.runtime.skipped || 0) + 1,
              processed: [
                ...processed,
                { username, result: "manual_skip", time: new Date().toISOString() }
              ],
              status: `[${progress}] @${username} özel geçme listesinde — atlandı`
            },
            {
              level: "skip",
              username,
              message: "Özel geçme listesinde — Backstage ve DM işlemleri yapılmadan atlandı"
            }
          );
        }
      } else if (isManualListMode() ? historyCheck?.found : historyHasBackstageCheck(historyCheck)) {
        outcome = "history";
        reportRow = makeListReportRow(
          position,
          username,
          "Geçmiş kaydı — Backstage yeniden sorgulanmadı",
          "Atlandı",
          historyCheck.sessionOnly ? "Bu çalışma içinde daha önce işlendi" : "Kalıcı geçmişte daha önce kontrol edildi"
        );
        await runtimePatch(
          { status: `[${progress}] @${username} daha önce işlendi — atlandı` },
          {
            level: "info",
            username,
            message: historyCheck.sessionOnly
              ? "Bu oturumda daha önce işlendi — atlandı"
              : "Kalıcı yayıncı/mesaj geçmişinde bulundu — yeniden kontrol edilmeden atlandı"
          }
        );
      } else {
        await runtimePatch({
          status: skipBackstageCheck
            ? `[${progress}] @${username} için Backstage atlanıyor; DM gönderiliyor`
            : historyCheck?.found
            ? `[${progress}] @${username} eski geçmiş kaydı bulundu; Backstage yeniden doğrulanıyor`
            : `[${progress}] @${username} Backstage üzerinde kontrol ediliyor`
        });

        const eligibility = skipBackstageCheck
          ? { ok: true, eligible: true, reason: "Backstage kontrolü yapılmadı" }
          : await sendRuntimeMessageWithTimeout(
          {
            type: "BTG_CHECK_ELIGIBILITY",
            username
          },
          70000,
          "Backstage uygunluk kontrolü 70 saniye içinde tamamlanmadı."
        );

        if (!eligibility?.ok) {
          if (isManualListMode()) {
            timer.mark("backstage");
            outcome = "backstage_failed";
            const latest = await getState();
            const latestProcessed = Array.isArray(latest.runtime.processed)
              ? latest.runtime.processed
              : [];
            const failureMessage = eligibility?.error || "Backstage uygunluk kontrolü tamamlanamadı";
            await runtimePatch(
              {
                failed: Number(latest.runtime.failed || 0) + 1,
                processed: [
                  ...latestProcessed,
                  {
                    username,
                    result: "backstage_failed",
                    time: new Date().toISOString(),
                    backstageChecked: true
                  }
                ],
                status: `[${progress}] @${username} Backstage kontrolü başarısız — sonraki hesaba geçiliyor`
              },
              { level: "error", username, message: failureMessage }
            );
            await appendListReportRow(
              makeListReportRow(
                position,
                username,
                "Backstage kontrol hatası",
                "Atlandı",
                failureMessage
              )
            );
            if (position < total) {
              const waitMs = randomSkipPacingMs();
              await runtimePatch({
                status: `[${progress}] Sonraki ${sourceName} hesabı için ${formatSeconds(waitMs)} sn bekleniyor`
              });
              await interruptibleDelay(waitMs);
              timer.mark("bekleme");
            }
            await recordTiming(username, outcome, timer);
            continue;
          }
          await appendListReportRow(
            makeListReportRow(
              position,
              username,
              "Backstage kontrol hatası",
              "İşlem durduruldu",
              eligibility?.error || "Backstage uygunluk kontrolü tamamlanamadı"
            )
          );
          await stopWithError(eligibility?.error || "Backstage uygunluk kontrolü başarısız.");
          return;
        }

        if (!skipBackstageCheck) timer.mark("backstage");
        if (eligibility.eligible) {
          attemptedDm = true;
          await runtimePatch({
            status: isManualInstantMessaging()
              ? `[${progress}] @${username} uygun; Backstage sohbetinden mesaj gönderiliyor`
              : `[${progress}] @${username} Mevcut; profiline giriliyor ve DM gönderiliyor`
          });
          const dm = await sendRuntimeMessageWithTimeout(
            {
              type: "BTG_SEND_DM",
              username,
              message
            },
            isManualInstantMessaging() ? 45000 : 420000,
            isManualInstantMessaging()
              ? "Backstage mesaj işlemi 45 saniye içinde tamamlanmadı."
              : "TikTok DM işlemi 7 dakika içinde tamamlanmadı."
          );
          timer.mark("dm");
          timer.detail("dm", dm?.timing);
          outcome = describeDmOutcome(dm);

          const latest = await getState();
          const latestProcessed = Array.isArray(latest.runtime.processed)
            ? latest.runtime.processed
            : [];

          if (dm?.ok) {
            if (dm.unavailableSkipped) {
              const unavailableReason = dm.unavailableReason || "dm_surface";
              const unavailableLog =
                unavailableReason === "account_suspended"
                  ? `Mevcut — Backstage hedef hesabın askıya alındığını bildirdi; mesaj yeniden denenmeden atlandı${
                      dm.failureDetail ? `: ${dm.failureDetail}` : ""
                    }`
                  : unavailableReason === "message_rejected"
                    ? `Mevcut — Backstage mesajı reddetti; yeniden denenmeden atlandı${
                        dm.failureDetail ? `: ${dm.failureDetail}` : ""
                      }`
                : unavailableReason === "message_permission"
                  ? "Mevcut — profil yüklendi ancak Mesaj düğmesi yok; atlandı"
                  : unavailableReason === "profile_load_failed"
                    ? `Mevcut — profil ${dm.reloadCount || 3} yenilemeden sonra yüklenemedi; atlandı`
                    : `Mevcut — mesaj kutusu ${dm.reloadCount || 3} yenilemeden sonra açılamadı; atlandı`;
              await runtimePatch(
                {
                  skipped: Number(latest.runtime.skipped || 0) + 1,
                  processed: [
                    ...latestProcessed,
                    {
                      username,
                      result: unavailableReason,
                      time: new Date().toISOString(),
                      backstageChecked: !skipBackstageCheck
                    }
                  ],
                  status: unavailableReason === "account_suspended"
                    ? `[${progress}] @${username} hesabı askıya alınmış — atlandı`
                    : unavailableReason === "message_rejected"
                      ? `[${progress}] @${username} mesajı Backstage tarafından reddedildi — atlandı`
                      : `[${progress}] @${username} Mevcut ancak DM açılamadı — atlandı`
                },
                { level: "skip", username, message: unavailableLog }
              );
              reportRow = makeListReportRow(
                position,
                username,
                eligibility.reason || "Mevcut",
                unavailableReason === "account_suspended"
                  ? "Hesap askıya alınmış"
                  : unavailableReason === "message_rejected"
                    ? "Mesaj Backstage tarafından reddedildi"
                    : "DM açılamadı",
                unavailableLog
              );
            } else if (dm.alreadySent) {
              await runtimePatch(
                {
                  skipped: Number(latest.runtime.skipped || 0) + 1,
                  processed: [
                    ...latestProcessed,
                    {
                      username,
                      result: "already_sent",
                      time: new Date().toISOString(),
                      backstageChecked: !skipBackstageCheck
                    }
                  ],
                  status: `[${progress}] @${username} Mevcut; aynı mesajı daha önce almış — atlandı`
                },
                {
                  level: "info",
                  username,
                  message: "Mevcut — aynı DM gerçek gönderilmiş mesaj balonunda doğrulandı; atlandı"
                }
              );
              reportRow = makeListReportRow(
                position,
                username,
                eligibility.reason || "Mevcut",
                "Mesaj daha önce gönderilmiş",
                "Aynı DM gerçek gönderilmiş mesaj balonunda doğrulandı"
              );
            } else {
              const nextSent = Number(latest.runtime.sent || 0) + 1;
              reachedLimit = nextSent >= Number(controller.settings.maxPerSession || 50);
              await runtimePatch(
                {
                  sent: nextSent,
                  processed: [
                    ...latestProcessed,
                    {
                      username,
                      result: "sent",
                      time: new Date().toISOString(),
                      backstageChecked: !skipBackstageCheck
                    }
                  ],
                  status: `[${progress}] @${username} Mevcut — mesaj gönderildi`
                },
                { level: "success", username, message: `${sourceName} — Mevcut; DM gönderildi` }
              );
              reportRow = makeListReportRow(
                position,
                username,
                eligibility.reason || "Mevcut",
                "DM gönderildi",
                "Mesaj gönderimi sohbet içinde doğrulandı"
              );
            }
          } else {
            await runtimePatch(
              {
                failed: Number(latest.runtime.failed || 0) + 1,
                processed: [
                  ...latestProcessed,
                  {
                    username,
                    result: "dm_failed",
                    time: new Date().toISOString(),
                    backstageChecked: !skipBackstageCheck
                  }
                ],
                ...(isManualListMode() ? {} : { running: false }),
                status: `[${progress}] @${username} Mevcut ancak DM gönderilemedi`
              },
              {
                level: "error",
                username,
                message: dm?.error || "Mevcut — DM gönderilemedi; profil sekmesi açık bırakıldı"
              }
            );
            await appendListReportRow(
              makeListReportRow(
                position,
                username,
                eligibility.reason || "Mevcut",
                "DM başarısız",
                dm?.error || "DM gönderimi doğrulanamadı"
              )
            );
            if (!isManualListMode()) {
              controller.running = false;
              return;
            }
          }
        } else {
          outcome = "not_eligible";
          const latest = await getState();
          const latestProcessed = Array.isArray(latest.runtime.processed)
            ? latest.runtime.processed
            : [];
          await runtimePatch(
            {
              skipped: Number(latest.runtime.skipped || 0) + 1,
              processed: [
                ...latestProcessed,
                {
                  username,
                  result: "not_eligible",
                  time: new Date().toISOString(),
                  backstageChecked: !skipBackstageCheck
                }
              ],
              status: `[${progress}] @${username} Mevcut değil — atlandı`
            },
            {
              level: "skip",
              username,
              message: `Mevcut değil — ${eligibility.reason || "Backstage sonucu uygun görünmedi"}`
            }
          );
          reportRow = makeListReportRow(
            position,
            username,
            eligibility.reason || "Mevcut değil",
            "DM gönderilmedi",
            "Backstage sonucu uygun değil"
          );
        }
      }

      if (reportRow) {
        await appendListReportRow(reportRow);
      }
      if (!controller.running) return;
      if (reachedLimit) {
        await finishNormally("Başarılı DM limiti tamamlandı");
        return;
      }
      if (position < total) {
        if (attemptedDm) {
          // Profil sekmesi açılıp kapatıldı; kontrol sekmesine dönülür ve
          // TikTok'un toparlanması için kısa süre beklenir.
          const activation = await sendRuntimeMessageWithTimeout(
            { type: "BTG_ACTIVATE_CONTROLLER" },
            10000,
            "TikTok kontrol sekmesi etkinleştirilemedi."
          );
          if (!activation?.ok) {
            await stopWithError(activation?.error || "TikTok kontrol sekmesi etkinleştirilemedi.");
            return;
          }
          await interruptibleDelay(500);
          if (!controller.running) return;
        }
        // Ayarlanan bekleme yalnız DM denemesi yapılan hesaptan sonra uygulanır;
        // yalnız Backstage'de sorgulanan hesaplarda kısa bir aralık yeterlidir.
        const waitMs = attemptedDm ? randomDelayMs(controller.settings) : randomSkipPacingMs();
        await runtimePatch({
          status: `[${progress}] Sonraki ${sourceName} hesabı için ${formatSeconds(waitMs)} sn bekleniyor`
        });
        await interruptibleDelay(waitMs);
        timer.mark("bekleme");
      }
      await recordTiming(username, outcome, timer);
    }

    if (controller.running) {
      await finishNormally(`${sourceName} tamamlandı (${total}/${total})`);
    }
  }

  function makeListReportRow(order, username, backstageResult, outcome, detail) {
    return {
      order,
      username,
      backstageResult: String(backstageResult || ""),
      outcome: String(outcome || ""),
      detail: String(detail || ""),
      checkedAt: new Date().toISOString()
    };
  }

  async function appendListReportRow(row) {
    const latest = await getState();
    const reportRows = Array.isArray(latest?.runtime?.reportRows)
      ? latest.runtime.reportRows
      : [];
    await runtimePatch({ reportRows: [...reportRows, row].slice(0, 10000) });
  }

  function historyHasBackstageCheck(historyCheck) {
    if (!historyCheck?.found) return false;
    if (historyCheck?.entry?.result === "manual_skip") return true;
    return historyCheck?.entry?.backstageChecked === true;
  }

  function isManualSkipUsername(rawUsername) {
    const username = String(rawUsername || "")
      .replace(/^@/, "")
      .toLowerCase();
    return [
      "memousta58",
      "mustix_ryzen",
      "desperato30",
      "ege3310",
      "jerryfc_",
      "zynowq",
      "noxain4",
      "alionfrooy",
      "uvlog.2026",
      "esma_nuurss",
      "novazzzy",
      "2032_hafiz_ali",
      "flexinvll"
    ].includes(username);
  }

  // Kişisel mesaj: İsim toplama gibi kaydırır ve Backstage'de kontrol eder; uygun
  // yayıncının web verisi toplanır, oturum sonunda model notu (.md) yazılır.
  // Kayıtlar başlatmada sıfırlanır (background), sekme yenilemesinde korunur.
  async function runPersonalMessageController() {
    if (!window.BTGPersonalProfile || window.BTGPersonalProfile.version !== 1) {
      await stopWithError("Kişisel mesaj veri modülü yüklenemedi; eklentiyi ve TikTok sekmesini yenileyin.");
      return;
    }
    controller.personalBlockedStreak = 0;
    if (controller.settings.personalSource === "tikleap") {
      await runTikleapPersonalController();
      return;
    }
    await runtimePatch({ status: "Kişisel mesaj için yayıncılar kontrol ediliyor" });

    while (controller.running) {
      const state = await getState();
      if (!state?.runtime?.running) {
        controller.running = false;
        return;
      }

      const rows = Array.isArray(state.runtime.personalRows) ? state.runtime.personalRows : [];
      const target = Math.max(1, Number(controller.settings.maxPerSession || 50));
      if (rows.length >= target) {
        await finishPersonalCollection("İstenen sayıda yayıncı toplandı");
        return;
      }

      const retried = await retryDeferredPersonal(target);
      if (retried === "stopped" || retried === "finished" || !controller.running) return;

      const timer = createPhaseTimer();
      const username = getCurrentUsername();
      if (!username) {
        await stopWithError("Canlı yayın kullanıcı adı URL’den okunamadı.");
        return;
      }

      const key = username.toLocaleLowerCase("tr");
      const seen = Array.isArray(state.runtime.personalSeen) ? state.runtime.personalSeen : [];
      let outcome = "duplicate";
      if (seen.includes(key) || rows.some((row) => String(row?.username || "").toLocaleLowerCase("tr") === key)) {
        await runtimePatch(
          {
            currentUsername: username,
            skipped: Number(state.runtime.skipped || 0) + 1,
            status: `@${username} bu oturumda zaten kontrol edildi; sonraki yayına geçiliyor`
          },
          { level: "info", username, message: "Bu oturumda zaten kontrol edildi — atlandı" }
        );
      } else {
        outcome = await processPersonalCandidate(username, target, timer, { deferOnBlock: true });
        if (outcome === "stopped" || outcome === "finished") return;
      }

      if (!controller.running) return;
      const activation = await sendRuntimeMessageWithTimeout(
        { type: "BTG_ACTIVATE_CONTROLLER" },
        10000,
        "TikTok canlı yayın sekmesi etkinleştirilemedi."
      );
      if (!activation?.ok) {
        await stopWithError(activation?.error || "TikTok canlı yayın sekmesi etkinleştirilemedi.");
        return;
      }

      await interruptibleDelay(outcome === "collected" ? randomCollectPacingMs() : randomSkipPacingMs());
      if (!controller.running) return;
      const transition = await goToNextItemWithRetry(username);
      timer.mark("geçiş");
      await recordTiming(username, outcome, timer);
      if (!transition.ok) {
        if (transition.stopped) return;
        const reason = transition.stuck
          ? `Yayın geçişi yarım kaldı (adres @${transition.urlUsername}, ekran @${username}); canlı yayın sekmesi yenileniyor`
          : transition.buttonMissing
            ? "Aşağı/sonraki ok düğmesi bulunamadı; canlı yayın sekmesi yenileniyor"
            : "Sonraki yayına geçiş doğrulanamadı; canlı yayın sekmesi yenileniyor";
        const reload = await sendRuntimeMessageWithTimeout(
          { type: "BTG_RELOAD_CONTROLLER", reason },
          10000,
          "Canlı yayın sekmesini yenileme isteği yanıt vermedi."
        );
        if (reload?.ok) {
          controller.reloading = true;
          controller.running = false;
          return;
        }
        await stopWithError(reload?.error || "Sonraki yayıncıya geçiş iki denemede de doğrulanamadı.");
        return;
      }
    }
  }

  async function processPersonalCandidate(username, target, timer, options = {}) {
    const skip = async (outcome, status, message, level = "skip") => {
      const latest = await getState();
      await runtimePatch(
        {
          skipped: Number(latest?.runtime?.skipped || 0) + 1,
          personalSeen: rememberPersonalSeen(latest?.runtime?.personalSeen, username),
          status
        },
        { level, username, message }
      );
      return outcome;
    };

    await runtimePatch({ currentUsername: username, status: `@${username} mesaj geçmişi kontrol ediliyor` });
    if (isManualSkipUsername(username)) {
      return skip("manual_skip", `@${username} geçme listesinde; sonraki yayına geçiliyor`, "Geçme listesinde — atlandı", "info");
    }
    const history = await sendRuntimeMessageWithTimeout(
      { type: "BTG_MESSAGE_HISTORY_HAS", username },
      15000,
      "Mesaj gönderilmiş yayıncı geçmişi kontrolü yanıt vermedi."
    );
    timer.mark("geçmiş");
    if (!controller.running) return "stopped";
    if (history?.messaged) {
      return skip("already_messaged", `@${username} daha önce mesaj almış; sonraki yayına geçiliyor`, "Daha önce mesaj gönderilmiş — atlandı", "info");
    }

    // Backstage, TikTok profil isteğinden önce sorulur: canlı akıştaki adayların çoğu
    // (19 Ekim 2026 ölçümü: 56'nın 41'i) Backstage'de uygun çıkmıyor ve onlar için
    // TikTok'a hiç istek gitmez. Bu, profil isteklerini engelleyen TikTok sınırını da geciktirir.
    // Tikleap kaynağında uygunluk toplu kontrolde zaten okundu.
    const eligibility = options.eligibilityKnown ? { ok: true, eligible: true } : await checkPersonalEligibility(username);
    timer.mark("backstage");
    if (!eligibility?.ok) {
      await stopWithError(eligibility?.error || "Backstage uygunluk kontrolü başarısız.");
      return "stopped";
    }
    if (eligibility.transientSkipped) {
      const notFound = eligibility.transientResult === "backstage_not_found";
      return skip(
        notFound ? "backstage_not_found" : "backstage_timeout",
        notFound
          ? `@${username} Backstage aramasında bulunamadı; sonraki yayına geçiliyor`
          : `@${username} Backstage zaman aşımı nedeniyle atlandı; sonraki yayına geçiliyor`,
        eligibility.reason || "Backstage zaman aşımı — yayıncı geçici olarak atlandı"
      );
    }
    if (!eligibility.eligible) {
      return skip(
        "not_eligible",
        `@${username} uygun değil; sonraki yayına geçiliyor`,
        `Uygun değil — ${eligibility.reason || "Mevcut durumu görülmedi"}`
      );
    }

    // Canlı akışta TikTok engeli sürerken yeni uygun yayıncı için istek atılmaz;
    // doğrudan kenara alınır ve engel kalkınca okunur.
    const deferredFailures = Number(options.deferredFailures);
    if (options.deferOnBlock && !Number.isFinite(deferredFailures) && Date.now() < (controller.personalBlockedUntil || 0)) {
      return deferPersonalCandidate(username, 0);
    }

    // Takipçi yalnız filtre varsa okunur; okunamazsa takipçi şartı karşılanmış sayılır.
    const minFollowers = clampFollowerThreshold(controller.settings.minFollowers);
    let basics = null;
    let followerCount = null;
    if (minFollowers > 0) {
      await runtimePatch({ status: `@${username} takipçi sayısı okunuyor` });
      if (!basics) basics = await window.BTGPersonalProfile.readBasics(username).catch(() => null);
      followerCount = Number.isFinite(basics?.followers) ? Math.max(0, Math.round(basics.followers)) : null;
      if (followerCount === null && !options.visitProfile && !Number.isFinite(deferredFailures)) {
        const reading = await readLiveFollowerCount(username);
        if (reading?.ok && isReadableFollowerCount(reading.count)) followerCount = Math.max(0, Math.round(Number(reading.count)));
      }
      timer.mark("takipçi");
      if (!controller.running) return "stopped";
    }
    if (followerCount !== null && followerCount < minFollowers) {
      return skip(
        "low_followers",
        `@${username} takipçi filtresine uymadı; sonraki yayına geçiliyor`,
        `Takipçi sayısı ${formatFollowerCount(followerCount)}; en az ${formatFollowerCount(minFollowers)} isteniyor`
      );
    }

    await runtimePatch({ status: `@${username} uygun; yayın verileri toplanıyor` });
    let profile = await collectPersonalProfile(username, basics, options);
    // Canlı akışta engelde yerinde beklenmez: yayıncı kenara alınır, akış Backstage
    // elemesiyle sürer, süre dolunca profil yeniden okunur (19 Ekim 2026: yerinde
    // bekleme 17 dakikalık koşunun ~8 dakikasını boşa harcadı).
    if (options.deferOnBlock && profile.missing?.includes("profil")) {
      const failures = (Number.isFinite(deferredFailures) ? deferredFailures : 0) + 1;
      if (failures <= PERSONAL_PROFILE_RETRY_WAITS_MS.length) return deferPersonalCandidate(username, failures);
    }
    // TikTok bazen profil isteğini birkaç dakika engelliyor (2026-10-07 taramasında
    // 60 uygun yayıncının 9'u veri olmadan kaldı; 2026-10-14'te engel dakikalarca sürdü).
    // Tikleap kuyruğunda engel sürerken yapılacak başka iş olmadığı için yerinde,
    // artan sürelerle beklenir.
    for (let retry = 1; !options.deferOnBlock && retry <= PERSONAL_PROFILE_RETRY_WAITS_MS.length && profile.missing?.includes("profil"); retry += 1) {
      if (!controller.running) return "stopped";
      const waitMs = PERSONAL_PROFILE_RETRY_WAITS_MS[retry - 1];
      await runtimePatch(
        { status: `@${username} verileri okunamadı; TikTok engeli için ${waitMs / 1000} sn bekleniyor (${retry}/${PERSONAL_PROFILE_RETRY_WAITS_MS.length})` },
        { level: "info", username, message: `Profil verisi okunamadı — ${waitMs / 1000} sn sonra yeniden denenecek (${retry}/${PERSONAL_PROFILE_RETRY_WAITS_MS.length})` }
      );
      await interruptibleDelay(waitMs);
      if (!controller.running) return "stopped";
      profile = await collectPersonalProfile(username, null, options);
    }
    timer.mark("veri");
    if (!controller.running) return "stopped";
    // Hiç veri alınamayan boş kart nota yazılmaz; yayıncı bu koşuda atlanır.
    if (profile.missing?.includes("profil")) {
      controller.personalBlockedStreak = (controller.personalBlockedStreak || 0) + 1;
      const outcome = await skip(
        "profile_blocked",
        `@${username} profil verisi okunamadı; sonraki yayıncıya geçiliyor`,
        "Profil verisi okunamadı (TikTok engeli) — atlandı"
      );
      if (controller.personalBlockedStreak >= PERSONAL_BLOCKED_STREAK_LIMIT) {
        await finishPersonalCollection(`TikTok profil isteklerini engelliyor (${controller.personalBlockedStreak} yayıncı üst üste okunamadı); 10-15 dk sonra tekrar başlatın`);
        return "stopped";
      }
      return outcome;
    }
    controller.personalBlockedStreak = 0;
    if (options.deferOnBlock) await liftPersonalBlock();
    // Takipçi önceden okunamadıysa (ör. engel sonrası yeniden deneme) toplanan profilden bakılır.
    if (followerCount === null && minFollowers > 0 && Number.isFinite(profile.followers) && profile.followers < minFollowers) {
      return skip(
        "low_followers",
        `@${username} takipçi filtresine uymadı; sonraki yayına geçiliyor`,
        `Takipçi sayısı ${formatFollowerCount(profile.followers)}; en az ${formatFollowerCount(minFollowers)} isteniyor`
      );
    }
    if (controller.settings.requireFiveActiveDays) {
      const days = profile.history?.days14;
      if (!Number.isFinite(days) || days < 5) {
        return skip(
          "low_active_days",
          `@${username} aktif gün filtresine uymadı; sonraki yayına geçiliyor`,
          Number.isFinite(days)
            ? `Son 14 günde ${days} aktif gün; en az 5 gün gerekiyor`
            : "Yayın geçmişi okunamadı; en az 5 aktif gün doğrulanamadı"
        );
      }
    }

    const latest = await getState();
    if (!latest?.runtime?.running) {
      controller.running = false;
      return "stopped";
    }
    const latestRows = Array.isArray(latest.runtime.personalRows) ? latest.runtime.personalRows : [];
    const nextRows = [...latestRows, { username, checkedAt: new Date().toISOString(), profile, ...(options.tikleap ? { tikleap: options.tikleap } : {}) }];
    await runtimePatch(
      {
        personalRows: nextRows,
        personalSeen: rememberPersonalSeen(latest.runtime.personalSeen, username),
        sent: nextRows.length,
        status: `@${username} kişisel mesaj notuna eklendi (${Number.isFinite(target) ? `${nextRows.length}/${target}` : nextRows.length})`
      },
      { level: "success", username, message: `Mevcut — ${describePersonalProfile(profile)}` }
    );
    if (nextRows.length >= target) {
      await recordTiming(username, "collected", timer);
      await finishPersonalCollection("İstenen sayıda yayıncı toplandı");
      return "finished";
    }
    return "collected";
  }

  // Tikleap kaynağı iki grupla, her grup iki aşamada çalışır. Önce o an canlı olanlar,
  // sonra canlı olmayanlar: kuyruktaki yayıncılar 30'arlı gruplar halinde İlişkiyi yönet
  // sihirbazında toplu kontrol edilir, ardından yalnız "Mevcut" çıkanların verileri
  // toplanır. Canlı olanlar önce işlendiği için anlık yayın verisi (izleyen, hediye atan)
  // yayın bitmeden okunur; canlı olmayanlar profilden okunan geçmiş ve kartla devam eder.
  // İlerleme depoda tutulur; sekme yenilense de sürer.
  async function runTikleapPersonalController() {
    const segments = [
      { label: "canlı yayındaki", has: (item) => item?.live === true },
      { label: "canlı olmayan", has: (item) => item?.live !== true }
    ];
    for (const segment of segments) {
      if (!(await runTikleapSegment(segment))) return;
    }
    const state = await getState();
    const queue = Array.isArray(state?.runtime?.personalQueue) ? state.runtime.personalQueue : [];
    const eligible = new Set(Array.isArray(state?.runtime?.personalEligible) ? state.runtime.personalEligible : []);
    const handled = queue.filter((item) => eligible.has(personalKey(item?.username))).length;
    await finishPersonalCollection(`Tikleap listesindeki ${queue.length} yayıncı kontrol edildi; ${handled} uygun yayıncı işlendi`);
  }

  async function runTikleapSegment(segment) {
    const first = await getState();
    const firstQueue = Array.isArray(first?.runtime?.personalQueue) ? first.runtime.personalQueue : [];
    if (!firstQueue.some(segment.has)) return true;
    await runtimePatch({ status: `Tikleap listesindeki ${segment.label} yayıncılar Backstage'de toplu kontrol ediliyor` });
    if (!(await runTikleapBatchPhase(segment))) return false;
    while (controller.running) {
      const timer = createPhaseTimer();
      const state = await getState();
      if (!state?.runtime?.running) {
        controller.running = false;
        return false;
      }
      const queue = Array.isArray(state.runtime.personalQueue) ? state.runtime.personalQueue : [];
      const eligible = new Set(Array.isArray(state.runtime.personalEligible) ? state.runtime.personalEligible : []);
      const done = personalDoneKeys(state.runtime);
      const pending = queue.filter((item) => segment.has(item) && eligible.has(personalKey(item?.username)));
      const index = pending.findIndex((item) => !done.has(personalKey(item.username)));
      if (index < 0) return true;
      const item = pending[index];
      await runtimePatch({ listIndex: index + 1, listTotal: pending.length });
      const outcome = await processPersonalCandidate(item.username, Infinity, timer, {
        visitProfile: true,
        eligibilityKnown: true,
        tikleap: { league: item.league, rank: item.rank }
      });
      if (outcome === "stopped" || outcome === "finished") return false;
      await recordTiming(item.username, outcome, timer);
      if (!controller.running) return false;
      await interruptibleDelay(outcome === "collected" ? randomCollectPacingMs() : randomSkipPacingMs());
    }
    return false;
  }

  async function runTikleapBatchPhase(segment) {
    while (controller.running) {
      const state = await getState();
      if (!state?.runtime?.running) {
        controller.running = false;
        return false;
      }
      const queue = (Array.isArray(state.runtime.personalQueue) ? state.runtime.personalQueue : []).filter(segment.has);
      const eligible = new Set(Array.isArray(state.runtime.personalEligible) ? state.runtime.personalEligible : []);
      const done = personalDoneKeys(state.runtime);
      const pending = queue.filter((item) => item?.username && !done.has(personalKey(item.username)) && !eligible.has(personalKey(item.username)));
      if (!pending.length) {
        const eligibleCount = queue.filter((item) => eligible.has(personalKey(item?.username))).length;
        await runtimePatch(
          { status: `Toplu kontrol bitti (${segment.label}): ${eligibleCount} uygun yayıncı; veriler toplanacak` },
          { level: "info", username: "", message: `Backstage toplu kontrol: ${queue.length} ${segment.label} yayıncıdan ${eligibleCount} kişi uygun` }
        );
        return true;
      }

      // Geçme listesi ve mesaj geçmişi Backstage'den önce elenir.
      const batch = [];
      for (const item of pending) {
        if (batch.length >= TIKLEAP_BATCH_SIZE) break;
        if (isManualSkipUsername(item.username)) {
          await skipPersonalCandidate(item.username, "Geçme listesinde — atlandı", "info");
          continue;
        }
        const history = await sendRuntimeMessageWithTimeout(
          { type: "BTG_MESSAGE_HISTORY_HAS", username: item.username },
          15000,
          "Mesaj gönderilmiş yayıncı geçmişi kontrolü yanıt vermedi."
        );
        if (!controller.running) return false;
        if (history?.messaged) {
          await skipPersonalCandidate(item.username, "Daha önce mesaj gönderilmiş — atlandı", "info");
          continue;
        }
        batch.push(item.username);
      }
      if (!batch.length) continue;

      const checked = queue.length - pending.length;
      await runtimePatch({ status: `Backstage toplu kontrol: ${batch.length} yayıncı (${checked}/${queue.length} tamamlandı)` });
      const result = await sendRuntimeMessageWithTimeout(
        { type: "BTG_CHECK_ELIGIBILITY_BATCH", usernames: batch },
        BACKSTAGE_BATCH_TIMEOUT_MS,
        "Backstage toplu kontrolü zamanında tamamlanmadı."
      );
      if (!controller.running) return false;
      if (!result?.ok || !result.results) {
        await stopWithError(result?.error || "Backstage toplu kontrolü başarısız.");
        return false;
      }
      for (const username of batch) {
        const verdict = result.results[username] || { eligible: false, unknown: true, reason: "Backstage sonucu okunamadı" };
        if (verdict.eligible) {
          const latest = await getState();
          const list = Array.isArray(latest?.runtime?.personalEligible) ? latest.runtime.personalEligible : [];
          await runtimePatch(
            { personalEligible: [...list.filter((key) => key !== personalKey(username)), personalKey(username)] },
            { level: "info", username, message: "Backstage toplu kontrol: Mevcut — verileri toplanacak" }
          );
        } else {
          await skipPersonalCandidate(username, verdict.unknown
            ? "Backstage toplu kontrolde sonuç okunamadı — atlandı"
            : `Uygun değil — ${verdict.reason || "Mevcut durumu görülmedi"}`);
        }
      }
    }
    return false;
  }

  function personalKey(username) {
    return String(username || "").toLocaleLowerCase("tr");
  }

  function personalDoneKeys(runtime) {
    const done = new Set(Array.isArray(runtime?.personalSeen) ? runtime.personalSeen : []);
    for (const row of Array.isArray(runtime?.personalRows) ? runtime.personalRows : []) done.add(personalKey(row?.username));
    return done;
  }

  async function skipPersonalCandidate(username, message, level = "skip") {
    const latest = await getState();
    await runtimePatch(
      {
        skipped: Number(latest?.runtime?.skipped || 0) + 1,
        personalSeen: rememberPersonalSeen(latest?.runtime?.personalSeen, username)
      },
      { level, username, message }
    );
  }

  // Tikleap kaynağında veriler yayıncının profilinin açıldığı yeni sekmede toplanır;
  // o sekme açılamazsa aynı veriler kontrol sekmesinden okunur.
  async function collectPersonalProfile(username, basics, options = {}) {
    if (options.visitProfile) {
      await runtimePatch({ status: `@${username} uygun; profili yeni sekmede açılıp veriler toplanıyor` });
      const visit = await sendRuntimeMessageWithTimeout(
        { type: "BTG_PERSONAL_VISIT", username },
        90000,
        "Profil sekmesi 90 saniye içinde veri döndürmedi."
      );
      if (visit?.ok && visit.profile) return visit.profile;
      await runtimePatch({}, {
        level: "info",
        username,
        message: `Profil sekmesinde veri toplanamadı (${visit?.error || "yanıt yok"}); kontrol sekmesinden okunuyor`
      });
    }
    return window.BTGPersonalProfile.collect(username, basics ? { basics } : {});
  }

  async function checkPersonalEligibility(username) {
    await runtimePatch({ status: `@${username} Backstage üzerinde kontrol ediliyor` });
    return sendRuntimeMessageWithTimeout(
      { type: "BTG_CHECK_ELIGIBILITY", username },
      70000,
      "Backstage uygunluk kontrolü 70 saniye içinde tamamlanmadı."
    );
  }

  // Canlı akışta TikTok engeline takılan uygun yayıncı kenara alınır (depoda tutulur;
  // sekme yenilense de kaybolmaz). failures: o ana kadarki başarısız okuma sayısı;
  // 0 ise engel sürdüğü için hiç denenmeden sıraya alınmıştır.
  async function deferPersonalCandidate(username, failures) {
    const now = Date.now();
    if (failures > 0) {
      const waitMs = PERSONAL_PROFILE_RETRY_WAITS_MS[failures - 1];
      controller.personalBlockedUntil = Math.max(controller.personalBlockedUntil || 0, now + waitMs);
    }
    const dueAt = failures > 0
      ? now + PERSONAL_PROFILE_RETRY_WAITS_MS[failures - 1]
      : Math.max(now, controller.personalBlockedUntil || 0);
    const seconds = Math.round((dueAt - now) / 1000);
    const latest = await getState();
    const key = personalKey(username);
    const deferred = (Array.isArray(latest?.runtime?.personalDeferred) ? latest.runtime.personalDeferred : [])
      .filter((entry) => personalKey(entry?.username) !== key);
    await runtimePatch(
      {
        personalDeferred: [...deferred, { username, failures, dueAt }],
        personalSeen: rememberPersonalSeen(latest?.runtime?.personalSeen, username),
        status: `@${username} verileri okunamadı (TikTok engeli); ${seconds} sn sonra yeniden denenecek, akış devam ediyor`
      },
      {
        level: "info",
        username,
        message: failures > 0
          ? `Profil verisi okunamadı — ${seconds} sn sonra yeniden denenecek (${failures}/${PERSONAL_PROFILE_RETRY_WAITS_MS.length}); bu arada akış sürüyor`
          : `TikTok engeli sürüyor — profil ${seconds} sn sonra okunacak; bu arada akış sürüyor`
      }
    );
    return "deferred";
  }

  // Bir profil okunabildiyse engel kalkmıştır; bekleyen yayıncılar sırayla hemen denenir.
  async function liftPersonalBlock() {
    controller.personalBlockedUntil = 0;
    const latest = await getState();
    const deferred = Array.isArray(latest?.runtime?.personalDeferred) ? latest.runtime.personalDeferred : [];
    const now = Date.now();
    if (!deferred.some((entry) => Number(entry?.dueAt) > now)) return;
    await runtimePatch({ personalDeferred: deferred.map((entry) => ({ ...entry, dueAt: Math.min(Number(entry.dueAt) || now, now) })) });
  }

  // Akışın her adımında süresi dolan en eski kenara alınmış yayıncı yeniden denenir.
  // Backstage uygunluğu zaten okunduğu için yalnız geçmiş ve profil verisi tekrarlanır.
  async function retryDeferredPersonal(target) {
    const state = await getState();
    const deferred = Array.isArray(state?.runtime?.personalDeferred) ? state.runtime.personalDeferred : [];
    const now = Date.now();
    const item = deferred.find((entry) => entry?.username && Number(entry.dueAt) <= now);
    if (!item) return null;
    await runtimePatch({ personalDeferred: deferred.filter((entry) => entry !== item && entry?.username !== item.username) });
    const timer = createPhaseTimer();
    const outcome = await processPersonalCandidate(item.username, target, timer, {
      deferOnBlock: true,
      eligibilityKnown: true,
      deferredFailures: Number(item.failures) || 0
    });
    if (outcome === "stopped" || outcome === "finished") return outcome;
    await recordTiming(item.username, `retry_${outcome}`, timer);
    if (outcome === "collected" && controller.running) await interruptibleDelay(randomCollectPacingMs());
    return outcome;
  }

  function rememberPersonalSeen(list, username) {
    const key = String(username || "").toLocaleLowerCase("tr");
    const current = Array.isArray(list) ? list.filter((item) => item !== key) : [];
    return [...current, key].slice(-3000);
  }

  function describePersonalProfile(profile) {
    const parts = [];
    if (Number.isFinite(profile?.followers)) parts.push(`${formatFollowerCount(profile.followers)} takipçi`);
    if (Number.isFinite(profile?.history?.days30)) parts.push(`30 günde ${profile.history.days30} yayın günü`);
    parts.push(profile?.angles?.length ? `öne çıkan: ${profile.angles.join(", ")}` : "belirgin öne çıkan yok");
    if (profile?.missing?.length) parts.push(`okunamayan: ${profile.missing.join(", ")}`);
    return parts.join(" · ");
  }

  async function finishPersonalCollection(message) {
    controller.running = false;
    let saveError = "";
    try {
      await savePersonalOnExit();
    } catch (error) {
      saveError = error?.message || String(error);
    }
    await runtimePatch({
      running: false,
      status: saveError
        ? `${message}; çıktı klasörü iznini kontrol edip model notunu tekrar kaydedin`
        : `${message}; model notu çıktı klasörüne kaydedildi`
    });
  }

  // Not arka planda yazılır; aynı kayıt kümesi iki kez kaydedilmez.
  async function savePersonalOnExit() {
    const stored = await chrome.storage.local.get("runtime");
    const rows = Array.isArray(stored.runtime?.personalRows) ? stored.runtime.personalRows : [];
    if (!rows.length) return null;
    const key = rows.map((row) => row?.username).join(",");
    if (controller.personalExportKey === key && controller.personalExport) return controller.personalExport;
    controller.personalExportKey = key;
    controller.personalExport = (async () => {
      const result = await sendRuntimeMessageWithTimeout(
        { type: "BTG_EXPORT_PERSONAL" },
        30000,
        "Model notu kaydı 30 saniye içinde tamamlanmadı."
      );
      if (!result?.ok) throw new Error(result?.error || "Model notu kaydedilemedi.");
      return result;
    })().catch((error) => {
      controller.personalExportKey = "";
      throw error;
    });
    return controller.personalExport;
  }

  // needPoint: yalnız yedek tıklama yolunda gerekir. Ana yolda sohbet doğrudan
  // adresle açıldığı için düğmenin ekran konumu kullanılmaz; bu durumda sayfanın
  // React tarafından devralınması beklenmez ve hedef bağlantı bulunur bulunmaz
  // dönülür.
  async function openProfileMessage(needPoint) {
    const username = getProfileUsername();
    if (!username) {
      return {
        ok: false,
        retryableProfile: true,
        error: "TikTok profil sayfası henüz hazır değil."
      };
    }

    let messageButtonSeen = false;
    const startedAt = Date.now();
    const destination = await waitFor(() => {
      const button = findProfileMessageButton();
      if (button) {
        messageButtonSeen = true;
        const businessUrl = findProfileBusinessMessageUrl(button);
        if (businessUrl) {
          return {
            businessUrl,
            messageButtonPoint: getTopViewportPoint(button)
          };
        }
      }
      if (findProfilePageError()) return { pageError: true };
      // TikTok bazen profil verisini hiç göndermeden boş bir kabuk döndürüyor
      // (başlık "TikTok - Make Your Day" kalıyor, profil başlığı hiç gelmiyor).
      // Sağlıklı profil 2 saniyede başlığı gösterdiğinden, 4 saniye sonra hâlâ
      // içerik yoksa 10 saniye beklenmeden yenilemeye gidilir.
      if (Date.now() - startedAt > PROFILE_EMPTY_SHELL_MS && !hasProfileContent(username)) {
        return { emptyShell: true };
      }
      // Düğme görünüp hedef bağlantısı oluşmuyorsa (TikTok kabuğu gönderip
      // veriyi tamamlamadığında) 10 saniye beklemek yerine erken yenilenir.
      if (messageButtonSeen && Date.now() - startedAt > PROFILE_LINK_STALL_MS) {
        return { linkStalled: true };
      }
      return null;
    }, 10000);

    if (destination?.linkStalled) {
      return {
        ok: false,
        retryableProfile: true,
        error: "Mesaj düğmesi bulundu ancak hedef Business Suite bağlantısı 5 saniyede oluşmadı; sayfa yenilenecek."
      };
    }

    if (destination?.emptyShell) {
      return {
        ok: false,
        retryableProfile: true,
        error: "TikTok profil sayfası içeriksiz (boş kabuk) yüklendi; sayfa yenilenecek."
      };
    }

    if (destination?.businessUrl) {
      if (!needPoint) {
        // Ana yol: hedef bağlantı yeterli; devralınma beklenmez.
        return {
          ok: true,
          destinationUrl: destination.businessUrl,
          destinationType: "business-suite"
        };
      }

      // Yedek tıklama yolu: sayfa React tarafından devralınmadan (başlık hâlâ
      // "tiktok.com/@ad" biçimindeyken) gönderilen tıklama sohbeti açmıyor.
      // Kısa süre devralınması beklenir ve düğme konumu yeniden okunur.
      await waitFor(() => isProfileHydrated(username), PROFILE_HYDRATION_WAIT_MS);
      const button = findProfileMessageButton();
      const hydratedUrl = button ? findProfileBusinessMessageUrl(button) : "";
      return {
        ok: true,
        destinationUrl: hydratedUrl || destination.businessUrl,
        destinationType: "business-suite",
        messageButtonPoint: button ? getTopViewportPoint(button) : destination.messageButtonPoint,
        hydrated: isProfileHydrated(username)
      };
    }

    if (destination?.pageError || !isProfileHeaderReady(username)) {
      return {
        ok: false,
        retryableProfile: true,
        error: "TikTok profili geçici olarak yüklenemedi; sayfa yenilenecek."
      };
    }

    if (messageButtonSeen) {
      return {
        ok: false,
        retryableProfile: true,
        error: "Mesaj düğmesi bulundu ancak hedef Business Suite bağlantısı henüz oluşmadı."
      };
    }

    return {
      ok: false,
      profileUnavailable: true,
      error: "Profil yüklendi ancak “Mesaj” düğmesi yok. Mesaj gizliliği veya takip koşulu uygun olmayabilir."
    };
  }

  // Profil sayfasının veriyle birlikte devralındığını gösteren işaretler:
  // başlık "Ad (@ad) | TikTok" biçimine döner veya profil başlığı görünür olur.
  const PROFILE_HYDRATION_WAIT_MS = 2500;
  const PROFILE_EMPTY_SHELL_MS = 4000;
  const PROFILE_LINK_STALL_MS = 5000;

  function hasProfileContent(username) {
    if (isProfileHydrated(username)) return true;
    return Boolean(
      document.querySelector(
        '[data-e2e="user-page"], [data-e2e="user-title"], [data-e2e="user-subtitle"], [data-e2e="user-avatar"], [data-e2e="message-button"]'
      )
    );
  }

  function isProfileHydrated(username) {
    const expected = String(username || "").replace(/^@/, "").toLocaleLowerCase("tr");
    if (!expected) return false;
    const title = String(document.title || "").toLocaleLowerCase("tr");
    if (title.includes(`(@${expected})`)) return true;
    return isProfileHeaderReady(username);
  }

  function findProfileBusinessMessageUrl(messageControl) {
    const anchor =
      messageControl.closest('a[href*="/business-suite/messages"]') ||
      messageControl.closest('a[href*="/messages"]') ||
      messageControl.closest("a[href]");
    if (!anchor) return "";

    try {
      const url = new URL(anchor.href || anchor.getAttribute("href") || "", location.href);
      const isTikTok =
        url.hostname === "tiktok.com" ||
        url.hostname.endsWith(".tiktok.com");
      const isMessageRoute =
        url.pathname === "/business-suite/messages" ||
        url.pathname === "/messages";
      const targetUserId = url.searchParams.get("u");
      if (!isTikTok || !isMessageRoute || !targetUserId) return "";

      if (url.pathname === "/business-suite/messages") return url.href;

      const businessUrl = new URL("/business-suite/messages", url.origin);
      businessUrl.searchParams.set("from", "homepage");
      businessUrl.searchParams.set("lang", url.searchParams.get("lang") || "tr-TR");
      businessUrl.searchParams.set("u", targetUserId);
      return businessUrl.href;
    } catch {
      return "";
    }
  }

  const FOLLOWER_COUNT_SELECTORS = [
    '[data-e2e="followers-count"]',
    '[data-e2e="user-followers-count"]',
    '[data-e2e="followers"] strong',
    '[data-testid="followers-count"]'
  ];

  const FOLLOWER_LABELS = ["takipçi", "takipçiler", "takipci", "followers", "follower"];

  // Yayın başlığındaki yayıncı kartı, fareyle üzerine gelindiğinde gövdeye
  // floating-ui portalı olarak bir popover ekler; takipçi sayısı bu popover'da
  // görünür. Sayaç buradan okunduğunda profil sekmesi açmaya gerek kalmaz.
  // Canlı ölçümde kart açılıyorsa yarım saniyede açıldı; açılmadığında her
  // bekleme boşa gittiğinden süreler kısa tutulur.
  const LIVE_FOLLOWER_TRIGGER_TIMEOUT_MS = 2500;
  const LIVE_FOLLOWER_POPOVER_TIMEOUTS_MS = [1500, 1200];
  const LIVE_FOLLOWER_CARD_FAILURE_LIMIT = 3;
  // Kart üst üste açılmayınca bu kadar yayıncı boyunca kart denenmez. Canlı
  // gözlemde kart aralıklı olarak açılmıyor; oturum boyunca kapatmak her düşük
  // takipçili hesap için Backstage + profil sekmesi maliyeti (12-14 sn) getiriyordu.
  const LIVE_FOLLOWER_CARD_COOLDOWN = 5;

  function clampFollowerThreshold(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.min(1000000000, Math.round(numeric));
  }

  function isReadableFollowerCount(value) {
    // null, "" veya tanımsız yanıtlar 0 takipçi sanılmamalı; bunlar okunamamış sayaçtır.
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  function isLiveFollowerFilterActive() {
    return (
      controller.settings?.mode === "live" &&
      clampFollowerThreshold(controller.settings?.minFollowers) > 0
    );
  }

  async function applyLiveFollowerGate(username) {
    const minFollowers = clampFollowerThreshold(controller.settings?.minFollowers);
    if (!isLiveFollowerFilterActive()) return { skip: false, count: null, minFollowers };
    // Kart az önce üst üste açılmadıysa birkaç yayıncı boyunca beklenmeden
    // geçilir; sayaç profil sekmesinden okunur, sonra kart yeniden denenir.
    if (Number(controller.liveCardCooldown) > 0) {
      controller.liveCardCooldown -= 1;
      return { skip: false, count: null, minFollowers };
    }

    await runtimePatch({
      currentUsername: username,
      status: `@${username} takipçi sayısı yayın ekranından okunuyor (en az ${formatFollowerCount(minFollowers)})`
    });

    const reading = await readLiveFollowerCount(username);
    if (!controller.running) return { skip: false, count: null, minFollowers };

    if (!reading?.ok || !isReadableFollowerCount(reading.count)) {
      // Yayın kartı okunamazsa akış durmaz; sayaç eskisi gibi profil sekmesinde
      // yeniden denenir. Böylece hız kazanılırken kapsam daralmaz.
      controller.liveCardFailures = Number(controller.liveCardFailures || 0) + 1;
      const giveUp = controller.liveCardFailures >= LIVE_FOLLOWER_CARD_FAILURE_LIMIT;
      if (giveUp) {
        controller.liveCardCooldown = LIVE_FOLLOWER_CARD_COOLDOWN;
        controller.liveCardFailures = 0;
      }
      await runtimePatch(
        {
          currentUsername: username,
          status: `@${username} takipçi sayısı yayın ekranından okunamadı; profil sekmesinde denenecek`
        },
        {
          level: "info",
          username,
          message: `Takipçi sayısı yayın kartından okunamadı; profil sekmesinde denenecek${
            reading?.error ? `: ${reading.error}` : ""
          }${
            giveUp
              ? ` — kart üst üste ${LIVE_FOLLOWER_CARD_FAILURE_LIMIT} kez açılmadı; sonraki ${LIVE_FOLLOWER_CARD_COOLDOWN} yayıncıda sayaç doğrudan profil sekmesinden okunacak, sonra kart yeniden denenecek`
              : ""
          }`
        }
      );
      return { skip: false, count: null, minFollowers };
    }

    controller.liveCardFailures = 0;
    const count = Math.max(0, Math.round(Number(reading.count)));
    if (count >= minFollowers) {
      await runtimePatch(
        {
          currentUsername: username,
          status: `@${username} takipçi filtresini geçti (${formatFollowerCount(count)})`
        },
        {
          level: "info",
          username,
          message: `Takipçi sayısı yayın kartından okundu: ${formatFollowerCount(
            count
          )} (en az ${formatFollowerCount(minFollowers)})`
        }
      );
      return { skip: false, count, minFollowers };
    }

    const latest = await getState();
    const latestProcessed = Array.isArray(latest?.runtime?.processed) ? latest.runtime.processed : [];
    await runtimePatch(
      {
        currentUsername: username,
        skipped: Number(latest?.runtime?.skipped || 0) + 1,
        processed: [
          ...latestProcessed,
          {
            username,
            result: "low_followers",
            time: new Date().toISOString(),
            backstageChecked: false,
            followerCount: count,
            minFollowers
          }
        ],
        status: `@${username} takipçi filtresine uymadı; sonraki ${nextItemName()} geçiliyor`
      },
      {
        level: "skip",
        username,
        message: `Takipçi sayısı ${formatFollowerCount(count)}; en az ${formatFollowerCount(
          minFollowers
        )} isteniyor — Backstage kontrolü ve profil sekmesi açılmadan atlandı`
      }
    );
    return { skip: true, count, minFollowers };
  }

  async function readLiveFollowerCount(rawUsername) {
    const expected = String(rawUsername || "").replace(/^@/, "").trim();
    if (!expected) return { ok: false, error: "Takipçi sayısı için yayıncı adı bilinmiyor." };
    if (!usernamesMatch(getLiveUsername(), expected)) {
      return {
        ok: false,
        error: `Açık CANLI Yayın sayfası @${expected} hesabına ait değil.`
      };
    }

    // Yayıncı kartı bir kez açıldıysa popover DOM'da kalabiliyor; önce mevcut
    // popover denenir, yoksa kart üzerine gelinir.
    const opened = readFollowerCountFromLivePopover(expected);
    if (opened) return { ok: true, ...opened };

    const trigger = await waitFor(
      () => findLiveAnchorHoverTrigger(expected),
      LIVE_FOLLOWER_TRIGGER_TIMEOUT_MS
    );
    if (!trigger) {
      return { ok: false, error: "Yayın başlığındaki yayıncı kartı bulunamadı." };
    }

    // Kartı açan dinleyicinin hangi öğede olduğu TikTok sürümüne göre değişiyor;
    // olaylar dıştan içe doğru tüm aday öğelere gönderilir. Gerçek farede de
    // olayın hedefi en içteki öğedir, üst zincir bundan türetilir.
    const hoverTargets = collectLiveHoverTargets(trigger);

    try {
      for (const timeoutMs of LIVE_FOLLOWER_POPOVER_TIMEOUTS_MS) {
        if (!controller.running) break;
        for (const target of hoverTargets) hoverLiveAnchor(target);
        const reading = await waitFor(() => readFollowerCountFromLivePopover(expected), timeoutMs);
        if (reading) return { ok: true, ...reading };
        for (const target of hoverTargets) unhoverLiveAnchor(target);
        await delay(400);
      }
    } finally {
      for (const target of hoverTargets) unhoverLiveAnchor(target);
    }

    return { ok: false, error: "Yayıncı kartı açılmadı veya takipçi sayısı görünmedi." };
  }

  function collectLiveHoverTargets(trigger) {
    const targets = [];
    const push = (element) => {
      if (element instanceof HTMLElement && !targets.includes(element)) targets.push(element);
    };

    // Dıştan içe: yayıncı kartı kutusu → kartı açan bağlantı → avatar → görsel.
    push(trigger.closest('[role="link"]'));
    push(trigger);
    const avatar = trigger.querySelector('[data-e2e="room-header-anchor-avatar"]');
    push(avatar);
    const innermost = avatar || trigger;
    push(innermost.querySelector("img") || innermost.lastElementChild);
    return targets;
  }

  function findLiveAnchorHoverTrigger(username) {
    const header =
      document.querySelector('[data-e2e="live-header-container"]') ||
      document.querySelector('[data-e2e="live-room-content"]') ||
      document.querySelector('[data-e2e="live-content-container"]');
    if (!header) return null;

    for (const mark of ['[data-e2e="room-header-anchor-avatar"]', '[data-e2e="room-header-anchor-name"]']) {
      const marked = header.querySelector(mark);
      if (!marked) continue;
      const trigger =
        marked.closest('[aria-haspopup="dialog"]') || marked.closest("a[href*='/@']") || marked;
      if (!(trigger instanceof HTMLElement) || !isVisible(trigger)) continue;
      // Yayın değişirken başlık bir süre önceki yayıncıyı gösterebiliyor; bu
      // durumda kart açılmaz, başlığın hedef hesaba güncellenmesi beklenir.
      const linked = getUsernameFromProfileLink(trigger.closest("a[href*='/@']") || trigger);
      if (linked && !usernamesMatch(linked, username)) continue;
      return trigger;
    }

    // Yedek: başlıkta hedef hesaba giden profil bağlantısı.
    for (const link of header.querySelectorAll("a[href*='/@']")) {
      if (!usernamesMatch(getUsernameFromProfileLink(link), username)) continue;
      const trigger = link.closest('[aria-haspopup="dialog"]') || link;
      if (trigger instanceof HTMLElement && isVisible(trigger)) return trigger;
    }
    return null;
  }

  function readFollowerCountFromLivePopover(username) {
    const popovers = document.querySelectorAll(
      '[data-floating-ui-portal] [role="dialog"], [role="dialog"], [class*="tux-popover"]'
    );
    for (const popover of popovers) {
      if (!(popover instanceof HTMLElement)) continue;
      // Kapanmakta olan kart yalnız kökünde saydamlaşır; iç sarmalayıcının kendi
      // opaklığı 1 kaldığı için görünürlük üst zincirle birlikte denetlenir.
      if (!isRenderedPopover(popover)) continue;
      // Önceki yayıncıya ait açık kalan kart yanlışlıkla okunmamalı.
      if (!livePopoverBelongsTo(popover, username)) continue;

      const labeled = readLabeledFollowerCount(popover);
      if (labeled) return { ...labeled, source: `yayın kartı — ${labeled.source}` };

      const combined = readCombinedFollowerCount(popover);
      if (combined) return { ...combined, source: `yayın kartı — ${combined.source}` };
    }
    return null;
  }

  function isRenderedPopover(element) {
    if (!isVisible(element)) return false;
    let current = element.parentElement;
    while (current instanceof Element) {
      const style = getComputedStyle(current);
      if (
        style.visibility === "hidden" ||
        style.display === "none" ||
        Number(style.opacity || 1) <= 0.05
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  function livePopoverBelongsTo(popover, username) {
    for (const link of popover.querySelectorAll("a[href*='/@']")) {
      if (usernamesMatch(getUsernameFromProfileLink(link), username)) return true;
    }
    return false;
  }

  // "391 Takipçiler" gibi tek düğümde birleşmiş sayaçlar için yedek okuma.
  function readCombinedFollowerCount(scope) {
    for (const node of scope.querySelectorAll("p, span, div, strong, h2, h3")) {
      const text = compactText(node.innerText || node.textContent || "");
      if (!text || text.length > 48) continue;
      const match = text.toLocaleLowerCase("tr").match(/^(.+?)\s*([a-zçğıöşü]+)$/);
      if (!match || !FOLLOWER_LABELS.includes(match[2])) continue;
      const count = parseFollowerCountText(match[1]);
      if (count === null) continue;
      return { count, source: "birleşik takipçi metni", raw: text };
    }
    return null;
  }

  function hoverLiveAnchor(element) {
    dispatchHoverEvents(
      element,
      ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"],
      null
    );
  }

  function unhoverLiveAnchor(element) {
    // relatedTarget olarak React ağacının dışındaki bir düğüm verilir; React
    // mouseleave olayını bu bilgiyle tüm üst zincir için üretir.
    dispatchHoverEvents(
      element,
      ["pointerout", "pointerleave", "mouseout", "mouseleave"],
      document.documentElement
    );
  }

  function dispatchHoverEvents(element, names, relatedTarget) {
    if (!(element instanceof Element)) return;
    const rect = element.getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    for (const name of names) {
      // React, mouseenter/mouseleave olaylarını kabarcıklanan mouseover/mouseout
      // olaylarından türetir; bu yüzden kabarcıklanma ayarı olay adına göre verilir.
      const init = {
        bubbles: !/enter|leave$/.test(name),
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY,
        relatedTarget
      };
      try {
        if (name.startsWith("pointer")) {
          if (typeof PointerEvent !== "function") continue;
          element.dispatchEvent(
            new PointerEvent(name, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })
          );
        } else {
          element.dispatchEvent(new MouseEvent(name, init));
        }
      } catch {
        // Tek bir olay türü desteklenmezse diğerleri denenmeye devam eder.
      }
    }
  }

  async function readProfileFollowerCount(rawUsername) {
    const expected = String(rawUsername || "").replace(/^@/, "").trim();
    const pageUsername = getProfileUsername();
    if (!pageUsername) {
      return { ok: false, error: "Takipçi sayısı için TikTok profil sayfası açık değil." };
    }
    if (expected && !usernamesMatch(pageUsername, expected)) {
      return {
        ok: false,
        error: `Profil sekmesi @${expected} yerine @${pageUsername} hesabını gösteriyor.`
      };
    }

    const target = expected || pageUsername;
    const embedded = readEmbeddedFollowerCount(target);
    if (embedded) return { ok: true, ...embedded };

    const visible = await waitFor(() => readVisibleFollowerCount(), 8000);
    if (visible) return { ok: true, ...visible };

    // Sayfa geç yüklenen sürümlerde gömülü JSON, görünür sayaçtan sonra oluşabiliyor.
    const lateEmbedded = readEmbeddedFollowerCount(target);
    if (lateEmbedded) return { ok: true, ...lateEmbedded };

    return {
      ok: false,
      error: findProfilePageError()
        ? "Profil sayfası geçici hata gösterdiği için takipçi sayısı okunamadı."
        : "Profil sayfasında takipçi sayısı bulunamadı."
    };
  }

  function readEmbeddedFollowerCount(username) {
    const expected = String(username || "").replace(/^@/, "").toLocaleLowerCase("tr");
    if (!expected) return null;

    const scripts = [
      ...document.querySelectorAll(
        'script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE, script[type="application/json"]'
      )
    ];
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text.includes("followerCount") && !text.includes("follower_count")) continue;
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      const count = findFollowerCountInJson(data, expected);
      if (count !== null) {
        return {
          count,
          source: script.id ? `script#${script.id}` : "gömülü profil verisi",
          raw: String(count)
        };
      }
    }
    return null;
  }

  function findFollowerCountInJson(root, expectedUsername) {
    const expected = String(expectedUsername || "").replace(/^@/, "").toLocaleLowerCase("tr");
    if (!expected || !root || typeof root !== "object") return null;

    const seen = new Set();
    const queue = [root];
    let visited = 0;
    while (queue.length && visited < 40000) {
      const node = queue.shift();
      visited += 1;
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);

      if (!Array.isArray(node)) {
        // Yalnız hedef hesaba ait sayaç kabul edilir; önerilen hesapların sayaçları kullanılmaz.
        const ownCount = readFollowerCountField(node);
        if (ownCount !== null && readJsonUniqueId(node) === expected) return ownCount;

        const pairedCount = readFollowerCountField(node.stats) ?? readFollowerCountField(node.statsV2);
        if (pairedCount !== null && readJsonUniqueId(node.user) === expected) return pairedCount;

        for (const [key, value] of Object.entries(node)) {
          if (String(key).replace(/^@/, "").toLocaleLowerCase("tr") !== expected) continue;
          const keyedCount = readFollowerCountField(value) ?? readFollowerCountField(value?.stats);
          if (keyedCount !== null) return keyedCount;
        }
      }

      for (const value of Object.values(node)) {
        if (value && typeof value === "object") queue.push(value);
      }
    }
    return null;
  }

  function readFollowerCountField(node) {
    if (!node || typeof node !== "object") return null;
    const raw = node.followerCount ?? node.follower_count;
    if (typeof raw === "number") {
      return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
    }
    const text = String(raw ?? "").trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  }

  function readJsonUniqueId(node) {
    if (!node || typeof node !== "object") return "";
    const raw = node.uniqueId ?? node.unique_id ?? node.uniqueIdModified ?? "";
    return String(raw || "").replace(/^@/, "").toLocaleLowerCase("tr");
  }

  function readVisibleFollowerCount() {
    for (const selector of FOLLOWER_COUNT_SELECTORS) {
      for (const element of document.querySelectorAll(selector)) {
        const reading = readFollowerCountFromElement(element, selector);
        if (reading) return reading;
      }
    }
    return readLabeledFollowerCount();
  }

  function readLabeledFollowerCount(root) {
    const scope =
      root ||
      document.querySelector('[data-e2e="user-page"]') ||
      document.querySelector("main") ||
      document.body;
    if (!scope) return null;

    for (const node of scope.querySelectorAll("span, div, strong, h2, h3, p")) {
      if (node.children.length) continue;
      const label = compactText(node.textContent || "").toLocaleLowerCase("tr");
      if (!FOLLOWER_LABELS.includes(label)) continue;
      const container = node.parentElement;
      if (!container) continue;
      for (const sibling of container.children) {
        if (sibling === node) continue;
        const reading = readFollowerCountFromElement(sibling, "takipçi etiketi");
        if (reading) return reading;
      }
    }
    return null;
  }

  function readFollowerCountFromElement(element, source) {
    if (!element) return null;
    const title = element.getAttribute ? element.getAttribute("title") : null;
    const titleCount = parseFollowerCountText(title);
    if (titleCount !== null) {
      return { count: titleCount, source: `${source}[title]`, raw: compactText(title) };
    }
    const text = compactText(element.innerText || element.textContent || "");
    const textCount = parseFollowerCountText(text);
    if (textCount !== null) return { count: textCount, source, raw: text };
    return null;
  }

  function parseFollowerCountText(value) {
    // compactText, bölünemez boşluk dâhil tüm boşluk türlerini normal boşluğa indirger.
    const text = compactText(value).toLocaleLowerCase("tr");
    if (!text) return null;
    const match = text.match(/^([0-9][0-9.,\s]*)([a-zçğıöşü]{0,3})$/);
    if (!match) return null;

    const digits = match[1].replace(/\s/g, "").replace(/[.,]+$/, "");
    const multiplier = followerSuffixMultiplier(match[2]);
    if (!multiplier) return null;

    if (multiplier === 1) {
      // Kısaltmasız sayaçlarda nokta ve virgül binlik ayıracıdır: "1.234" → 1234.
      const plain = digits.replace(/[^0-9]/g, "");
      return plain ? Number(plain) : null;
    }

    // Kısaltmalı sayaçlarda son ayıraç ondalık ayıracıdır: "12,3B" → 12300.
    const lastSeparator = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
    const whole = (lastSeparator === -1 ? digits : digits.slice(0, lastSeparator)).replace(/[^0-9]/g, "");
    const fraction = (lastSeparator === -1 ? "" : digits.slice(lastSeparator + 1)).replace(/[^0-9]/g, "");
    const numeric = Number(`${whole || "0"}.${fraction || "0"}`);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric * multiplier);
  }

  function followerSuffixMultiplier(rawSuffix) {
    const suffix = String(rawSuffix || "").replace(/[.\s]/g, "");
    if (!suffix) return 1;
    if (suffix === "k" || suffix === "bin") return 1000;
    // TikTok Türkçe arayüzünde "B" bin, İngilizce arayüzünde milyar anlamına gelir.
    if (suffix === "b" || suffix === "bn") return isTurkishInterface() ? 1000 : 1000000000;
    if (suffix === "m" || suffix === "mn" || suffix === "mil") return 1000000;
    if (suffix === "g" || suffix === "mr" || suffix === "mlr") return 1000000000;
    return 0;
  }

  function isTurkishInterface() {
    const documentLanguage = String(document.documentElement?.lang || "").toLowerCase();
    if (documentLanguage) return documentLanguage.startsWith("tr");
    return String(navigator.language || "").toLowerCase().startsWith("tr");
  }

  function formatFollowerCount(value) {
    if (value === null || value === undefined || value === "") return "bilinmiyor";
    const count = Number(value);
    if (!Number.isFinite(count)) return "bilinmiyor";
    return Math.round(count).toLocaleString("tr-TR");
  }

  async function sendProfileDm(rawMessage, rawUsername, knownMessages = []) {
    const message = String(rawMessage || "").trim();
    const expectedUsername = String(rawUsername || "").replace(/^@/, "");
    if (!message) return { ok: false, error: "DM metni boş." };

    let lastConversationUsername = "";
    const destination = await waitFor(() => {
      if (findMessagePageError()) return { pageError: true };
      const composer = findDmComposer();
      if (!composer) return null;
      const conversationUsername = findOpenConversationUsername();
      if (conversationUsername) lastConversationUsername = conversationUsername;
      if (usernamesMatch(conversationUsername, expectedUsername)) {
        return { composer, conversationUsername };
      }
      return null;
    }, 9000);

    if (destination?.pageError) {
      return {
        ok: false,
        reopenProfile: true,
        error: "Normal TikTok mesaj ekranı konuşmayı açamadı; profil üzerinden yeniden deneniyor."
      };
    }

    const composer = destination?.composer;
    if (!composer) {
      if (expectedUsername && lastConversationUsername) {
        return {
          ok: false,
          retryable: true,
          reopenProfile: true,
          error:
            `Business Suite yanlış sohbeti açtı: beklenen @${expectedUsername}, ` +
            `açılan @${lastConversationUsername}.`
        };
      }
      return {
        ok: false,
        retryable: !isNormalMessagePage(),
        reopenProfile: isNormalMessagePage(),
        error: isNormalMessagePage()
          ? "Normal TikTok mesaj ekranında hedef konuşma veya yazı alanı açılmadı."
          : "Mesajlaşma ekranındaki yazı alanı henüz bulunamadı."
      };
    }

    const maxLength = Number(composer.getAttribute("maxlength") || 0);
    if (maxLength > 0 && message.length > maxLength) {
      return {
        ok: false,
        error: `TikTok DM alanı ${maxLength} karakterle sınırlı; hazır mesaj ${message.length} karakter.`
      };
    }

    if (conversationContainsAnyMessage(message, knownMessages, composer)) {
      return { ok: true, alreadySent: true };
    }

    const insertion = await setComposerText(composer, message);
    const insertionMethod = insertion.method;
    if (!insertionMethod) {
      return {
        ok: false,
        retryable: true,
        error:
          "TikTok Draft.js mesaj alanı metni güvenli biçimde kabul etmedi; " +
          "DOM'u zorlamadan işlem yeniden denenecek. " +
          `Denemeler: ${insertion.detail || "bilinmiyor"}`
      };
    }
    if (findMessagePageError()) {
      return {
        ok: false,
        retryable: true,
        reopenProfile: true,
        error:
          "Mesaj yazıldıktan hemen sonra Business Suite hata ekranına geçti; Gönder tetiklenmedi. " +
          `Metin girişi: ${insertionMethod}; ${insertion.detail || ""}`
      };
    }
    const currentConversationUsername = findOpenConversationUsername();
    if (!usernamesMatch(currentConversationUsername, expectedUsername)) {
      return {
        ok: false,
        retryable: true,
        reopenProfile: true,
        error:
          `Gönderim öncesi hedef sohbet kayboldu: beklenen @${expectedUsername}, ` +
          `açılan @${currentConversationUsername || "bilinmiyor"}.`
      };
    }

    const sendReady = await waitFor(() => {
      if (findMessagePageError()) return { pageError: true };
      const control = findDmSendButton(composer);
      return control ? { control } : null;
    }, 3500);

    if (sendReady?.pageError) {
      return {
        ok: false,
        retryable: true,
        reopenProfile: true,
        error:
          "Metin hazırlandı ancak Gönder kontrolü beklenirken Business Suite hata ekranına geçti. " +
          `Metin girişi: ${insertionMethod}; ${insertion.detail || ""}`
      };
    }

    const sendButton = sendReady?.control;
    let sendMethod = "bulunamadı";
    if (sendButton) {
      sendMethod = describeSendButton(sendButton);
      activateDmSendControl(sendButton);
    } else {
      const form = composer.closest("form");
      if (form && typeof form.requestSubmit === "function") {
        sendMethod = "form-submit";
        form.requestSubmit();
      } else {
        return {
          ok: false,
          retryable: true,
          error:
            "Mesaj metni hazır ancak görünür Gönder kontrolü 3,5 saniye içinde oluşmadı; " +
            "Enter gönderimi yapılmadan işlem yeniden denenecek."
        };
      }
    }

    const sendOutcome = await waitFor(() => {
      if (findMessagePageError()) {
        return { pageError: true };
      }
      if (conversationContainsMessage(message, composer)) {
        return { verifiedInConversation: true };
      }
      if (readComposerText(composer).trim() === "") {
        return { composerCleared: true };
      }
      return null;
    }, 12000);

    if (sendOutcome?.pageError) {
      return {
        ok: false,
        error:
          "TikTok, Gönder kontrolü tetiklendikten sonra hata ekranına geçti. " +
          `Yöntem: ${sendMethod}; metin girişi: ${insertionMethod}; sayfa: ${location.pathname}`
      };
    }

    if (!sendOutcome) {
      const remainingLength = readComposerText(composer).trim().length;
      const actionControls = describeDmActionControls(composer);
      return {
        ok: false,
        error:
          "Gönderimden sonra mesaj alanı boşalmadı ve gerçek gönderilmiş balon bulunamadı; " +
          `çift gönderimi önlemek için işlem durduruldu. Yöntem: ${sendMethod}; ` +
          `metin girişi: ${insertionMethod}; ` +
          `alan: ${remainingLength} karakter; sayfa: ${location.pathname}; ` +
          `mesaj alanı kontrolleri: ${actionControls}`
      };
    }
    return {
      ok: true,
      verifiedInConversation: Boolean(sendOutcome.verifiedInConversation)
    };
  }

  // Mesaj uygulaması (Business Suite içindeki /messages çerçevesi veya normal
  // Mesajlar sayfası) yüklendiği hâlde sağdaki sohbet açılmadıysa sayfayı
  // yenilemek yerine uygulamanın kendi yönlendirmesi kullanılır: adres geçmişine
  // hedef kullanıcı kimliği (u) yazılır ve popstate tetiklenir. TikTok'un
  // mesaj uygulaması bu değişikliği okuyup hedef sohbeti yaklaşık bir saniyede
  // açar; tam yenileme (20-30 sn) yalnız bu yol da sonuç vermezse kullanılır.
  async function recoverDmTarget(rawUserId, rawUsername) {
    const userId = String(rawUserId || "").trim();
    const expectedUsername = String(rawUsername || "").replace(/^@/, "");
    if (!/^\d{3,32}$/.test(userId)) {
      return { ok: false, applicable: false, error: "Hedef kullanıcı kimliği okunamadı." };
    }
    if (!findDmConversationList()) {
      // Bu çerçeve mesaj uygulamasını barındırmıyor.
      return { ok: false, applicable: false };
    }
    if (findMessagePageError()) {
      return { ok: false, applicable: true, pageError: true, error: "Mesaj ekranı hata gösteriyor." };
    }
    if (findDmComposer() && usernamesMatch(findOpenConversationUsername(), expectedUsername)) {
      return { ok: true, applicable: true, alreadyOpen: true };
    }

    try {
      const url = new URL(location.href);
      url.searchParams.set("u", userId);
      history.pushState(null, "", url.pathname + url.search);
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    } catch (error) {
      return {
        ok: false,
        applicable: true,
        error: "Hedef sohbet için adres güncellenemedi: " + (error?.message || String(error))
      };
    }

    const opened = await waitFor(() => {
      if (findMessagePageError()) return { pageError: true };
      const composer = findDmComposer();
      if (composer && usernamesMatch(findOpenConversationUsername(), expectedUsername)) {
        return { composer: true };
      }
      return null;
    }, 5000);

    return {
      ok: Boolean(opened?.composer),
      applicable: true,
      pageError: Boolean(opened?.pageError),
      conversationUsername: findOpenConversationUsername(),
      listItems: countDmConversations(),
      error: opened?.pageError
        ? "Yerinde açma sonrası mesaj ekranı hata gösterdi."
        : opened?.composer
          ? ""
          : "Hedef sohbet 5 saniye içinde açılmadı."
    };
  }

  function findDmConversationList() {
    return document.querySelector(
      '[data-e2e="dm-new-conversation-list"], [data-e2e="dm-new-conversation-header"], [data-e2e="dm-new-chatbox"]'
    );
  }

  function countDmConversations() {
    return document.querySelectorAll('[data-e2e="dm-new-conversation-item"]').length;
  }

  function describeDmRoute() {
    const inFrame = window.top !== window;
    if (location.pathname.startsWith("/business-suite/messages")) return "business-suite kabuğu";
    if (isNormalMessagePage()) return inFrame ? "business-suite içindeki /messages çerçevesi" : "normal /messages";
    return `${location.pathname}${inFrame ? " (çerçeve)" : ""}`;
  }

  async function prepareProfileDmInput(rawMessage, rawUsername, shouldFocus, knownMessages = []) {
    const message = String(rawMessage || "").trim();
    const expectedUsername = String(rawUsername || "").replace(/^@/, "");
    if (!message) return { ok: false, error: "DM metni boş." };

    let lastConversationUsername = "";
    const destination = await waitFor(() => {
      if (findMessagePageError()) return { pageError: true };
      const composer = findDmComposer();
      if (!composer) return null;
      const conversationUsername = findOpenConversationUsername();
      if (conversationUsername) lastConversationUsername = conversationUsername;
      if (usernamesMatch(conversationUsername, expectedUsername)) {
        return { composer, conversationUsername };
      }
      return null;
    }, 5000);

    if (destination?.pageError) {
      return {
        ok: false,
        retryable: true,
        reopenProfile: true,
        error: "Business Suite, Chrome girdisi hazırlanmadan önce hata ekranına geçti."
      };
    }

    const composer = destination?.composer;
    if (!composer) {
      return {
        ok: false,
        retryable: true,
        reopenProfile: true,
        error: lastConversationUsername
          ? `Chrome girdisi için yanlış sohbet açık: beklenen @${expectedUsername}, açılan @${lastConversationUsername}.`
          : "Chrome girdisi için hedef sohbet veya mesaj kutusu bulunamadı."
      };
    }

    const maxLength = Number(composer.getAttribute("maxlength") || 0);
    if (maxLength > 0 && message.length > maxLength) {
      return {
        ok: false,
        error: `TikTok DM alanı ${maxLength} karakterle sınırlı; hazır mesaj ${message.length} karakter.`
      };
    }

    if (conversationContainsAnyMessage(message, knownMessages, composer)) {
      return { ok: true, alreadySent: true };
    }

    const currentText = readComposerText(composer);
    const textReady = composerTextMatches(currentText, message);
    if (compactText(currentText) && !textReady) {
      return {
        ok: false,
        retryable: false,
        error:
          "Mesaj kutusunda hazır mesajdan farklı bir metin bulundu; kullanıcı metnini ezmemek için işlem durduruldu."
      };
    }

    if (shouldFocus) {
      try {
        composer.focus({ preventScroll: true });
      } catch {
        composer.focus();
      }
    }

    return {
      ok: true,
      ready: true,
      textReady,
      point: getTopViewportPoint(composer),
      conversationUsername: destination.conversationUsername
    };
  }

  function verifyProfileDmText(rawMessage, rawUsername) {
    const message = String(rawMessage || "").trim();
    const expectedUsername = String(rawUsername || "").replace(/^@/, "");
    if (findMessagePageError()) {
      return {
        ok: false,
        retryable: true,
        reopenProfile: true,
        pageError: true,
        error: "Chrome metin girdisinden sonra Business Suite hata ekranına geçti."
      };
    }

    const composer = findDmComposer();
    const conversationUsername = findOpenConversationUsername();
    if (!composer || !usernamesMatch(conversationUsername, expectedUsername)) {
      return {
        ok: false,
        retryable: true,
        reopenProfile: true,
        error:
          `Chrome girdisi sonrası hedef sohbet doğrulanamadı: beklenen @${expectedUsername}, ` +
          `açılan @${conversationUsername || "bilinmiyor"}.`
      };
    }

    return {
      ok: true,
      textReady: composerTextMatches(readComposerText(composer), message),
      currentLength: readComposerText(composer).trim().length
    };
  }

  async function verifyProfileDmSent(rawMessage, rawUsername) {
    const message = String(rawMessage || "").trim();
    const expectedUsername = String(rawUsername || "").replace(/^@/, "");
    const composer = findDmComposer();
    if (!composer) {
      return {
        ok: false,
        retryable: true,
        error: "Enter gönderiminden sonra mesaj kutusu bulunamadı."
      };
    }

    const sendOutcome = await waitFor(() => {
      if (findMessagePageError()) return { pageError: true };
      const conversationUsername = findOpenConversationUsername();
      if (!usernamesMatch(conversationUsername, expectedUsername)) {
        return { wrongConversation: conversationUsername || "bilinmiyor" };
      }
      if (conversationContainsMessage(message, composer)) {
        return { verifiedInConversation: true };
      }
      if (readComposerText(composer).trim() === "") {
        return { composerCleared: true };
      }
      return null;
    }, 12000);

    if (sendOutcome?.verifiedInConversation || sendOutcome?.composerCleared) {
      return {
        ok: true,
        verifiedInConversation: Boolean(sendOutcome.verifiedInConversation),
        trustedInput: true
      };
    }
    if (sendOutcome?.pageError) {
      return {
        ok: false,
        error: "Chrome Enter girdisinden sonra Business Suite hata ekranına geçti."
      };
    }
    if (sendOutcome?.wrongConversation) {
      return {
        ok: false,
        error:
          `Chrome Enter girdisinden sonra hedef sohbet değişti: ` +
          `beklenen @${expectedUsername}, açılan @${sendOutcome.wrongConversation}.`
      };
    }
    return {
      ok: false,
      error:
        "Chrome Enter girdisinden sonra mesaj kutusu boşalmadı ve gerçek gönderilmiş mesaj bulunamadı."
    };
  }

  function getTopViewportPoint(element) {
    const rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    let currentWindow = window;

    try {
      while (currentWindow !== currentWindow.top) {
        const frameElement = currentWindow.frameElement;
        if (!frameElement) return null;
        const frameRect = frameElement.getBoundingClientRect();
        x += frameRect.left;
        y += frameRect.top;
        currentWindow = currentWindow.parent;
      }
    } catch {
      return null;
    }

    return {
      x: Math.round(x),
      y: Math.round(y)
    };
  }

  function findOpenConversationUsername() {
    const candidates = [
      ...document.querySelectorAll('[data-e2e="chat-uniqueid"]'),
      ...document.querySelectorAll(
        '[data-e2e="dm-new-chatbox"] a[href*="tiktok.com/@"]'
      )
    ].filter(isVisible);

    for (const element of candidates) {
      const textMatch = compactText(element.innerText || element.textContent || "")
        .match(/@([A-Za-z0-9._]+)/);
      if (textMatch) return textMatch[1];

      const href = element.getAttribute("href") || "";
      const hrefMatch = href.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
      if (hrefMatch) return decodeURIComponent(hrefMatch[1]);
    }
    return "";
  }

  function usernamesMatch(actual, expected) {
    const left = String(actual || "").replace(/^@/, "").toLocaleLowerCase("tr");
    const right = String(expected || "").replace(/^@/, "").toLocaleLowerCase("tr");
    return Boolean(left && right && left === right);
  }

  // Gönderim öncesi kontrol: hazır mesajların herhangi biri (bu seferki veya
  // önceki bir oturumda seçilen alternatif) sohbette varsa yeniden gönderilmez.
  function conversationContainsAnyMessage(message, knownMessages, composer) {
    const candidates = [message, ...(Array.isArray(knownMessages) ? knownMessages : [])];
    return candidates.some((candidate) => typeof candidate === "string" && conversationContainsMessage(candidate, composer));
  }

  function conversationContainsMessage(message, composer) {
    const target = normalizeMessageText(message);
    if (!target) return false;
    const composerRect = composer.getBoundingClientRect();

    return [...document.querySelectorAll("div, p, span")].some((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (!isVisible(element)) return false;
      if (element === composer || element.contains(composer) || composer.contains(element)) return false;
      if (element.closest("textarea, input, [contenteditable='true'], [role='textbox']")) return false;
      if (element.getAttribute("aria-live") || element.closest("[aria-hidden='true'], form")) return false;
      if (normalizeMessageText(element.innerText || element.textContent || "") !== target) return false;

      const rect = element.getBoundingClientRect();
      if (rect.bottom > composerRect.top - 4) return false;
      return Boolean(findRealOutgoingMessageBubble(element, composer, composerRect));
    });
  }

  function findRealOutgoingMessageBubble(textElement, composer, composerRect) {
    let current = textElement;
    for (let level = 0; level < 8 && current instanceof HTMLElement; level += 1) {
      if (current === composer || current.contains(composer) || composer.contains(current)) return null;
      if (!isVisible(current)) return null;

      const marker = [
        current.getAttribute("class"),
        current.getAttribute("data-e2e"),
        current.getAttribute("data-testid"),
        current.getAttribute("role")
      ].join(" ").toLocaleLowerCase("tr");

      if (
        marker.includes("composer") ||
        marker.includes("editor") ||
        marker.includes("input") ||
        marker.includes("mirror") ||
        marker.includes("measure") ||
        marker.includes("placeholder") ||
        marker.includes("draft")
      ) {
        return null;
      }

      const rect = current.getBoundingClientRect();
      const style = getComputedStyle(current);
      const background = style.backgroundColor.replace(/\s+/g, "").toLocaleLowerCase("tr");
      const radius = parseFloat(style.borderRadius || "0");
      const hasBubbleMarker =
        /chat.*(message|item)|message.*(bubble|item|text)|bubble/.test(marker);
      const hasBubbleAppearance =
        radius >= 4 &&
        background !== "transparent" &&
        background !== "rgba(0,0,0,0)";
      const isOutgoingSide =
        rect.right >= composerRect.left + composerRect.width * 0.68;
      const isBubbleSized =
        rect.width >= 24 &&
        rect.width <= composerRect.width * 0.88 &&
        rect.height >= 16 &&
        rect.bottom <= composerRect.top - 4;

      if (isOutgoingSide && isBubbleSized && (hasBubbleMarker || hasBubbleAppearance)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function normalizeMessageText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function findMessagePageError() {
    const errorPhrases = [
      "bir şeyler ters gitti",
      "daha sonra tekrar deneyin",
      "something went wrong",
      "please try again later"
    ];
    return [...document.querySelectorAll("h1, h2, h3, p, span, div")]
      .filter((element) => isVisible(element) && element.children.length === 0)
      .some((element) => {
        const text = compactText(element.textContent || "").toLocaleLowerCase("tr");
        return errorPhrases.some((phrase) => text.includes(phrase));
      });
  }

  function isNormalMessagePage() {
    return location.pathname === "/messages" || location.pathname.startsWith("/messages/");
  }

  function findProfileMessageButton() {
    const selectors = [
      'button[data-e2e="message-button"]',
      'button[data-e2e*="message"]',
      '[role="button"][data-e2e*="message"]',
      '[data-testid*="message"]',
      'a[href*="/messages"]',
      "button",
      'a[role="button"]',
      '[role="button"]'
    ];

    const candidates = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))]
      .filter(isVisible)
      .filter((element) => {
        const text = compactText(element.innerText || element.textContent || "").toLocaleLowerCase("tr");
        const aria = (element.getAttribute("aria-label") || "").toLocaleLowerCase("tr");
        const title = (element.getAttribute("title") || "").toLocaleLowerCase("tr");
        const attributes = [
          element.getAttribute("data-e2e"),
          element.getAttribute("data-testid")
        ].join(" ").toLocaleLowerCase("tr");
        return (
          attributes.includes("message") ||
          isMessageActionLabel(text) ||
          isMessageActionLabel(aria) ||
          isMessageActionLabel(title)
        );
      })
      .map((element) => ({
        element,
        score: scoreProfileMessageButton(element)
      }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.element || null;
  }

  function isMessageActionLabel(value) {
    const label = compactText(value).toLocaleLowerCase("tr");
    return [
      "mesaj",
      "message",
      "mesaj gönder",
      "send message",
      "mesaj gönderin"
    ].includes(label);
  }

  function findProfilePageError() {
    const errorPhrases = [
      "bir şeyler ters gitti",
      "daha sonra tekrar deneyin",
      "sayfa şu anda kullanılamıyor",
      "sayfa yüklenemedi",
      "something went wrong",
      "please try again later",
      "page isn't available",
      "couldn't load"
    ];
    return [...document.querySelectorAll("h1, h2, h3, p, span, div")]
      .filter((element) => isVisible(element) && element.children.length === 0)
      .some((element) => {
        const text = compactText(element.textContent || "").toLocaleLowerCase("tr");
        return errorPhrases.some((phrase) => text.includes(phrase));
      });
  }

  function isProfileHeaderReady(username) {
    const expected = String(username || "").replace(/^@/, "").toLocaleLowerCase("tr");
    const selectors = [
      '[data-e2e="user-title"]',
      '[data-e2e="user-subtitle"]',
      '[data-testid*="user-title"]',
      '[data-testid*="user-subtitle"]',
      "main h1",
      "main h2"
    ];
    return [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))]
      .filter(isVisible)
      .some((element) => {
        const text = compactText(element.innerText || element.textContent || "")
          .replace(/^@/, "")
          .toLocaleLowerCase("tr");
        return text === expected || text.includes(`@${expected}`);
      });
  }

  function scoreProfileMessageButton(element) {
    const rect = element.getBoundingClientRect();
    const text = compactText(element.innerText || element.textContent || "").toLocaleLowerCase("tr");
    const attributes = [
      element.getAttribute("data-e2e"),
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label")
    ].join(" ").toLocaleLowerCase("tr");

    let score = 0;
    if (element.tagName === "BUTTON") score += 30;
    if (text === "mesaj" || text === "message") score += 25;
    if (attributes.includes("message-button")) score += 50;
    else if (attributes.includes("message")) score += 20;
    if (rect.top < window.innerHeight * 0.5) score += 10;
    if (rect.left > window.innerWidth * 0.15 && rect.left < window.innerWidth * 0.8) score += 5;
    return score;
  }

  function findDmComposer() {
    const selectors = [
      '[data-e2e="dm-new-input-editor"] [contenteditable="true"][role="textbox"]',
      '[data-e2e="message-input-area"] [contenteditable="true"][role="textbox"]',
      '[data-e2e="dm-new-chat-bottom"] [contenteditable="true"][role="textbox"]',
      '[data-e2e*="message-input"]',
      '[data-e2e*="chat-input"]',
      '[role="textbox"]',
      '[contenteditable="true"]',
      "textarea",
      "input[placeholder]",
      "input:not([type])",
      'input[type="text"]',
      "[data-placeholder]"
    ];
    const candidates = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))]
      .filter(isVisible)
      .filter((element) => {
        const placeholder = (element.getAttribute("placeholder") || "").toLocaleLowerCase("tr");
        const aria = (element.getAttribute("aria-label") || "").toLocaleLowerCase("tr");
        const dataE2e = (element.getAttribute("data-e2e") || "").toLocaleLowerCase("tr");
        const dataPlaceholder = (element.getAttribute("data-placeholder") || "").toLocaleLowerCase("tr");
        const role = (element.getAttribute("role") || "").toLocaleLowerCase("tr");
        const rect = element.getBoundingClientRect();
        const isSearch = placeholder === "ara" || placeholder === "search" || aria === "ara" || aria === "search";
        return !isSearch && (
          dataE2e.includes("message") ||
          dataE2e.includes("chat") ||
          placeholder.includes("mesaj") ||
          placeholder.includes("message") ||
          dataPlaceholder.includes("mesaj") ||
          dataPlaceholder.includes("message") ||
          aria.includes("mesaj") ||
          aria.includes("message") ||
          (role === "textbox" && rect.top > window.innerHeight * 0.45) ||
          (element.getAttribute("contenteditable") === "true" && rect.top > window.innerHeight * 0.45)
        );
      });

    // TikTok'un Draft.js girdisinde gerçek yazılabilir öğeyi bir kapsayıcı
    // sarar; o kapsayıcının data-e2e'si de "message" içerdiği için aday
    // listesine girer. Bir aday kendi içindeki başka bir adayı sarıyorsa
    // (yani onun atası ise) elenir; metin her zaman en içteki, gerçekten
    // yazılabilir öğeden okunmalı — aksi hâlde kapsayıcının içindeki yer
    // tutucu/ipucu metni (TikTok çevirisi bozulduğunda "im_hint_send_msg"
    // gibi ham anahtar olarak görünebiliyor) kullanıcı yazmış sanılabilir.
    const leafCandidates = candidates.filter(
      (element) => !candidates.some((other) => other !== element && element.contains(other))
    );

    leafCandidates.sort((a, b) => scoreComposer(b) - scoreComposer(a));
    return leafCandidates[0] || null;
  }

  function scoreComposer(element) {
    const rect = element.getBoundingClientRect();
    const attrs = [
      element.getAttribute("placeholder"),
      element.getAttribute("data-placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("data-e2e")
    ].join(" ").toLocaleLowerCase("tr");
    const isRealInput =
      element.getAttribute("contenteditable") === "true" ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement;
    let score = rect.bottom / Math.max(window.innerHeight, 1);
    if (attrs.includes("mesaj") || attrs.includes("message")) score += 5;
    // Gerçekten yazılabilir bir öğe olmak, etiket metninden bağımsız olarak
    // sarmalayıcı kapsayıcılara üstün gelmeli; TikTok'un çevirisi bozulup
    // etiket "mesaj"/"message" içermediğinde bile gerçek yazı alanı seçilir.
    if (isRealInput) score += 8;
    if (element.getAttribute("role") === "textbox") score += 2;
    if (rect.left > window.innerWidth * 0.3) score += 1;
    return score;
  }

  function findDmSendButton(composer) {
    const composerRect = composer.getBoundingClientRect();
    const actionRoot = findDmActionRoot(composer);
    const localControls = collectDmActionControls(composer);
    const explicitLocal = localControls.filter((element) => {
      const marker = getSendControlMarker(element);
      return marker.includes("gönder") || marker.includes("send") || marker.includes("message-send");
    });
    if (explicitLocal.length) {
      explicitLocal.sort((a, b) => scoreSendButton(b, composerRect) - scoreSendButton(a, composerRect));
      return explicitLocal[0];
    }

    const form = composer.closest("form");
    const submitButtons = localControls.filter((element) => {
      return (
        element.getAttribute("type") === "submit" &&
        (!form || form.contains(element) || element.closest("form") === form)
      );
    });
    if (submitButtons.length) {
      submitButtons.sort((a, b) => scoreSendButton(b, composerRect) - scoreSendButton(a, composerRect));
      return submitButtons[0];
    }

    const contextual = localControls.filter((element) => {
      const rect = element.getBoundingClientRect();
      const centerY = (rect.top + rect.bottom) / 2;
      const composerCenterY = (composerRect.top + composerRect.bottom) / 2;
      const isSeparateAction =
        Boolean(actionRoot) &&
        actionRoot.contains(element) &&
        !element.closest('[data-e2e="message-input-area"]');
      return (
        (Boolean(element.querySelector("svg")) || element.tagName.toLocaleLowerCase("tr") === "svg" || isSeparateAction) &&
        rect.width >= 20 &&
        rect.width <= 120 &&
        rect.height >= 20 &&
        rect.height <= 120 &&
        Math.abs(centerY - composerCenterY) <= Math.max(35, composerRect.height) &&
        rect.left >= composerRect.right - 35 &&
        rect.left <= composerRect.right + 160
      );
    });
    contextual.sort((a, b) => scoreSendButton(b, composerRect) - scoreSendButton(a, composerRect));
    if (contextual.length) return contextual[0];

    const globalExplicit = [...document.querySelectorAll(
      [
        "button",
        "[role='button']",
        "[data-e2e*='send' i]",
        "[data-testid*='send' i]",
        "[class*='SendButton']",
        "[class*='send-button']"
      ].join(",")
    )]
      .filter((element) => isAvailableDmActionControl(element, composer))
      .filter((element) => {
        const marker = getSendControlMarker(element);
        return marker.includes("gönder") || marker.includes("send") || marker.includes("message-send");
      });
    globalExplicit.sort((a, b) => scoreSendButton(b, composerRect) - scoreSendButton(a, composerRect));
    return globalExplicit[0] || null;
  }

  function findDmActionRoot(composer) {
    return (
      composer.closest('[class*="DivMessageInputAndSendButton"]') ||
      composer.closest('[data-e2e="dm-new-chat-bottom"]') ||
      composer.closest("form") ||
      composer.parentElement
    );
  }

  function collectDmActionControls(composer) {
    const actionRoot = findDmActionRoot(composer);
    if (!actionRoot) return [];

    const selectors = [
      "button",
      "[role='button']",
      '[data-e2e="dm-new-send-btn"]',
      "[data-e2e*='send' i]",
      "[data-testid*='send' i]",
      "[class*='SendButton']",
      "[class*='send-button']"
    ];
    const directActions = [...actionRoot.children].filter((element) => {
      return (
        element instanceof HTMLElement &&
        !element.contains(composer) &&
        !element.hasAttribute("data-focus-guard")
      );
    });
    return [...new Set([
      ...actionRoot.querySelectorAll(selectors.join(",")),
      ...directActions
    ])].filter((element) => isAvailableDmActionControl(element, composer));
  }

  function isAvailableDmActionControl(element, composer) {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
    if (element === composer || element.contains(composer) || composer.contains(element)) return false;
    if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;

    const marker = getSendControlMarker(element);
    const isTikTokSendControl =
      marker.includes("dm-new-send-btn") ||
      marker.includes("message-send") ||
      marker.includes("gönder") ||
      marker.includes("send");
    if (!isVisible(element)) {
      const style = getComputedStyle(element);
      const isActuallyHidden =
        style.visibility === "hidden" ||
        style.display === "none" ||
        Number(style.opacity || 1) <= 0.05 ||
        element.getAttribute("aria-hidden") === "true";
      if (!isTikTokSendControl || isActuallyHidden) return false;
    }
    if (
      marker.includes("dm-new-emoji-btn") ||
      marker.includes("emoji") ||
      marker.includes("emoticon") ||
      marker.includes("smile") ||
      marker.includes("ifade")
    ) {
      return false;
    }
    return true;
  }

  function getSendControlMarker(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-e2e"),
      element.getAttribute("data-testid"),
      element.getAttribute("class"),
      compactText(element.innerText || element.textContent || "")
    ].join(" ").toLocaleLowerCase("tr");
  }

  function scoreSendButton(element, composerRect) {
    const rect = element.getBoundingClientRect();
    const marker = getSendControlMarker(element);
    let score = 0;
    if (marker.includes("message-send")) score += 100;
    if (marker.includes("gönder") || marker.includes("send")) score += 70;
    if (element.getAttribute("type") === "submit") score += 50;
    score -= Math.abs((rect.top + rect.bottom) / 2 - (composerRect.top + composerRect.bottom) / 2);
    score -= Math.abs(rect.left - composerRect.right) * 0.25;
    return score;
  }

  function describeSendButton(element) {
    const marker = getSendControlMarker(element);
    if (marker.includes("gönder") || marker.includes("send")) return "etiketli-gönder-düğmesi";
    if (element.getAttribute("type") === "submit") return "form-gönder-düğmesi";
    return "sağ-gönder-ikonu";
  }

  function activateDmSendControl(element) {
    if (typeof element.click === "function") {
      element.click();
      return;
    }
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );
  }

  function describeDmActionControls(composer) {
    const actionRoot = findDmActionRoot(composer);
    if (!actionRoot) return "kök bulunamadı";

    const elements = [...new Set([
      ...actionRoot.children,
      ...actionRoot.querySelectorAll("button, [role='button'], [data-e2e], [data-testid], [class*='SendButton']")
    ])]
      .filter((element) => element !== composer && !element.contains(composer))
      .slice(0, 10);
    if (!elements.length) return "yok";

    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const dataE2e = element.getAttribute("data-e2e") || "-";
      const role = element.getAttribute("role") || "-";
      const aria = compactText(element.getAttribute("aria-label") || "-").slice(0, 45);
      const className = typeof element.className === "string"
        ? compactText(element.className).slice(0, 70)
        : "-";
      return `${tag}[e2e=${dataE2e};role=${role};aria=${aria};class=${className};` +
        `${Math.round(rect.width)}x${Math.round(rect.height)}]`;
    }).join(" | ");
  }

  async function setComposerText(element, value) {
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }

    const initialText = readComposerText(element);
    if (composerTextMatches(initialText, value)) {
      return {
        method: "mevcut-editor-metni",
        detail: "Metin önceki güvenli denemeden editörde hazırdı."
      };
    }
    if (compactText(initialText)) {
      return {
        method: "",
        detail: `Editör başlangıçta boş değildi (${initialText.trim().length} karakter).`
      };
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value
        })
      );
      element.dispatchEvent(new Event("change", { bubbles: true }));
      const accepted = await waitFor(
        () => composerTextMatches(readComposerText(element), value),
        1000
      );
      return accepted
        ? { method: "native-input", detail: "Standart giriş alanı metni kabul etti." }
        : {
            method: "",
            detail: `Standart giriş alanı metni kabul etmedi (${readComposerText(element).trim().length} karakter).`
          };
    }

    const attempts = [];
    const selectEditorContents = () => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      return selection;
    };

    try {
      const selection = selectEditorContents();
      const inserted = document.execCommand("insertText", false, value);
      attempts.push(`insertText=${inserted ? "kabul" : "ret"}`);
      selection.removeAllRanges();
    } catch (error) {
      attempts.push(`insertText=hata(${String(error?.message || error).slice(0, 80)})`);
    }

    let accepted = await waitFor(
      () => composerTextMatches(readComposerText(element), value),
      1800
    );
    if (accepted) {
      return {
        method: "execCommand-insertText",
        detail: attempts.join(", ")
      };
    }

    // Draft.js çok satırlı metni doğrudan insertText ile her zaman kabul etmiyor.
    // Editör hâlâ boşsa React'in kendi yapıştırma işleyicisine düz metin sunulur.
    if (!compactText(readComposerText(element))) {
      try {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", value);
        const pasteEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData
        });
        element.dispatchEvent(pasteEvent);
        attempts.push("paste=iletildi");
      } catch (error) {
        attempts.push(`paste=hata(${String(error?.message || error).slice(0, 80)})`);
      }

      accepted = await waitFor(
        () => composerTextMatches(readComposerText(element), value),
        2200
      );
      if (accepted) {
        return {
          method: "draft-paste",
          detail: attempts.join(", ")
        };
      }
    } else {
      attempts.push(`paste=atlanmış(editör ${readComposerText(element).trim().length} karakter)`);
    }

    const currentLength = readComposerText(element).trim().length;
    attempts.push(`son=${currentLength} karakter`);
    attempts.push(`odak=${document.activeElement === element ? "evet" : "hayır"}`);
    attempts.push(`sayfa-odağı=${document.hasFocus() ? "evet" : "hayır"}`);
    return {
      method: "",
      detail: attempts.join(", ")
    };
  }

  function composerTextMatches(actual, expected) {
    return compactText(actual) === compactText(expected);
  }

  function readComposerText(element) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element.value || "";
    }
    return element.innerText || element.textContent || "";
  }

  function clickNextLiveButton() {
    const switchRoots = [...document.querySelectorAll("[data-live-inner-switch-btn]")];
    for (const root of switchRoots) {
      const enabledControls = [...root.children].filter((element) => {
        return (
          element instanceof HTMLElement &&
          element.classList.contains("pointer-events-auto") &&
          !element.classList.contains("pointer-events-none")
        );
      });

      if (enabledControls.length) {
        const downwardControl =
          enabledControls.find((element) => {
            const path = element.querySelector("svg path");
            const pathData = (path?.getAttribute("d") || "").toLocaleLowerCase("tr");
            return pathData.includes("m24 28.75");
          }) || enabledControls[enabledControls.length - 1];

        downwardControl.click();
        return true;
      }
    }

    const labelled = [...document.querySelectorAll("button, [role='button']")].filter((element) => {
      if (!isVisible(element)) return false;
      const attrs = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-e2e")
      ].join(" ").toLocaleLowerCase("tr");
      return (
        attrs.includes("sonraki") ||
        attrs.includes("next live") ||
        attrs.includes("next-live") ||
        attrs.includes("aşağı") ||
        attrs.includes("down")
      );
    });
    if (labelled.length === 1) {
      labelled[0].click();
      return true;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const controls = [...document.querySelectorAll("button, [role='button']")]
      .filter(isVisible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => {
        const centerX = (rect.left + rect.right) / 2;
        const centerY = (rect.top + rect.bottom) / 2;
        const text = compactText(element.innerText || element.textContent || "");
        return (
          centerX > viewportWidth * 0.62 &&
          centerX < viewportWidth * 0.84 &&
          centerY > viewportHeight * 0.28 &&
          centerY < viewportHeight * 0.72 &&
          rect.width >= 24 &&
          rect.width <= 100 &&
          rect.height >= 24 &&
          rect.height <= 100 &&
          text.length <= 2 &&
          Boolean(element.querySelector("svg"))
        );
      });

    const lowerCandidates = [];
    for (const first of controls) {
      for (const second of controls) {
        if (first === second) continue;
        const firstX = (first.rect.left + first.rect.right) / 2;
        const secondX = (second.rect.left + second.rect.right) / 2;
        const firstY = (first.rect.top + first.rect.bottom) / 2;
        const secondY = (second.rect.top + second.rect.bottom) / 2;
        if (Math.abs(firstX - secondX) < 35 && secondY - firstY > 20 && secondY - firstY < 110) {
          lowerCandidates.push(second);
        }
      }
    }

    const unique = [...new Set(lowerCandidates.map((item) => item.element))];
    if (unique.length === 1) {
      unique[0].click();
      return true;
    }
    return false;
  }

  async function goToNextLiveWithRetry(previous) {
    const firstClicked = clickNextLiveButton();
    if (firstClicked) {
      const firstChange = await waitForUsernameChange(previous, 3000);
      if (firstChange) return { ok: true, username: firstChange };
      if (isLiveTransitionStuck(previous)) {
        // Adres yeni yayına geçti ama ekran eski yayında kaldı. Bu durumda ok
        // düğmesine yeniden basmak işe yaramıyor; kısa süre daha beklenir,
        // değişmezse çağıran taraf sekmeyi yeniletir.
        const lateChange = await waitForUsernameChange(previous, 5000);
        if (lateChange) return { ok: true, username: lateChange };
        if (!controller.running) return { ok: false, stopped: true };
        if (isLiveTransitionStuck(previous)) return { ok: false, stuck: true, urlUsername: getLiveUrlUsername() };
      }
    } else {
      await runtimePatch({
        status: "Aşağı düğmesi hazır değil; 3 saniye sonra tekrar denenecek"
      });
      await interruptibleDelay(3000);
    }

    if (!controller.running) return { ok: false, stopped: true };

    if (firstClicked) {
      await runtimePatch({
        status: "Yayın değişmedi; aşağı düğmesi tekrar deneniyor"
      });
    }

    const retryClicked = clickNextLiveButton();
    if (!retryClicked) {
      return { ok: false, buttonMissing: true };
    }

    const retryChange = await waitForUsernameChange(previous, 15000);
    return retryChange
      ? { ok: true, username: retryChange }
      : { ok: false, buttonMissing: false, stuck: isLiveTransitionStuck(previous), urlUsername: getLiveUrlUsername() };
  }

  function getLiveUrlUsername() {
    const match = location.pathname.match(/^\/@([A-Za-z0-9._]+)\/live\/?$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function isLiveTransitionStuck(previous) {
    const urlUsername = getLiveUrlUsername();
    return Boolean(urlUsername) && !usernamesMatch(urlUsername, previous) &&
      usernamesMatch(getLiveHeaderUsername(), previous);
  }

  async function goToNextForYouWithRetry(previous) {
    const firstMoved = clickNextForYouButton();
    if (firstMoved) {
      const firstChange = await waitForUsernameChange(previous, 5000);
      if (firstChange) return { ok: true, username: firstChange };
    } else {
      await runtimePatch({
        status: "Sizin İçin aşağı geçişi hazır değil; 3 saniye sonra tekrar denenecek"
      });
      await interruptibleDelay(3000);
    }

    if (!controller.running) return { ok: false, stopped: true };

    if (firstMoved) {
      await runtimePatch({
        status: "Video sahibi değişmedi; aşağı geçiş tekrar deneniyor"
      });
    }

    const retryMoved = clickNextForYouButton();
    if (!retryMoved) return { ok: false, buttonMissing: true };

    const retryChange = await waitForUsernameChange(previous, 15000);
    return retryChange
      ? { ok: true, username: retryChange }
      : { ok: false, buttonMissing: false };
  }

  function goToNextItemWithRetry(previous) {
    return isForYouMode()
      ? goToNextForYouWithRetry(previous)
      : goToNextLiveWithRetry(previous);
  }

  function clickNextForYouButton() {
    const labelled = [...document.querySelectorAll("button, [role='button']")].filter((element) => {
      if (!isVisible(element)) return false;
      const attrs = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-e2e")
      ].join(" ").toLocaleLowerCase("tr");
      return (
        attrs.includes("sonraki video") ||
        attrs.includes("next video") ||
        attrs.includes("aşağı") ||
        attrs.includes("scroll down")
      );
    });
    if (labelled.length === 1) {
      labelled[0].click();
      return true;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rightControls = [...document.querySelectorAll("button, [role='button']")]
      .filter(isVisible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => {
        const centerX = (rect.left + rect.right) / 2;
        const centerY = (rect.top + rect.bottom) / 2;
        const text = compactText(element.innerText || element.textContent || "");
        return (
          centerX > viewportWidth * 0.85 &&
          centerY > viewportHeight * 0.3 &&
          centerY < viewportHeight * 0.78 &&
          rect.width >= 28 &&
          rect.width <= 90 &&
          rect.height >= 28 &&
          rect.height <= 90 &&
          text.length <= 2 &&
          Boolean(element.querySelector("svg"))
        );
      });

    const lowerControls = [];
    for (const first of rightControls) {
      for (const second of rightControls) {
        if (first === second) continue;
        const firstX = (first.rect.left + first.rect.right) / 2;
        const secondX = (second.rect.left + second.rect.right) / 2;
        const firstY = (first.rect.top + first.rect.bottom) / 2;
        const secondY = (second.rect.top + second.rect.bottom) / 2;
        if (Math.abs(firstX - secondX) < 35 && secondY - firstY > 24 && secondY - firstY < 110) {
          lowerControls.push(second.element);
        }
      }
    }
    const uniqueLowerControls = [...new Set(lowerControls)];
    if (uniqueLowerControls.length === 1) {
      uniqueLowerControls[0].click();
      return true;
    }

    const currentArticle = findVisibleForYouArticle();
    const articles = [...document.querySelectorAll('[data-e2e="recommend-list-item-container"]')];
    const currentIndex = articles.indexOf(currentArticle);
    const nextArticle = currentIndex >= 0 ? articles[currentIndex + 1] : null;
    if (nextArticle && typeof nextArticle.scrollIntoView === "function") {
      nextArticle.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }

    if (typeof window.scrollBy === "function") {
      window.scrollBy({
        top: Math.max(600, Math.round(window.innerHeight * 0.8)),
        behavior: "smooth"
      });
      return true;
    }
    return false;
  }

  function getLiveUsername() {
    // TikTok aşağı okla yayın değiştirirken adres çubuğunu her zaman güncellemiyor.
    // İşlenecek hesabı ekranda görünen yayın başlığından al.
    const visibleUsername = getLiveHeaderUsername();
    if (visibleUsername) return visibleUsername;
    const match = location.pathname.match(/^\/@([A-Za-z0-9._]+)\/live\/?$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function getLiveHeaderUsername() {
    const header = document.querySelector('[data-e2e="live-header-container"]');
    if (!header) return "";
    for (const mark of ['[data-e2e="room-header-anchor-name"]', '[data-e2e="room-header-anchor-avatar"]']) {
      const element = header.querySelector(mark);
      const link = element?.closest("a[href*='/@']");
      if (!link || !isVisible(link)) continue;
      const username = getUsernameFromProfileLink(link);
      if (username) return username;
    }
    return "";
  }

  function getForYouUsername() {
    const article = findVisibleForYouArticle();
    if (!article) return "";

    const preferred =
      article.querySelector('a[data-e2e="video-author-avatar"][href*="/@"]') ||
      article.querySelector('a[href*="/@"]');
    return getUsernameFromProfileLink(preferred);
  }

  function findVisibleForYouArticle() {
    const selector = '[data-e2e="recommend-list-item-container"]';
    const centerElement =
      typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(
            Math.round(window.innerWidth / 2),
            Math.round(window.innerHeight / 2)
          )
        : null;
    const centeredArticle = centerElement?.closest?.(selector);
    if (centeredArticle) return centeredArticle;

    const viewportHeight = window.innerHeight;
    return [...document.querySelectorAll(selector)]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const overlap = Math.max(
          0,
          Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
        );
        const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - viewportHeight / 2);
        return { element, overlap, centerDistance };
      })
      .filter((item) => item.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || a.centerDistance - b.centerDistance)[0]
      ?.element || null;
  }

  function getUsernameFromProfileLink(link) {
    const href = link?.getAttribute?.("href") || "";
    if (!href) return "";
    try {
      const parsed = new URL(href, location.origin);
      const match = parsed.pathname.match(/^\/@([A-Za-z0-9._]+)\/?$/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  }

  function getCurrentUsername() {
    if (isListMode() || isMobileMode()) return controller.currentUsername || "";
    return isForYouMode() ? getForYouUsername() : getLiveUsername();
  }

  function getProfileUsername() {
    const match = location.pathname.match(/^\/@([A-Za-z0-9._]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function isLivePage() {
    return Boolean(getLiveUsername());
  }

  function isForYouPage() {
    const pathname = location.pathname.replace(/\/+$/, "") || "/";
    return (
      pathname === "/" ||
      pathname === "/foryou" ||
      /^\/[a-z]{2}-[A-Z]{2}$/.test(pathname)
    ) && Boolean(getForYouUsername());
  }

  function isForYouMode() {
    return controller.settings?.mode === "foryou";
  }

  function isLiveProfileMessaging() {
    return controller.settings?.mode === "live" &&
      controller.settings?.liveProfileMessaging === true;
  }

  function isListMode() {
    return controller.settings?.mode === "list" || controller.settings?.mode === "manual";
  }

  function isManualListMode() {
    return controller.settings?.mode === "manual";
  }

  // Listeden Kontrol + profil gönderimi: uygunluk İlişkiyi yönet, mesaj profil üzerinden.
  function isManualInstantMessaging() {
    return isManualListMode() && controller.settings?.liveProfileMessaging !== true;
  }

  function isMobileMode() {
    return controller.settings?.mode === "mobile";
  }

  function isNameCollectionMode() {
    return controller.settings?.mode === "collect";
  }

  function isPersonalMessageMode() {
    return controller.settings?.mode === "personal";
  }

  function nextItemName() {
    return isForYouMode() ? "videoya" : "yayına";
  }

  function isControllerPage(mode, profileMessaging = false, personalSource = "feed") {
    // Tikleap kaynağında yayıncılar listeden gelir; herhangi bir TikTok sayfası yeterli.
    if (mode === "personal" && personalSource === "tikleap") {
      return isTikTokPage() && location.hostname.toLowerCase() !== "live-backstage.tiktok.com";
    }
    if (mode === "manual" && profileMessaging) {
      return isTikTokPage() && location.hostname.toLowerCase() !== "live-backstage.tiktok.com";
    }
    if (mode === "manual") {
      return location.hostname.toLowerCase() === "live-backstage.tiktok.com" &&
        location.pathname === "/portal/anchor/instant-messages";
    }
    if (mode === "list" || mode === "mobile") return isTikTokPage();
    return mode === "foryou" ? isForYouPage() : isLivePage();
  }

  function isTikTokPage() {
    const hostname = location.hostname.toLowerCase();
    return hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
  }

  async function waitForUsernameChange(previous, timeoutMs) {
    const started = Date.now();
    while (controller.running && Date.now() - started < timeoutMs) {
      // CANLI yayın geçişi yalnız görünen başlık değiştiğinde doğrulanır.
      // URL tek başına değişip eski yayın ekranda kalabilir veya URL sabit kalabilir.
      const current = isForYouMode() ? getCurrentUsername() : getLiveHeaderUsername();
      if (current && current.toLocaleLowerCase("tr") !== previous.toLocaleLowerCase("tr")) {
        return current;
      }
      await delay(150);
    }
    return "";
  }

  async function waitFor(factory, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = factory();
      if (value) return value;
      await delay(250);
    }
    return null;
  }

  function randomDelayMs(settings) {
    const min = Number(settings.minDelaySeconds || 4) * 1000;
    const max = Number(settings.maxDelaySeconds || 7) * 1000;
    return Math.round(min + Math.random() * Math.max(0, max - min));
  }

  function randomSkipPacingMs() {
    const [min, max] = SKIP_PACING_RANGE_MS;
    return Math.round(min + Math.random() * Math.max(0, max - min));
  }

  function randomCollectPacingMs() {
    const [min, max] = PERSONAL_COLLECT_PACING_RANGE_MS;
    return Math.round(min + Math.random() * Math.max(0, max - min));
  }

  function formatSeconds(ms) {
    return (Math.max(0, Number(ms) || 0) / 1000).toLocaleString("tr-TR", {
      maximumFractionDigits: 1
    });
  }

  function describeDmOutcome(dm) {
    if (!dm?.ok) return "dm_failed";
    if (dm.followerSkipped) {
      return dm.followerReason === "low_followers" ? "low_followers" : "follower_unknown";
    }
    if (dm.unavailableSkipped) return String(dm.unavailableReason || "dm_surface");
    if (dm.alreadySent) return "already_sent";
    return "sent";
  }

  // Bir yayıncının işlenmesi boyunca aşama sürelerini toplar. mark(aşama), son
  // işaretten bu yana geçen süreyi o aşamaya yazar; detail(aşama, alt aşamalar)
  // arka plandan gelen DM alt adımlarını saklar.
  function createPhaseTimer() {
    const startedAt = Date.now();
    let lastAt = startedAt;
    const phases = {};
    const details = {};
    return {
      mark(phase) {
        const now = Date.now();
        phases[phase] = (phases[phase] || 0) + (now - lastAt);
        lastAt = now;
      },
      detail(phase, breakdown) {
        if (breakdown && typeof breakdown === "object") details[phase] = { ...breakdown };
      },
      summary() {
        return { total: Date.now() - startedAt, phases: { ...phases }, details: { ...details } };
      }
    };
  }

  async function recordTiming(username, outcome, timer) {
    try {
      const summary = timer.summary();
      await sendRuntimeMessageWithTimeout(
        { type: "BTG_RECORD_TIMING", timing: { username, outcome, ...summary } },
        15000,
        "Süre kaydı yazılamadı."
      );
    } catch {
      // Süre kaydı tanılama amaçlıdır; ana akışı durdurmamalı.
    }
  }

  async function interruptibleDelay(ms) {
    const end = Date.now() + ms;
    while (controller.running && Date.now() < end) {
      await delay(Math.min(250, end - Date.now()));
    }
  }

  async function getState() {
    return sendRuntimeMessageWithTimeout(
      { type: "BTG_GET_STATE" },
      15000,
      "Eklenti çalışma durumu 15 saniye içinde alınamadı."
    );
  }

  async function runtimePatch(patch, log) {
    return sendRuntimeMessageWithTimeout(
      {
        type: "BTG_RUNTIME_PATCH",
        patch,
        log
      },
      15000,
      "Eklenti çalışma durumu 15 saniye içinde güncellenemedi."
    );
  }

  function sendRuntimeMessageWithTimeout(message, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      chrome.runtime.sendMessage(message)
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  async function stopWithError(message) {
    controller.running = false;
    controller.exitReason = message;
    if (isMobileMode()) {
      try {
        await sendRuntimeMessageWithTimeout(
          { type: "BTG_MOBILE_SESSION_STOP" },
          15000,
          "Mobil telefon oturumu kapatılamadı."
        );
      } catch {
        // Asıl hata kaydı korunur; köprü kapatma uyarısı bunun önüne geçmez.
      }
    }
    const state = await getState();
    await runtimePatch(
      {
        running: false,
        failed: Number(state?.runtime?.failed || 0) + 1,
        status: message
      },
      { level: "error", username: getCurrentUsername(), message }
    );
  }

  async function reportUnexpectedControllerError(error) {
    controller.running = false;
    const detail = error?.message || String(error || "Bilinmeyen hata");
    controller.exitReason = detail;
    const message = `Otomasyon beklenmeyen bir hatayla durdu: ${detail}`;

    if (isMobileMode()) {
      try {
        await sendRuntimeMessageWithTimeout(
          { type: "BTG_MOBILE_SESSION_STOP" },
          15000,
          "Mobil telefon oturumu kapatılamadı."
        );
      } catch {
        // Beklenmeyen asıl hata raporlanmaya devam eder.
      }
    }

    try {
      // getState arka planda kontrol sekmesine PING atar; bu kopya running=false
      // olduğundan 30 sn hareketsizlikte "artık çalışmıyor" diye oturumu kapatıp gerçek
      // hatayı yutuyordu (2026-10-14). Durum doğrudan depodan okunur.
      const { runtime: stored } = await chrome.storage.local.get("runtime");
      if (!stored?.running) return;
      await runtimePatch(
        {
          running: false,
          failed: Number(stored?.failed || 0) + 1,
          status: message,
          lastStep: "Beklenmeyen hata",
          lastError: detail
        },
        { level: "error", username: getCurrentUsername(), message }
      );
      return;
    } catch {
      // Arka plan servisine ulaşılamıyorsa durum doğrudan yerel depoya yazılır.
    }

    try {
      const { runtime } = await chrome.storage.local.get("runtime");
      const current = runtime || {};
      if (!current.running) return;
      const logs = Array.isArray(current.logs) ? [...current.logs] : [];
      logs.unshift({
        time: new Date().toISOString(),
        level: "error",
        username: getCurrentUsername(),
        message
      });
      await chrome.storage.local.set({
        runtime: {
          ...current,
          running: false,
          failed: Number(current.failed || 0) + 1,
          status: message,
          lastStep: "Beklenmeyen hata",
          lastError: detail,
          lastActivityAt: new Date().toISOString(),
          logs: logs.slice(0, 100)
        }
      });
    } catch {
      // Eklenti bağlamı tamamen kapanmışsa yazılabilecek başka bir yüzey yoktur.
    }
  }

  async function finishNormally(message) {
    controller.running = false;
    if (isMobileMode()) {
      try {
        await sendRuntimeMessageWithTimeout(
          { type: "BTG_MOBILE_SESSION_STOP" },
          15000,
          "Mobil telefon oturumu kapatılamadı."
        );
      } catch {
        // Çalışma sonucu tamamlanmıştır; köprü masaüstü uygulamasından da durdurulabilir.
      }
    }
    await runtimePatch({ running: false, status: message });
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0.05 &&
      element.getAttribute("aria-hidden") !== "true"
    );
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
