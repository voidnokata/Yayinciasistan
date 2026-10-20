/* Offline invitations: only explicit, dated collection measurements are used. */
(() => {
  const normalize = value => String(value ?? '').trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/\s+/g, ' ');
  function username(value) {
    const name = String(value ?? '').trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{2,32}$/.test(name)) throw new Error(`Geçersiz kullanıcı adı: ${name}`);
    return name;
  }
  function table(rows, required) {
    const index = rows.findIndex(row => required.every(aliases => row.some(cell => aliases.includes(normalize(cell)))));
    if (index < 0) throw new Error(`Gerekli sütunlar bulunamadı: ${required.map(a => a[0]).join(', ')}.`);
    const headers = rows[index].map(normalize);
    if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error('Aynı başlık birden fazla kez kullanılmış.');
    return rows.slice(index + 1).filter(row => row.some(v => String(v ?? '').trim())).map(row => {
      const get = (...names) => row[headers.findIndex(h => names.includes(h))] ?? '';
      return {get};
    });
  }
  function numeric(value, max = 1e12) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  }
  function splitCollection(rows) {
    const headerIndex = rows.findIndex(row => row.some(v => ['yayinci id','kullanici adi'].includes(normalize(v))) && row.some(v => normalize(v) === 'sinif'));
    if (headerIndex < 0) throw new Error('Yayıncı ID / Kullanıcı Adı ve Sınıf sütunları bulunamadı.');
    const header = rows[headerIndex], labels = header.map(normalize);
    if (labels.filter(v=>['yayinci id','kullanici adi'].includes(v)).length !== 1 || labels.filter(v=>v==='sinif').length !== 1) throw new Error('Kullanıcı adı ve sınıf sütunları birer kez bulunmalı.');
    const nameIndex = labels.findIndex(v => ['yayinci id','kullanici adi'].includes(v)), classIndex = labels.indexOf('sinif');
    const thirdRows = [header.slice()], remainingRows = [header.slice()], seen = new Map();
    for (const original of rows.slice(headerIndex + 1)) {
      if (!original.some(v => String(v ?? '').trim())) continue;
      const name = username(original[nameIndex]), key = name.toLowerCase();
      const match = String(original[classIndex] ?? '').trim().match(/^([0-3])(?:\.\s*s[ıi]n[ıi]f)?$/i);
      if (!match) throw new Error(`@${name} için geçerli bir sınıf (0–3) bulunamadı.`);
      const classId = Number(match[1]), row = Array.from(original, v => v ?? '');
      row[nameIndex] = name;
      const comparable = JSON.stringify(row.map((v,i) => i === nameIndex ? key : i === classIndex ? String(classId) : String(v)));
      if (seen.has(key)) {
        if (seen.get(key) !== comparable) throw new Error(`@${name} için çelişen sınıf veya kayıtlar var; önce kaynak Excel’i düzeltin.`);
        continue;
      }
      seen.set(key, comparable);
      (classId === 3 ? thirdRows : remainingRows).push(row);
    }
    return {thirdRows, remainingRows, thirdUsernames:thirdRows.slice(1).map(row=>row[nameIndex]), remainingUsernames:remainingRows.slice(1).map(row=>row[nameIndex])};
  }
  function readStandardList(rows) {
    const split = splitCollection(rows);
    if (split.thirdUsernames.length) throw new Error('Bu dosyada 3. sınıflar var. Özel davet ekranından oluşturulan standart listeyi seçin.');
    if (!split.remainingUsernames.length) throw new Error('Standart listede işlenecek yayıncı bulunamadı.');
    return split.remainingUsernames;
  }
  function readCollection(rows) {
    const records = table(rows, [['yayinci id','kullanici adi'], ['sinif']]);
    const found = new Map();
    for (const {get} of records) {
      if (!/^(?:3|3\.\s*sınıf|3\.\s*sinif)$/i.test(String(get('sinif')).trim())) continue;
      const name = username(get('yayinci id','kullanici adi'));
      const record = {
        username: name, classId: 3, summary: String(get('kisa degerlendirme')),
        capturedAt: String(get('veri alinma zamani (iso)')), periodStart: String(get('donem baslangici')),
        periodEnd: String(get('donem bitisi')), schema: String(get('veri surumu')),
        followers: numeric(get('takipci')), activeDays: numeric(get('aktif yayin gunu (canli dahil)'), 14),
        sessions: numeric(get('okunan gecmis yayin sayisi'), 10000), hours: numeric(get('gecmis yayin suresi (saat)'), 400),
        meanLikes: numeric(get('gecmis yayin ortalama begeni')), medianLikes: numeric(get('gecmis yayin ortanca begeni')),
        fans: numeric(get('hayran kulubu')), viewers: numeric(get('anlik izleyici'))
      };
      const key = name.toLowerCase(), previous = found.get(key);
      if (previous) {
        const a = JSON.stringify({...previous, username: key}), b = JSON.stringify({...record, username: key});
        if (a !== b) throw new Error(`@${name} için farklı kayıtlar var. Kullanılacak kaydı Excel'de seçin.`);
      } else found.set(key, record);
    }
    return [...found.values()];
  }
  function format(value) {
    if (value >= 1000000) return `${Number((value / 1000000).toPrecision(2)).toLocaleString('tr-TR')} milyon`;
    if (value >= 1000) return `${(value >= 10000 ? Math.round(value / 1000) : Math.round(value / 100) / 10).toLocaleString('tr-TR')} bin`;
    return (value < 100 ? Math.round(value) : Math.round(value / 10) * 10).toLocaleString('tr-TR');
  }
  const localDay = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function draft(record, now = new Date()) {
    const result = {...record, observation: '', message: '', status: ''};
    const captured = Date.parse(record.capturedAt), age = now.getTime() - captured;
    const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
    const recovered = record.schema === '2';
    const missing = [];
    if (!record.schema) missing.push('Veri Sürümü');
    if (!record.capturedAt) missing.push('Veri Alınma Zamanı');
    if (!recovered && !record.periodStart) missing.push('Dönem Başlangıcı');
    if (!recovered && !record.periodEnd) missing.push('Dönem Bitişi');
    if (missing.length) {
      result.status = `Excel’de eksik alanlar: ${missing.join(', ')}. “Son toplama kaydından kurtar” düğmesini deneyin.`; return result;
    }
    if (!['1','2'].includes(record.schema) || !Number.isFinite(captured) || (!recovered && (!validDay(record.periodStart) || !validDay(record.periodEnd) || Date.parse(record.periodEnd) - Date.parse(record.periodStart) !== 13 * 86400000))) {
      result.status = 'Kayıt tarihi, 14 günlük dönem veya veri sürümü geçersiz. Kaynak toplama kaydını kontrol edin.'; return result;
    }
    if (age < -300000 || age > 14 * 86400000 || (!recovered && Math.abs(Date.parse(record.periodEnd) - captured) > 2 * 86400000)) {
      result.status = 'Veri tarihi eski veya tutarsız — yeniden toplama gerekiyor'; return result;
    }
    const observations = [];
    const current = localDay(new Date(captured)) === localDay(now) && (recovered || record.periodEnd === localDay(now));
    const regular = Number.isInteger(record.activeDays) && record.activeDays >= 6;
    if (regular) {
      const comment = record.activeDays >= 10 ? 'Oldukça düzenli ilerlediğinizi görüyorum.' : 'Yayınlara düzenli zaman ayırmanız dikkatimi çekti.';
      if (record.activeDays >= 14) {
        observations.push(`Son iki haftanın her günü yayın açmışsınız. ${comment}`);
      } else {
        const opening = current ? 'Son iki haftada bugünkü yayınınızla birlikte' : 'Yayınlarınıza baktığımda, iki haftalık bir dönemde';
        observations.push(`${opening} en az ${record.activeDays} farklı gün yayın açmışsınız. ${comment}`);
      }
    }
    if (!recovered && Number.isInteger(record.sessions) && record.sessions > 0 && record.meanLikes >= 1000) {
      observations.push(`${regular ? 'Üstelik bu süreçte incelediğim' : 'İncelediğim'} yayınlarınızdaki ortalama beğeni sayısı ${format(record.meanLikes)} civarında.${regular ? ' Yani düzenli yayın açmanın yanında izleyiciden de güzel bir karşılık alıyorsunuz.' : ' İzleyiciden gelen bu ilgi dikkatimi çekti.'}`);
    } else if (recovered && record.medianLikes >= 1000) {
      // Describe the typical level naturally; never call a median an average.
      observations.push(`${regular ? 'Üstelik bu süreçte yayınlarınızda' : 'İncelediğim yayınlarınızda'} ${format(record.medianLikes)} civarında bir beğeni seviyesi yakalamışsınız.${regular ? ' Yani düzenli yayın açmanın yanında izleyiciden de güzel bir karşılık alıyorsunuz.' : ' İzleyiciden gelen bu ilgi dikkatimi çekti.'}`);
    }
    if (!observations.length && record.followers >= 30000) {
      observations.push(`Profilinize baktığımda ${format(record.followers)} civarında takipçiniz olduğunu gördüm. Böyle bir kitle oluşturmanız dikkatimi çekti; canlı yayın tarafında da size destek olmak isteriz.`);
    }
    if (!observations.length && record.fans >= 25) observations.push(`Profilinizde ${format(record.fans)} kişi civarında bir hayran kulübünüz olduğunu gördüm. Yayınlarınıza ilgi gösteren bu topluluğu büyütürken size destek olmak isteriz.`);
    if (!observations.length) { result.status = 'Kişiselleştirme için yeterli ölçüm yok'; return result; }
    result.observation = observations.slice(0, 2).join(' ');
    result.status = record.activeDays === null ? 'Hazır — yayın düzeni verisi eksik' : 'Hazır';
    if (recovered) result.status += ' — eski yerel ölçüm kaydından kurtarıldı';
    result.message = [
      'Selamlar 👋 Ben Burak, BTG Teknoloji’de içerik operasyon uzmanı olarak çalışıyorum. TikTok LIVE’ın resmi ajans programı kapsamında faaliyet gösteren bir canlı yayın ajansıyız.',
      result.observation,
      'Verdiğiniz emek açık bir şekilde ortada. Eğer siz de isterseniz bu süreçte beraber çalışmak isterim. Yayıncılarımızla sürekli karşılıklı iletişimde kalarak yayın performansı, gelir optimizasyonu, hesap ve kısıtlama süreçleri ile teknik konularda destek sağlıyoruz. Ajanstaki yayıncıların verilerine detaylı erişebildiğimiz için her hafta kapsamlı bir geribildirim de veriyoruz.',
      'Ajans desteğimiz yayıncılar için tamamen ücretsizdir. Sizden herhangi bir ödeme talep etmiyoruz.',
      'Dilerseniz nasıl çalıştığımızı ve desteklerimizi kısaca anlatabilirim 😊'
    ].join('\n\n');
    return result;
  }
  function readMessages(rows) {
    // "Bilgilendirme Mesajı" sütunu ajansın mevcut yayıncılarına gider; davet
    // uygunluğu ve eski sohbet engel sayılmaz. İki tür aynı dosyada karışmaz.
    const header = rows.find(row => row.some(cell => ['davet mesaji','bilgilendirme mesaji'].includes(normalize(cell)))) || [];
    const labels = header.map(normalize);
    if (labels.includes('davet mesaji') && labels.includes('bilgilendirme mesaji')) {
      throw new Error('Davet Mesajı ve Bilgilendirme Mesajı aynı dosyada kullanılamaz.');
    }
    const existingCreators = labels.includes('bilgilendirme mesaji');
    const column = existingCreators ? 'bilgilendirme mesaji' : 'davet mesaji';
    const records = table(rows, [['yayinci id','kullanici adi'], ['davet mesaji','bilgilendirme mesaji']]);
    const messages = Object.create(null), names = [], seen = new Map();
    let skipped = 0;
    for (const {get} of records) {
      const name = username(get('yayinci id','kullanici adi')), key = name.toLowerCase();
      const message = String(get(column)).replace(/\r\n?/g, '\n').trim();
      if (seen.has(key)) {
        if (seen.get(key) !== message) throw new Error(`@${name} için farklı davet mesajları var.`);
        continue;
      }
      seen.set(key, message);
      if (!message) { skipped++; continue; }
      if (message.length > 5000) throw new Error(`@${name} mesajı 5.000 karakteri aşıyor.`);
      names.push(name); messages[key] = message;
    }
    if (!names.length) throw new Error(`Dosyada gönderime hazır ${existingCreators ? 'bilgilendirme' : 'davet'} mesajı bulunamadı.`);
    return {usernames: names, messages, skipped, existingCreators};
  }
  const api = {readCollection, draft, readMessages, splitCollection, readStandardList};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.BTGInvitations = api;
})();
