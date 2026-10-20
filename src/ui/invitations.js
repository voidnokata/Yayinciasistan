(() => {
  const file = document.getElementById('file'), status = document.getElementById('status');
  const error = document.getElementById('error'), save = document.getElementById('save');
  const result = document.getElementById('result'), preview = document.getElementById('preview');
  const recover = document.getElementById('recover');
  let drafts = [], loadedRecords = null, sourceSplit = null, exportJob = null;
  file.addEventListener('change', async () => {
    drafts = []; loadedRecords = null; sourceSplit = null; exportJob = null; save.disabled = true; result.hidden = true; preview.replaceChildren(); error.textContent = '';
    const selected = file.files?.[0]; if (!selected) return;
    file.disabled = true; recover.disabled = true; status.textContent = 'Excel okunuyor ve davetler hazırlanıyor…';
    try {
      if (!/\.xlsx$/i.test(selected.name)) throw new Error('İsim Toplama .xlsx dosyasını seçin.');
      const rows = await window.BTGSpreadsheetReader.readXlsxRows(await selected.arrayBuffer());
      const split = window.BTGInvitations.splitCollection(rows);
      loadedRecords = window.BTGInvitations.readCollection(rows);
      if (!split.thirdUsernames.length && !split.remainingUsernames.length) throw new Error('Bu dosyada yayıncı bulunamadı.');
      sourceSplit = split;
      renderRecords(loadedRecords);
    } catch (e) { error.textContent = e.message; status.textContent = 'Davet hazırlanamadı.'; }
    finally { file.disabled = false; recover.disabled = false; }
  });
  recover.addEventListener('click', async () => {
    file.disabled = true; recover.disabled = true; save.disabled = true; error.textContent = '';
    try {
      if (file.files?.length && !sourceSplit) throw new Error('Önce geçerli bir İsim Toplama Excel’i seçin.');
      const stored = await chrome.storage.local.get('runtime');
      if (stored.runtime?.running) throw new Error('Önce devam eden otomasyonu durdurun; sonra toplama kaydını kurtarın.');
      const collection = stored.runtime?.collectionRows;
      if (!Array.isArray(collection) || !collection.length) throw new Error('Eklentide son toplama kaydı bulunamadı. Excel’de de ölçümler boş olduğundan yeni bir İsim Toplama çalıştırmak gerekiyor.');
      const bytes = window.BTGXlsxWriter.buildNameCollectionWorkbook(collection);
      const recoveredRows = await window.BTGSpreadsheetReader.readXlsxRows(bytes.buffer);
      const recoveredSplit = window.BTGInvitations.splitCollection(recoveredRows);
      const recovered = window.BTGInvitations.readCollection(recoveredRows);
      const byName = new Map(recovered.map(row => [row.username.toLowerCase(), row]));
      const records = loadedRecords ? loadedRecords.map(row => byName.get(row.username.toLowerCase()) || row) : recovered;
      if (!records.length) throw new Error('Son toplama kaydında 3. sınıf yayıncı bulunamadı.');
      if (!records.some(row => window.BTGInvitations.draft(row).message)) throw new Error('Eşleşen kayıtlarda kullanılabilir tarih ve ölçüm bulunamadı. Yeni İsim Toplama gerekiyor; eklentiyi yeniden yükleyip canlı sekmesini yenileyin.');
      if (!sourceSplit) { sourceSplit = recoveredSplit; loadedRecords = records; }
      renderRecords(records);
      status.textContent += ' Son yerel toplama kaydı kullanıldı; profillere yeniden gidilmedi.';
    } catch (e) { error.textContent = e.message; }
    finally { file.disabled = false; recover.disabled = false; save.disabled = !sourceSplit; }
  });
  function renderRecords(records) {
      exportJob = null;
      drafts = records.map(row => window.BTGInvitations.draft(row));
      preview.replaceChildren();
      for (const draft of drafts) {
        const card = document.createElement('article'); card.className = 'invitation';
        const title = document.createElement('h3'); title.textContent = `@${draft.username}`;
        const detail = document.createElement('p'); detail.textContent = `${draft.status}\n${draft.observation || 'Davet hazırlanamadı.'}`;
        card.append(title, detail);
        if (draft.message) {
          const field = document.createElement('textarea'); field.value = draft.message; field.maxLength = 5000;
          field.setAttribute('aria-label', `@${draft.username} davet mesajı`);
          field.addEventListener('input', () => {draft.message = field.value; exportJob = null; updateStatus();}); card.append(field);
        }
        preview.append(card);
      }
      result.hidden = false; updateStatus();
  }
  function updateStatus() {
    const ready = drafts.filter(d => d.message.trim()).length;
    status.textContent = `${drafts.length} üçüncü sınıf yayıncı: ${ready} mesaj hazır, ${drafts.length - ready} satır gönderime alınmayacak. Standart liste: ${sourceSplit?.remainingUsernames.length || 0} kişi. İki listede ortak kullanıcı bulunmaz.`;
    save.disabled = !sourceSplit;
  }
  save.addEventListener('click', async () => {
    save.disabled = true; file.disabled = true; recover.disabled = true; error.textContent = '';
    try {
      if (!sourceSplit) throw new Error('Önce bir İsim Toplama listesi seçin.');
      if (!exportJob) exportJob = window.BTGXlsxWriter.createInvitationExport(drafts,sourceSplit.remainingRows);
      const names = await window.BTGXlsxWriter.saveInvitationExport(exportJob);
      status.textContent = `İki Excel kaydedildi: ${names.join(' ve ')}. İşlemlerde bu iki yeni dosyayı kullanın; orijinal karma listeyi tekrar yüklemeyin.`;
    } catch (e) { error.textContent = e.message; }
    finally { file.disabled = false; recover.disabled = false; save.disabled = !sourceSplit; }
  });
})();
