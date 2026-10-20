/* Kişisel mesaj: toplanan yayıncı kartlarından Sonnet/Haiku için model notu (.md) üretir. */
(() => {
  const TIME_ZONE = 'Europe/Istanbul';
  const HEADERS = ['Kullanıcı Adı', 'Davet Mesajı', 'Kullanılan Bilgiler'];

  const count = value => Number.isFinite(value) ? Math.round(value).toLocaleString('tr-TR') : null;

  function stampParts(date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('tr-TR', {
      timeZone: TIME_ZONE, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value]));
    parts.month = parts.month.charAt(0).toLocaleUpperCase('tr-TR') + parts.month.slice(1);
    return parts;
  }

  function fileName(date = new Date(), options = {}) {
    const parts = stampParts(date);
    const source = options.tikleap ? 'Tikleap_' : '';
    return `Kişisel_Mesaj_${source}${parts.month}_${parts.day}_${parts.hour}-${parts.minute}.md`;
  }

  function angleLines(profile) {
    const live = profile.live || {};
    const history = profile.history || {};
    const lines = {
      hediye: `Hediye fırsatı: yayına ${count(live.visitors)} kişi uğramış ama hediye tarafı henüz açılmamış. İzleyici geliyor ama hediyeye dönüşmüyor.`,
      trafik: `Trafik açık ama izleyici kalmıyor: yayına ${count(live.visitors)} kişi uğramış, gelenlerin çoğu yayında kalmamış.`,
      izleniyor: `Yayın izleniyor: aynı anda ${count(live.viewersNow)} izleyici var${Number.isFinite(live.visitors) ? `, toplam ${count(live.visitors)} kişi uğramış` : ''}.`,
      duzen: `Düzenli yayın: son ${history.coverageDays || 30} günde ${count(history.days30)} farklı gün, son 7 günde ${count(history.days7)} gün yayın açmış.`,
      begeni_takipci: `Beğeni takipçinin çok üstünde: yayın başına ortalama ${count(history.avgLikes)} beğeni, ${count(profile.followers)} takipçi.`,
      video: `Son 30 gündeki videolarından biri ${count(profile.videos?.best?.plays)} izlenme almış (${profile.videos?.best?.date}).`,
      esli: `@${profile.cohost?.username} ile eşli yayındaydı.`
    };
    return (profile.angles || []).filter(code => lines[code]).map(code => lines[code]);
  }

  function card(row, index) {
    const profile = row.profile || {};
    const live = profile.live || {};
    const history = profile.history;
    const videos = profile.videos;
    const out = [`### ${index + 1}. ${row.username}`, ''];
    const add = line => { if (line) out.push(`- ${line}`); };
    add(`Veri zamanı: ${profile.collectedLabel || '—'} (İstanbul)`);
    add(Number.isFinite(profile.followers) ? `Takipçi: ${count(profile.followers)}` : 'Takipçi: okunamadı');
    if (row.tikleap?.league) add(`Türkiye ligi: ${row.tikleap.league}, ${row.tikleap.rank}. sıra (yalnız arka plan bilgisi, mesajda kullanma)`);

    if (live.isLive) out.push('', `**Yayın (${(profile.collectedLabel || '').split(' ').slice(0, 2).join(' ') || 'toplama günü'})**`);
    else out.push('', '**Son yayın (veri toplanırken yayın kapalıydı)**');
    add([live.category && `Kategori: ${live.category}`, live.game && `Oyun: ${live.game}`].filter(Boolean).join(' · '));
    if (Number.isFinite(live.minutesLive)) add(`Veri alındığında yayın ${count(live.minutesLive)} dakikadır açıktı`);
    add([
      Number.isFinite(live.viewersNow) && `Aynı anda izleyen: ${count(live.viewersNow)}`,
      Number.isFinite(live.visitors) && `${live.isLive ? 'Bu yayına' : 'Son yayına'} uğrayan: ${count(live.visitors)}`,
      Number.isFinite(live.gifters) && `Hediye atan: ${live.giftersPartial ? 'en az ' : ''}${count(live.gifters)} kişi`
    ].filter(Boolean).join(' · '));

    if (profile.card) {
      out.push('', '**Yayıncı kartı**');
      add([
        Number.isFinite(profile.card.fansClub) && `Hayran kulübü: ${count(profile.card.fansClub)}`,
        Number.isFinite(profile.card.giftsTotal) && profile.card.giftsTotal > 0 && `Hediye galerisi: ${count(profile.card.giftsLit)}/${count(profile.card.giftsTotal)}`
      ].filter(Boolean).join(' · '));
    }

    if (history) {
      out.push('', `**Son ${history.coverageDays} gün yayın geçmişi**`);
      if (!history.streams30) add('Bu dönemde 5 dakikayı aşan geçmiş yayın kaydı yok.');
      else {
        add(`${count(history.days30)} farklı gün yayın açmış (son 14 günde ${count(history.days14)}, son 7 günde ${count(history.days7)} gün)`);
        add(`Ortalama süre ${count(history.avgMinutes)} dk · ortalama beğeni ${count(history.avgLikes)}`);
        if (history.best) add(`En çok beğeni alan: ${history.best.date}, ${count(history.best.minutes)} dk, ${count(history.best.likes)} beğeni`);
      }
    }

    if (videos) {
      out.push('', `**Videolar (son ${videos.count})**`);
      if (!videos.count) add('Okunabilen video yok.');
      else {
        add(`Son paylaşım: ${videos.latestDate} · son 30 günde ${count(videos.posted30)} video`);
        if (videos.best) add(`Son 30 günde en çok izlenen: ${videos.best.date}, ${count(videos.best.plays)} izlenme`);
      }
    }

    if (profile.cohost) {
      out.push('', '**Eşli yayın**');
      add(`@${profile.cohost.username}${Number.isFinite(profile.cohost.followers) ? ` (${count(profile.cohost.followers)} takipçi)` : ''}`);
    }

    const angles = angleLines(profile);
    out.push('', '**Öne çıkanlar**');
    if (angles.length) angles.forEach(add);
    else add('Belirgin bir öne çıkan yok; yukarıdaki verilerden en doğal olanı seç.');

    if (profile.notes?.length) {
      out.push('', '**Dikkat**');
      profile.notes.forEach(add);
    }
    out.push('');
    return out.join('\n');
  }

  function buildMarkdown(rows, options = {}) {
    const list = Array.isArray(rows) ? rows.filter(row => row?.username) : [];
    const created = stampParts(options.createdAt ? new Date(options.createdAt) : new Date());
    const header = `| ${HEADERS.join(' | ')} |`;
    return [
      '# BTG Kişisel Mesaj Notu',
      '',
      `Oluşturulma: ${created.day} ${created.month} ${created.year} ${created.hour}:${created.minute} (İstanbul) · Yayıncı sayısı: ${list.length}`,
      '',
      '## Görev',
      '',
      'Aşağıdaki her yayıncıya TikTok’ta gönderilecek kişisel bir ilk mesaj yaz. Sonucu indirilebilir tek sayfalık bir Excel (.xlsx) dosyası olarak ver. Bu dosyayı eklentideki “Listeden Kontrol” akışında “Özel davet Excel’i” alanına yükleyeceğim.',
      '',
      '## Excel biçimi (zorunlu)',
      '',
      '- Tek sayfa. İlk satır başlık satırı, sütunlar tam olarak bu adlarla ve bu sırayla:',
      '',
      header,
      '|---|---|---|',
      '',
      '- Her yayıncı için bir satır, bu nottaki sırayla. Kullanıcı adını başlıktaki gibi aynen yaz (@ işareti olmadan, harfleri değiştirmeden).',
      '- “Davet Mesajı” gönderilecek metnin tamamıdır. Paragraflar arasında tek boş satır bırakabilirsin. 5.000 karakteri geçmesin.',
      '- “Kullanılan Bilgiler” sütununa mesajda dayandığın verileri kısaca yaz (ör. “uğrayan 1.240, hediye atan 2”).',
      '- Kullanılabilir hiçbir veri yoksa “Davet Mesajı” hücresini boş bırak ve nedenini “Kullanılan Bilgiler” sütununa yaz. Boş mesajlar gönderilmez.',
      '- Excel’e başka sayfa, başlık, birleştirilmiş hücre veya açıklama satırı ekleme.',
      '',
      '## Mesaj kuralları',
      '',
      '1. Her mesaj tam olarak “Selamlar. Ben burak, resmi tiktok canlı yayın ajansı BTG Teknoloji’de çalışıyorum.” cümlesiyle başlasın ve ardından boş satır gelsin. Yayıncının ismini, takma adını veya kullanıcı adını yazma.',
      '2. Mesajın tamamında “sen” diye hitap et, “siz” kullanma. Giriş ve kapanış cümleleri sabittir, küçük harfler dahil aynen yaz. Sıcak, saygılı ve doğal ol, satış dili kullanma. Bir arkadaşa yazar gibi gündelik konuşma dili kullan.',
      '2a. Kurumsal ve resmi kelimeler kullanma: “optimizasyon”, “gelir optimizasyonu”, “performans”, “potansiyel”, “süreç”, “kapsamlı”, “takdire değer”, “bunu görmek çok güzel”, “faaliyet”, “hizmet”. Bunların yerine sade karşılıklar yaz: “hediyeleri artırmak”, “yayınların daha iyi gitmesi”, “büyüyebilirsin”, “hesap ve kısıtlama sorunları”, “her hafta verilere bakıp geri dönüş yapıyoruz”.',
      '3. Karttaki verilerden iyi görünen tek bir şeyi seç ve tanıtımdan sonraki paragrafta konuşur gibi anlat: önce “Yayınlarına baktım” diye başlayıp veriyi söyle, ardından ayrı ve kısa bir övgü cümlesi yaz. Örnek: “Yayınlarına baktım son bir ayda 17 gün yayın açmışsın. Baya düzenlisin.” Bu kadarı yeterli. Birden fazla veriyi art arda sıralama, en fazla bir rakam kullan. Verinin ne anlama geldiğini açıklama (“izleyicinin seni sevdiğini gösteriyor”, “takipçi sayına göre bu çok güçlü bir ilgi” gibi yorumlar yazma).',
      '3a. Abartma. “Gerçekten”, “çok büyük”, “çok güçlü”, “harika”, “inanılmaz”, “muhteşem”, “büyük emek”, “hiç aksatmadan” gibi kelimeler ve “bu düzeni tutturmak gerçekten emek istiyor” gibi kalıplar yasak. Övgü ölçülü, sade ve neyin iyi olduğunu söyleyen kısa bir cümle olsun: “Baya düzenlisin.”, “İlgi baya iyi.”, “Baya ilgi görüyorsun.”, “Güzel bir topluluk kurmuşsun.” Genel geçer “iyi gidiyorsun” yazma.',
      '3c. Sayıyı rapor gibi değil konuşur gibi söyle: “son 30 günde” yerine “son bir ayda”. 30 günün hepsi için “bir aydır her gün yayındasın”, 25-29 gün için “son bir ayda neredeyse her gün yayındasın”, 15-24 gün için “son bir ayda 17 gün yayın açmışsın”, son 7 günün hepsi için “bir haftadır her gün yayındasın”.',
      '3b. Mesaj bir insanın telefondan yazdığı gibi dursun: kısa cümleler, rapor dili yok. “Üstelik”, “bu da gösteriyor ki”, “dikkatimi çekti” gibi bağlaçlar ve analiz kalıpları kullanma.',
      '4. Sayıları yuvarla ve doğal yaz: “1.240” yerine “1.200’den fazla”, “8.230” yerine “8 bin civarı”.',
      '5. Mesaj veri zamanından sonra gönderilebilir. “Bugün”, “şu an”, “az önce”, “şu anki yayınında” yazma. Tarih gerektirmeyen verileri tercih et (30 günde kaç gün yayın, ortalama beğeni). Belirli bir yayından bahsederken tarih yazma, “son yayınlarından birine” de: “son yayınlarından birine 1.200’den fazla kişi uğramış”, “son yayınlarından biri 100 bin civarı beğeni almış”.',
      '6. Yalnız kartta yazan bilgileri kullan. Yayının içeriği, oyun detayı veya kişi hakkında tahmin yürütme, bilgi uydurma. Kişinin özel hayatına, yaşadığı hesap sorunlarına (ban, kısıtlama), kişisel hedeflerine veya yayın başlığındaki konulara değinme.',
      '6a. Yayın sayısı yazma (“75 yayın” gibi), kısa yayınlar bu sayıyı şişiriyor. Düzeni gün sayısıyla anlat: “son 30 günde 20 farklı gün yayın açmışsın”.',
      '6b. Tarihi 30 günden eski bir video veya yayından bahsetme.',
      '7. Asla yazma: sohbet konuşmaları, hediye atan veya izleyen kişilerin adları, telefon, e-posta, sosyal medya veya bağlantı bilgisi, jeton ve kazanç miktarı, “ortam çok samimiydi” gibi izlenimler, “uzun süredir izliyorum” ya da “yayınını takip ediyorum” gibi uzun süre izlediğini ima eden cümleler.',
      '8. Mesajda eksik veya zayıf bir yönden bahsetme, yalnız iyi olanı söyle. “Hediye tarafı henüz açılmamış”, “izleyici kalmıyor” gibi cümleler yazma. Zayıf yön yalnız köprü cümlesini seçerken işine yarar (ör. çok uğrayan ama hediye az ise “Bu ilgiyi hediyeye de dönüştürmende destek olabiliriz.”).',
      '8a. Küçük sayıları hiç yazma: hediye atan kişi sayısını asla yazma, aynı anda izleyen 50’den veya uğrayan 100’den azsa bu sayıları kullanma. “Aynı anda 2 kişi”, “hediye atan 1 kişi” gibi cümleler yasak.',
      '8b. Suçlayıcı veya eksik arayan ton kullanma: “neden hediye gelmiyor”, “izleyicin neden kalmıyor”, “bunu yapmıyorsun” gibi kişiyi sorumlu tutan ifadeler yasak. Durumu nötr anlat ve desteğe bağla.',
      '9. Mesaj sırası: tanıtım cümlesi, gözlem paragrafı, ajans desteği paragrafı, kapanış. Tanıtımı ikinci kez tekrarlama.',
      '9a. En önemli kural: gözlemi verip bırakma, mutlaka ajansa bağla. Ajans desteği paragrafı, gözlemde anlattığın şeyin bizimle nasıl daha fazla karşılık bulacağını söyleyen bir köprü cümlesiyle başlasın. Örnekler:',
      '    - Düzenli yayın: “Bu kadar emek verdiğin yayınların daha fazla karşılık bulmasını sağlayabiliriz.”',
      '    - Yüksek beğeni veya izlenme: “Bu ivmeni daha fazla takipçiye ve hediyeye dönüştürmende destek olabiliriz.”',
      '    - Çok uğrayan: “Bu ilgiyi hediyeye de dönüştürmende destek olabiliriz.”',
      '    - Aynı anda çok izleyen: “Bu ilginin karşılığını hediye tarafında da görmen için destek olabiliriz.”',
      '10. Köprü cümlesinin hemen ardından her mesajda aynen “Desteğimiz tamamen ücretsiz.” yaz. Başka destek cümlesi ekleme.',
      '11. Mesajın son paragrafı her mesajda aynen şu kapanış olsun:',
      '    “Müsait olduğunda sana ajansımız hakkında kısaca bilgi vermek isterim.”',
      '    Kapanışı değiştirme, sonuna soru ekleme. “Daha önce bir ajansa katıldın mı?”, “Şu an bir ajansla çalışıyor musun?” gibi sorular yazma.',
      '    Yayının içeriği, oyun, hedefler, özel hayat veya alışkanlıklar hakkında soru sorma (ör. “O videodan sonra fark hissettin mi?”, “Emlak yayınlarında en çok hangi sorular geliyor?” gibi sorular yasak). Baskı kurma, “hemen dönüş yap” gibi ifadeler kullanma.',
      '12. Uzunluk 35-60 kelime, kısa olan daha iyi. Noktalı virgül (;) ve uzun tire (—) kullanma. Emoji kullanma.',
      '13. Mesajların birbirine benzemesi sorun değil, her yayıncı yalnız kendi mesajını görür. Farklı olsun diye alışılmadık gözlem veya soru arama.',
      '14. Biyografi, yayın başlığı ve video açıklamaları kartlara bilerek konmadı. Bunlar hakkında tahmin yürütme.',
      ...(list.some(row => row.tikleap) ? ['15. Kartlardaki “Türkiye ligi” satırı yalnız arka plan bilgisidir. Mesajda lig, sıra, sıralama, Tikleap veya kazanç bilgisinden bahsetme.'] : []),
      '',
      '## Verileri yorumlama',
      '',
      '- “Bu yayına uğrayan” o yayına giren toplam kişi sayısıdır. “Aynı anda izleyen” veri alındığı andaki izleyicidir.',
      '- Övülecek tek şeyi seçerken bu sırayı izle: düzenli yayın (son 30 günde çok sayıda farklı gün), yüksek ortalama beğeni, çok uğrayan, aynı anda çok izleyen, hayran kulübü.',
      '- Son 30 günde çok sayıda farklı gün yayın varsa: “Yayınlarına baktım son bir ayda 22 gün yayın açmışsın. Baya düzenlisin.” Köprü: “Bu kadar emek verdiğin yayınların daha fazla karşılık bulmasını sağlayabiliriz.”',
      '- Ortalama beğeni yüksekse: “Yayınlarına baktım ortalama 10 bin civarı beğeni alıyorsun. Baya ilgi görüyorsun.” Takipçiyle kıyaslama yapma.',
      '- Tek yayında yüksek beğeni varsa: “Yayınlarına baktım son yayınlarından biri 100 bin civarı beğeni almış. Baya ilgi görüyorsun.” Köprü: “Bu ivmeni daha fazla takipçiye ve hediyeye dönüştürmende destek olabiliriz.”',
      '- Uğrayan çoksa: “Yayınlarına baktım son yayınlarından birine 1.200’den fazla kişi uğramış. İlgi baya iyi.” Hediye az olsa bile bunu yazma, yalnız köprüyü hediyeye bağla.',
      '- Uğrayan çok, aynı anda izleyen az ise bunu mesajda söyleme. Başka bir iyi veri yoksa köprüyü izleyiciyi yayında tutmaya bağla.',
      '- “Son yayın (veri toplanırken yayın kapalıydı)” başlıklı kartlarda yayıncı o an canlı değildi. “Son yayına uğrayan” sayısı en son bitmiş yayına aittir; “hediye tarafı dönmemiş” veya “izleyici kalmıyor” gibi gözlemleri bu sayıdan çıkarma. Düzenli yayın (gün sayısı), beğeni, hayran kulübü ve videolardan en doğal olanı kullan.',
      '- “Dikkat” bölümündeki uyarılara uy. Yayın yeni açılmışsa ziyaretçi ve hediye sayılarını kullanma.',
      '',
      '## Ton örnekleri (kopyalama, yalnız tonu gör)',
      '',
      '> Selamlar. Ben burak, resmi tiktok canlı yayın ajansı BTG Teknoloji’de çalışıyorum.',
      '>',
      '> Yayınlarına baktım son yayınlarından biri 5 bin civarı beğeni almış. Baya ilgi görüyorsun.',
      '>',
      '> Bu ivmeni daha fazla takipçiye ve hediyeye dönüştürmende destek olabiliriz. Desteğimiz tamamen ücretsiz.',
      '>',
      '> Müsait olduğunda sana ajansımız hakkında kısaca bilgi vermek isterim.',
      '',
      '> Selamlar. Ben burak, resmi tiktok canlı yayın ajansı BTG Teknoloji’de çalışıyorum.',
      '>',
      '> Yayınlarına baktım son bir ayda 17 gün yayın açmışsın. Baya düzenlisin.',
      '>',
      '> Bu kadar emek verdiğin yayınların daha fazla karşılık bulmasını sağlayabiliriz. Desteğimiz tamamen ücretsiz.',
      '>',
      '> Müsait olduğunda sana ajansımız hakkında kısaca bilgi vermek isterim.',
      '',
      'Yapma (fazla veri, rapor dili, abartı, eksik vurgusu):',
      '',
      '> Son 30 günde 22 farklı gün yayın açmışsın, bu düzeni tutturmak gerçekten emek istiyor. 19 Ekim’deki yayınına 500’den fazla kişi uğramış ama hediye tarafı henüz açılmamış gibi duruyor.',
      '',
      '## Yayıncı kartları',
      '',
      ...(list.length ? list.map(card) : ['Bu oturumda kayıt toplanmadı.', ''])
    ].join('\n');
  }

  const api = {HEADERS, fileName, buildMarkdown};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.BTGPersonalPackage = api;
})();
