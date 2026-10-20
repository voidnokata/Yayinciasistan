(() => {
  const encoder = new TextEncoder();

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function columnName(index) {
    let value = index;
    let output = "";
    while (value > 0) {
      value -= 1;
      output = String.fromCharCode(65 + (value % 26)) + output;
      value = Math.floor(value / 26);
    }
    return output;
  }

  function inlineCell(reference, value, style = 0) {
    const styleAttribute = style ? ` s="${style}"` : "";
    return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }

  function numberCell(reference, value, style = 0) {
    return `<c r="${reference}"${style ? ` s="${style}"` : ''}><v>${Number(value) || 0}</v></c>`;
  }

  function formatDate(value) {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("tr-TR");
  }

  function worksheetXml(rows) {
    const headers = ["Sıra", "Kullanıcı Adı", "Backstage Sonucu", "İşlem Sonucu", "Açıklama", "Kontrol Zamanı"];
    const sheetRows = [];
    sheetRows.push(
      `<row r="1" ht="24" customHeight="1">${headers
        .map((header, index) => inlineCell(`${columnName(index + 1)}1`, header, 1))
        .join("")}</row>`
    );
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const values = [
        Number(row.order || index + 1),
        row.username ? `@${String(row.username).replace(/^@/, "")}` : "",
        row.backstageResult || "",
        row.outcome || "",
        row.detail || "",
        formatDate(row.checkedAt)
      ];
      const cells = values.map((value, columnIndex) => {
        const reference = `${columnName(columnIndex + 1)}${rowNumber}`;
        return columnIndex === 0
          ? numberCell(reference, value)
          : inlineCell(reference, value);
      });
      sheetRows.push(`<row r="${rowNumber}">${cells.join("")}</row>`);
    });
    const lastRow = Math.max(1, rows.length + 1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="24" customWidth="1"/>
    <col min="3" max="3" width="42" customWidth="1"/>
    <col min="4" max="4" width="28" customWidth="1"/>
    <col min="5" max="5" width="55" customWidth="1"/>
    <col min="6" max="6" width="23" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows.join("")}</sheetData>
  <autoFilter ref="A1:F${lastRow}"/>
</worksheet>`;
  }

  const snapshotHeaders = ['Veri Alınma Zamanı (ISO)', 'Dönem Başlangıcı', 'Dönem Bitişi', 'Saat Dilimi', 'Takipçi', 'Aktif Yayın Günü (Canlı Dahil)', 'Okunan Geçmiş Yayın Sayısı', 'Geçmiş Yayın Süresi (Saat)', 'Geçmiş Yayın Ortalama Beğeni', 'Geçmiş Yayın Ortanca Beğeni', 'Hayran Kulübü', 'Anlık İzleyici', 'Kaynak', 'Veri Durumu', 'Geçmiş Yayın Kayıtları (JSON)', 'Veri Sürümü'];
  function snapshotCells(row, n) {
    const m = row?.assessment?.metrics || {};
    let s = row?.assessment?.snapshot || {};
    // Older collections retained measurements and checkedAt in local storage,
    // even though their Excel export only kept three columns. Do not invent
    // a session count, mean likes or an exact calendar period during recovery.
    if (!s.schema && row?.assessment?.metrics && typeof row?.checkedAt === 'string' && Number.isFinite(Date.parse(row.checkedAt))) {
      s = {schema:2,capturedAt:row.checkedAt,source:'Önceki İsim Toplama ölçüm kaydı',
        historyKnown:Number.isFinite(m.activeDays),coverageNote:'Ölçümler eski yerel kayıttan kurtarıldı. Ortalama beğeni, yayın sayısı ve tek tek yayın kayıtları bu sürümde kaydedilmemişti.'};
    }
    const values = [s.capturedAt || '', s.periodStart || '', s.periodEnd || '', s.timezone || '',
      m.followers ?? row?.followerCount ?? null, m.activeDays, s.sessionCount, m.hours, s.meanLikes, m.medianLikes, m.fans, m.viewers,
      s.source || '', s.schema ? `${s.historyKnown ? 'Geçmiş okundu' : 'Geçmiş okunamadı'} — ${s.coverageNote}` : 'Eski kayıt — ayrıntılı veri yok',
      s.sessions ? JSON.stringify(s.sessions) : '', s.schema ?? ''];
    return values.map((v,i) => typeof v === 'number' && Number.isFinite(v) ? numberCell(`${columnName(i+4)}${n}`,v) : inlineCell(`${columnName(i+4)}${n}`,v ?? '')).join('');
  }
  function nameCollectionWorksheetXml(rows) {
    const sheetRows = [
      `<row r="1" ht="24" customHeight="1">${inlineCell("A1", "Yayıncı ID", 1)}${inlineCell("B1", "Sınıf", 1)}${inlineCell("C1", "Kısa Değerlendirme", 1)}${snapshotHeaders.map((h,i)=>inlineCell(`${columnName(i+4)}1`,h,1)).join('')}</row>`
    ];
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const username = String(row?.username || "").replace(/^@/, "");
      sheetRows.push(
        `<row r="${rowNumber}">${inlineCell(`A${rowNumber}`, username)}${[0,1,2,3].includes(row?.classId) ? numberCell(`B${rowNumber}`, row.classId, row.classId === 0 ? 2 : 0) : inlineCell(`B${rowNumber}`, "")}${inlineCell(`C${rowNumber}`, row?.assessment?.summary || row?.summary || "Değerlendirme kaydı yok.")}${snapshotCells(row,rowNumber)}</row>`
      );
    });
    const lastRow = Math.max(1, rows.length + 1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="100" customWidth="1"/><col min="4" max="19" width="28" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows.join("")}</sheetData>
  <autoFilter ref="A1:S${lastRow}"/>
</worksheet>`;
  }

  function workbookEntries(rows, collection = false) {
    const created = new Date().toISOString();
    const workbookTitle = collection ? "BTG İsim Toplama" : "BTG Listeden Kontrol Raporu";
    const sheetName = collection ? "İsimler" : "Kontrol Raporu";
    return [
      {
        name: "[Content_Types].xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
      },
      {
        name: "_rels/.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
      },
      {
        name: "docProps/core.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${workbookTitle}</dc:title><dc:creator>BTG TikTok Yayıncı Asistanı</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
</cp:coreProperties>`
      },
      {
        name: "docProps/app.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>BTG TikTok Yayıncı Asistanı</Application></Properties>`
      },
      {
        name: "xl/workbook.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      },
      {
        name: "xl/styles.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F6F78"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF8B4513"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content: collection ? nameCollectionWorksheetXml(rows) : worksheetXml(rows)
      }
    ];
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function write16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function joinBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    const stamp = dosDateTime();
    let localOffset = 0;

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = encoder.encode(entry.content);
      const checksum = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      write32(localView, 0, 0x04034b50);
      write16(localView, 4, 20);
      write16(localView, 6, 0x0800);
      write16(localView, 8, 0);
      write16(localView, 10, stamp.time);
      write16(localView, 12, stamp.date);
      write32(localView, 14, checksum);
      write32(localView, 18, data.length);
      write32(localView, 22, data.length);
      write16(localView, 26, name.length);
      write16(localView, 28, 0);
      local.set(name, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      write32(centralView, 0, 0x02014b50);
      write16(centralView, 4, 20);
      write16(centralView, 6, 20);
      write16(centralView, 8, 0x0800);
      write16(centralView, 10, 0);
      write16(centralView, 12, stamp.time);
      write16(centralView, 14, stamp.date);
      write32(centralView, 16, checksum);
      write32(centralView, 20, data.length);
      write32(centralView, 24, data.length);
      write16(centralView, 28, name.length);
      write16(centralView, 30, 0);
      write16(centralView, 32, 0);
      write16(centralView, 34, 0);
      write16(centralView, 36, 0);
      write32(centralView, 38, 0);
      write32(centralView, 42, localOffset);
      central.set(name, 46);
      centralParts.push(central);
      localOffset += local.length + data.length;
    }

    const centralDirectory = joinBytes(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054b50);
    write16(endView, 4, 0);
    write16(endView, 6, 0);
    write16(endView, 8, entries.length);
    write16(endView, 10, entries.length);
    write32(endView, 12, centralDirectory.length);
    write32(endView, 16, localOffset);
    write16(endView, 20, 0);
    return joinBytes([...localParts, centralDirectory, end]);
  }

  function buildReportWorkbook(rows) {
    return createZip(workbookEntries(Array.isArray(rows) ? rows : []));
  }

  function buildNameCollectionWorkbook(rows) {
    return createZip(workbookEntries(Array.isArray(rows) ? rows : [], true));
  }

  function teamPlanEntries(rows, options = {}) {
    const league=Boolean(options.league);
    const headers=league?['Takım Üyesi','Yayıncı ID','Jeton','Lig / Sıra / Profil','Rapor']:['Takım Üyesi','Yayıncı ID','Sınıf','Kısa Değerlendirme','Rapor'];
    const data=[`<row r="1">${headers.map((v,i)=>inlineCell(`${columnName(i+1)}1`,v,1)).join('')}</row>`];
    data.push('<row r="2" ht="15" customHeight="1"/><row r="3" ht="15" customHeight="1"/>');
    const groups=new Map(),merges=[];
    for(const r of rows){if(!groups.has(r.member))groups.set(r.member,[]);groups.get(r.member).push(r);}
    let rowIndex=4,groupIndex=0;
    for(const [member,group] of groups){
      if(groupIndex++) {data.push(`<row r="${rowIndex}" ht="15" customHeight="1">${[1,2,3,4,5].map(c=>inlineCell(`${columnName(c)}${rowIndex}`,'',4)).join('')}</row>`);rowIndex++;}
      const start=rowIndex;
      group.sort((a,b)=>league?b.coins-a.coins||a.username.localeCompare(b.username):b.classId-a.classId);
      group.forEach((r,i)=>{
        const n=rowIndex++,classStyle=league?10:({3:5,2:6,1:7,0:9}[r.classId]||2);
        if(league&&(!Number.isSafeInteger(r.coins)||r.coins<0))throw new Error("Geçersiz jeton değeri.");
        data.push(`<row r="${n}" ht="${group.length===1?30:15}" customHeight="1">${inlineCell(`A${n}`,i===0?member:'',3)}${inlineCell(`B${n}`,r.username,2)}<c r="C${n}" s="${classStyle}"><v>${league?r.coins:(Number(r.classId)||0)}</v></c>${inlineCell(`D${n}`,league?[r.league,r.rank?`${r.rank}. sıra`:'',r.displayName].filter(Boolean).join(' · '):r.summary,8)}${inlineCell(`E${n}`,r.report || "",8)}</row>`);
      });
      if(rowIndex-start>1)merges.push(`<mergeCell ref="A${start}:A${rowIndex-1}"/>`);
    }
    const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="2" width="28" customWidth="1"/><col min="3" max="3" width="${league?18:10}" customWidth="1"/><col min="4" max="4" width="${league?50:100}" customWidth="1"/><col min="5" max="5" width="90" customWidth="1"/></cols><sheetData>${data.join('')}</sheetData><autoFilter ref="A1:E${Math.max(1,rowIndex-1)}"/>${merges.length?`<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>`:''}</worksheet>`;
    const fills=['1F6F78','000000','4EA72E','215C98','C00000','8B4513'];
    const xf=(font,fill,align='center')=>`<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center"/></xf>`;
    const styles=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="20"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills.map(c=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11">${xf(0,0,'left')}${xf(1,2)}${xf(0,0)}${xf(2,0)}${xf(0,3)}${xf(3,4)}${xf(3,5)}${xf(3,6)}${xf(0,0,'left')}${xf(3,7)}<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const entries=workbookEntries([],true).map(e=>e.name==='xl/worksheets/sheet1.xml'?{...e,content:sheet}:e.name==='xl/styles.xml'?{...e,content:styles}:{...e,content:e.content.replace(/BTG İsim Toplama/g,'BTG Takım Planı').replace('name="İsimler"','name="Takım Planı"')});
    return entries;
  }

  function buildInvitationWorkbook(rows) {
    const headers = ['Kullanıcı Adı','Davet Mesajı','Sınıf','Kişisel Değerlendirme','Veri Durumu','Veri Alınma Zamanı (ISO)','Dönem Başlangıcı','Dönem Bitişi'];
    const sheetRows = [`<row r="1" ht="30" customHeight="1">${headers.map((h,i)=>inlineCell(`${columnName(i+1)}1`,h,1)).join('')}</row>`];
    rows.forEach((r,i)=>{
      const n=i+2;
      const values=[r.username,r.message,3,r.observation,r.message?.trim() ? r.status : 'Mesaj yok — gönderime alınmaz',r.capturedAt,r.periodStart,r.periodEnd];
      sheetRows.push(`<row r="${n}" ht="330" customHeight="1">${values.map((v,c)=>inlineCell(`${columnName(c+1)}${n}`,v,3)).join('')}</row>`);
    });
    const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="25" customWidth="1"/><col min="2" max="2" width="105" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/><col min="4" max="5" width="45" customWidth="1"/><col min="6" max="8" width="26" customWidth="1"/></cols><sheetData>${sheetRows.join('')}</sheetData><autoFilter ref="A1:H${rows.length+1}"/></worksheet>`;
    const entries=workbookEntries([],true).map(e=>{
      if(e.name==='xl/worksheets/sheet1.xml') return {...e,content:sheet};
      if(e.name==='xl/styles.xml') return {...e,content:e.content.replace('cellXfs count="3"','cellXfs count="4"').replace('</cellXfs>','<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>')};
      return {...e,content:e.content.replace(/BTG İsim Toplama/g,'BTG Özel Davetler').replace('name="İsimler"','name="Özel Davetler"')};
    });
    return createZip(entries);
  }

  function downloadInvitations(rows) {
    return saveOutput(`btg-ozel-davetler-${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`,buildInvitationWorkbook(rows));
  }

  function buildStandardListWorkbook(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Standart listenin sütun başlıkları bulunamadı.');
    const columnCount = Math.max(1, ...rows.map(row=>row.length));
    const sheetRows = rows.map((row,i)=>`<row r="${i+1}"${i===0?' ht="30" customHeight="1"':''}>${Array.from({length:columnCount},(_,j)=>inlineCell(`${columnName(j+1)}${i+1}`,row[j] ?? '',i===0?1:0)).join('')}</row>`);
    const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${columnCount}" width="28" customWidth="1"/></cols><sheetData>${sheetRows.join('')}</sheetData><autoFilter ref="A1:${columnName(columnCount)}${rows.length}"/></worksheet>`;
    return createZip(workbookEntries([],true).map(e=> e.name==='xl/worksheets/sheet1.xml' ? {...e,content:sheet} : {...e,content:e.content.replace(/BTG İsim Toplama/g,'BTG Standart Liste').replace('name="İsimler"','name="Standart Liste"')}));
  }
  function createInvitationExport(drafts, remainingRows) {
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    return [
      {name:`btg-3-sinif-ozel-davetler-${stamp}.xlsx`,bytes:buildInvitationWorkbook(drafts)},
      {name:`btg-standart-liste-3-sinif-haric-${stamp}.xlsx`,bytes:buildStandardListWorkbook(remainingRows)}
    ];
  }
  async function saveInvitationExport(job) {
    for (const item of job) {
      if (item.saved) continue;
      try { item.saved = await saveOutput(item.name,item.bytes); }
      catch (error) {
        const completed = job.filter(entry=>entry.saved).map(entry=>entry.saved.name || entry.name);
        throw new Error(`${completed.length ? `Kaydedilen: ${completed.join(', ')}. ` : ''}${item.name} kaydedilemedi: ${error.message}. Aynı düğmeye tekrar basınca yalnız eksik çıktı kaydedilir.`);
      }
    }
    return job.map(item=>item.saved.name || item.name);
  }

  function buildTeamPlanWorkbook(rows, exhausted = [], options = {}) {
    const entries=teamPlanEntries(rows,options);
    if(exhausted.length){
      const extra=teamPlanEntries(exhausted,options).find(e=>e.name==='xl/worksheets/sheet1.xml');
      entries.push({name:'xl/worksheets/sheet2.xml',content:extra.content});
      const workbook=entries.find(e=>e.name==='xl/workbook.xml');
      workbook.content=workbook.content.replace('</sheets>','<sheet name="Tüm Ekip Denedi" sheetId="2" r:id="rId3"/></sheets>');
      const rel=entries.find(e=>e.name==='xl/_rels/workbook.xml.rels');
      rel.content=rel.content.replace('</Relationships>','<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
      const types=entries.find(e=>e.name==='[Content_Types].xml');
      types.content=types.content.replace('</Types>','<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    }
    return createZip(entries);
  }

  async function saveOutput(name, bytes) {
    if(window.BTGOutput) return window.BTGOutput.save(name,new Blob([bytes]));
    const result=await chrome.runtime.sendMessage({type:'BTG_SAVE_OUTPUT',name,bytes:Array.from(bytes)});
    if(!result?.ok)throw new Error(result?.error || 'Çıktı klasöre kaydedilemedi.');
    return result;
  }

  function downloadTeamPlan(rows, exhausted = [], options = {}) {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
    const month=parts.month.charAt(0).toLocaleUpperCase('tr-TR')+parts.month.slice(1);
    return saveOutput(`Takım_Planı_${options.league?"Lig_":""}${month}_${parts.day}_${parts.hour}-${parts.minute}.xlsx`,buildTeamPlanWorkbook(rows, exhausted, options));
  }

  function downloadReport(rows) {
    const bytes = buildReportWorkbook(rows);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return saveOutput(`btg-listeden-kontrol-${stamp}.xlsx`,bytes);
  }

  function downloadNameCollection(rows) {
    const bytes = buildNameCollectionWorkbook(rows);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const parts = Object.fromEntries(new Intl.DateTimeFormat('tr-TR', {timeZone:'Europe/Istanbul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
    const month = parts.month.charAt(0).toLocaleUpperCase('tr-TR') + parts.month.slice(1);
    const stamp = `${month}_${parts.day}_${parts.hour}-${parts.minute}`;
    return saveOutput(`${stamp}.xlsx`,bytes);
  }

  window.BTGXlsxWriter = {
    buildStandardListWorkbook,
    createInvitationExport,
    saveInvitationExport,
    collectionDataVersion: 1,
    buildInvitationWorkbook,
    downloadInvitations,
    buildTeamPlanWorkbook,
    downloadTeamPlan,
    buildReportWorkbook,
    buildNameCollectionWorkbook,
    downloadReport,
    downloadNameCollection
  };
})();
