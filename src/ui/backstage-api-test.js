const form = document.getElementById("probeForm");
const probeButton = document.getElementById("probeButton");
const summary = document.getElementById("summary");
const detail = document.getElementById("detail");
const diagnostic = document.getElementById("diagnostic");
const copyButton = document.getElementById("copyButton");
const copyStatus = document.getElementById("copyStatus");
document.getElementById("version").textContent = `Sürüm ${chrome.runtime.getManifest().version} · Deneysel bağlantı testi`;

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (probeButton.disabled) return;
  probeButton.disabled = true;
  copyButton.disabled = true;
  diagnostic.value = "";
  copyStatus.textContent = "";
  summary.textContent = "Doğrudan sorgulanıyor…";
  detail.textContent = "Sonuç bekleniyor; Backstage sekmesine geçmeniz gerekmiyor.";
  try {
    const result = await chrome.runtime.sendMessage({
      type: "BTG_PROBE_BACKSTAGE_API", mode: document.getElementById("mode").value, username: document.getElementById("username").value
    });
    if (!result) throw new Error("no-response");
    summary.textContent = result.ok
      ? `Doğrudan sorgu başarılı — ${result.eligible === false ? "Uygun değil" : "Sonuç alındı"}`
      : result.dataReceived ? "Doğrudan veri alındı — uygunluk yorumu tamamlanmadı" : "Doğrudan sorgu tamamlanamadı";
    detail.textContent = result.reason || result.error || "Sonuç tanılama alanında gösteriliyor.";
    diagnostic.value = JSON.stringify({ version: chrome.runtime.getManifest().version, ...result }, null, 2);
    copyButton.disabled = false;
  } catch {
    summary.textContent = "Eklentiden yanıt alınamadı.";
    detail.textContent = "Eklentiyi yenilediyseniz bu deneme sayfasını kapatıp eklenti düğmesinden yeniden açın.";
  } finally {
    probeButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(diagnostic.value);
    copyStatus.textContent = "Sonuç kopyalandı; sohbete yapıştırabilirsiniz.";
  } catch {
    diagnostic.focus();
    diagnostic.select();
    copyStatus.textContent = "Sonuç seçildi. Ctrl+C ile kopyalayabilirsiniz.";
  }
});
