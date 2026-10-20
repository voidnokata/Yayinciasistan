# BTG TikTok Yayıncı Asistanı

TikTok LIVE ajans ekibi için geliştirilmiş, ajansın kendi LIVE Backstage hesabıyla kullanılan dahili bir Chrome (Manifest V3) eklentisi. Yayıncı takibindeki tekrarlayan işleri otomatikleştirir: Backstage üzerinden uygunluk kontrolü yapar, yayıncı kimliklerini ve takipçi sayılarını Excel'e toplar, haftalık geri bildirim ve kişisel mesaj taslaklarını hazırlayıp onaylı gönderimi sıraya alır.

## Özellikler

- **Mesaj gönderimi:** LIVE Backstage sekmesinde seçilen uygun yayıncılara mesaj gönderir. Gönderim sırasında sekmedeki girdi alanları eklenti tarafından doldurulur.
- **Excel raporu:** Yayıncı kimliklerini ve takipçi sayılarını dışa aktarır. Dosya yazıcısı `src/core/xlsx-writer.js` içindedir; harici kütüphane kullanılmaz.
- **Kişisel mesaj notu:** Yayıncı profiline göre kişisel mesaj için taslak not üretir (`src/background/personal-package.js`, `src/core/personal-profile.js`).
- **Geri bildirim paneli:** Yayıncılara gönderilecek geri bildirim mesajlarını hazırlar, sıraya alır ve geçmişini tutar (`src/ui/feedback.html`).
- **Davet, takım ve lig planı:** Davet listesi, takım planı ve TikLeap lig planı için ayrı ekranlar bulunur.
- **Çıktı klasörü:** Dışa aktarılan dosyaların kaydedileceği klasörü seçmenizi sağlar.
- **Mobil köprü (isteğe bağlı):** Eklenti `http://127.0.0.1:8765` adresindeki yerel bir köprüyle konuşabilir. Bu köprü bu depoda yoktur; yalnızca eklentinin bağlanabildiği bir arayüz olarak tanımlanır.

## Klasör yapısı

```
manifest.json          Eklenti tanımı (kökte kalır)
src/background/        Servis çalışanı: mesaj yönlendirme, kuyruklar, backstage API istemcisi
src/content/           Sayfa betikleri: TikTok, LIVE Backstage, TikLeap
src/core/              Ortak mantık; tarayıcıda ve Node'da çalışır
src/ui/                Popup ve panel sayfaları (HTML, CSS, JS)
tests/                 Node test dosyaları; tests/fixtures/ sentetik veri içerir
docs/                  Geri bildirim yazım rehberi
```

## Kurulum

1. Bu depoyu bilgisayarınıza indirin veya klonlayın.
2. Chrome'da `chrome://extensions` adresini açın.
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle** düğmesine basın ve `manifest.json` dosyasının bulunduğu klasörü seçin.

Eklenti yüklendikten sonra araç çubuğundaki simgeden popup'ı açabilirsiniz.

## Kullanım

1. Chrome'da TikTok hesabınıza giriş yapın ve LIVE Backstage sayfasını açın.
2. Eklenti popup'ını açın ve çıktı klasörünü seçin.
3. Çalıştırmak istediğiniz işlemi seçin ve başlatın. İşlem sırasında durdurmak için popup'taki durdur düğmesini kullanın.
4. Dışa aktarılan dosyalar seçtiğiniz çıktı klasörüne kaydedilir.

Eklenti, ayrı bir sunucu gerektirmez; işlemler tarayıcıda, sizin oturumunuzla çalışır.

## Testler

Testler Node.js'in yerleşik test çalıştırıcısıyla çalışır. Bu depo Node 24 ile denenmiştir.

```
node --test "tests/*.test.js"
```

Tırnak işaretleri önemlidir; dizin adını doğrudan vermek Node 24'te test dosyası olarak yorumlanır.

## Gizlilik ve veri notları

- Ayarlar ve geçmiş gibi eklenti verileri tarayıcının yerel depolama alanında (`chrome.storage` ve IndexedDB) tutulur.
- Eklenti, bu depoda tanımlı dış adresler dışında bir sunucuya veri göndermez. Bilinen adresler TikTok (`tiktok.com`, `live-backstage.tiktok.com`), TikLeap (`tikleap.com`) ve yerel `127.0.0.1:8765` köprüsüdür.
- Mesaj gönderimi için `debugger` izni kullanılır. Bu izin, yalnızca LIVE Backstage sekmesine fare ve klavye girdisi göndermek için kullanılır.
- Dışa aktarılan dosyalar, çıktı klasörü ayarınıza göre kaydedilir.
- Testlerdeki veriler sentetiktir; gerçek yayıncı verisi test dosyalarında bulunmaz.
