const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class XmlNode {
  constructor(name, attrs = {}) {
    this.name = name;
    this.localName = name.split(":").pop();
    this.attrs = attrs;
    this.children = [];
    this.directText = "";
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }

  getAttributeNS(_namespace, localName) {
    const pair = Object.entries(this.attrs).find(([name]) => name.split(":").pop() === localName);
    return pair ? pair[1] : null;
  }

  get textContent() {
    return this.directText + this.children.map((child) => child.textContent).join("");
  }

  getElementsByTagNameNS(_namespace, localName) {
    const output = [];
    walk(this, (node) => {
      if (node !== this && node.localName === localName) output.push(node);
    });
    return output;
  }

  getElementsByTagName(name) {
    const output = [];
    walk(this, (node) => {
      if (node !== this && (node.name === name || node.localName === name)) output.push(node);
    });
    return output;
  }
}

class SimpleDOMParser {
  parseFromString(text) {
    const root = new XmlNode("#document");
    const stack = [root];
    const tokenPattern = /<[^>]+>|[^<]+/g;
    for (const token of text.match(tokenPattern) || []) {
      if (token.startsWith("<?") || token.startsWith("<!")) continue;
      if (token.startsWith("</")) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (token.startsWith("<")) {
        const selfClosing = token.endsWith("/>");
        const content = token.slice(1, selfClosing ? -2 : -1).trim();
        const nameMatch = content.match(/^([^\s]+)/);
        if (!nameMatch) continue;
        const attrs = {};
        for (const match of content.matchAll(/([^\s=]+)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2]);
        const node = new XmlNode(nameMatch[1], attrs);
        stack.at(-1).children.push(node);
        if (!selfClosing) stack.push(node);
      } else {
        stack.at(-1).directText += decodeXml(token);
      }
    }
    return root;
  }
}

function walk(node, callback) {
  callback(node);
  for (const child of node.children) walk(child, callback);
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const context = {
  window: {},
  File,
  Blob,
  Response,
  DecompressionStream,
  TextDecoder,
  Uint8Array,
  DataView,
  DOMParser: SimpleDOMParser,
  URL,
  console
};
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, "..", "src/core/xlsx-reader.js"), "utf8");
vm.runInContext(source, context);

(async () => {
  const reader = context.window.BTGSpreadsheetReader;
  assert.ok(reader);
  assert.deepEqual(
    Array.from(reader.extractUsernames([
      "Kullanıcı Adı",
      "@ornek.bir",
      "@ORNEK.BIR",
      "https://www.tiktok.com/@ikinci_kisi",
      "ucuncu.kisi"
    ])),
    ["ornek.bir", "ikinci_kisi", "ucuncu.kisi"]
  );

  assert.deepEqual(
    Array.from(reader.extractUsernames([
      ["Lig", "Sıra", "Profil İsmi", "Kullanıcı Adı", "Jeton", "OCR Güveni"],
      ["D5", 1, "Mahmut Mustafa", "mahmut.mustafa42", 4800, 0.999],
      ["D5", 2, "yagiz", "Bildir", 4300, 1],
      ["D5", 17, "DEIKUUU", "", 17, 0.883],
      ["D5", 20, "SMEYYARDIL", "m__x__8", 2900, 0.976]
    ])),
    ["mahmut.mustafa42", "Bildir", "m__x__8"]
  );

  const samplePath = path.join(__dirname, "sample-usernames.xlsx");
  const file = new File([fs.readFileSync(samplePath)], "sample-usernames.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const usernames = await reader.readUsernamesFromFile(file);
  assert.deepEqual(Array.from(usernames), ["ornek.bir", "ornek_iki", "ucuncu"]);

  context.TextEncoder = TextEncoder;
  const writerSource = fs.readFileSync(path.join(__dirname, '..', 'src/core/xlsx-writer.js'), 'utf8');
  vm.runInContext(writerSource.replace('window.BTGXlsxWriter = {', 'window.BTGXlsxWriter = { createZip, workbookEntries,'), context);
  const writer=context.window.BTGXlsxWriter;
  const core=require('../src/core/team-plan-core');
  const first=[{username:'ornek_bir',classId:3,summary:'Güçlü & düzenli.'},{username:'ornek_iki',classId:1,summary:'Yeni.'}];
  const second=[{username:'ORNEK_BIR',classId:2,summary:'Eski.'},{username:'ornek_uc',classId:2,summary:'Gelişiyor.'}];
  const bytesA=writer.buildNameCollectionWorkbook(first), bytesB=writer.buildNameCollectionWorkbook(second);
  const imported=core.mergeRecords([
    ...core.parseRows(await reader.readXlsxRows(bytesA.buffer,true)),
    ...core.parseRows(await reader.readXlsxRows(bytesB.buffer,true))
  ]);
  assert.equal(imported.rows.length,3);
  assert.equal(imported.duplicates,1);
  const team=core.distribute(imported.rows,[{name:'Ece',priority:true},{name:'Ali'}]);
  const exported=writer.buildTeamPlanWorkbook(team.rows);
  const roundtrip=await reader.readXlsxRows(exported.buffer,true);
  assert.deepEqual(Array.from(roundtrip[0]),['Takım Üyesi','Yayıncı ID','Sınıf','Kısa Değerlendirme','Rapor']);
  assert.equal(roundtrip.length,4);
  assert.ok(roundtrip.some(row=>row[3]==='Güçlü & düzenli.'));
  const exhaustedBook=writer.buildTeamPlanWorkbook([], [{member:'Tüm Ekip Denedi',username:'eski_yayinci',classId:3,summary:'Güçlü.',report:'Tüm ekip yazdı / hâlâ müsait'}]);
  const exhaustedRows=await reader.readXlsxRows(exhaustedBook.buffer,true);
  assert.ok(exhaustedRows.some(row=>row[4]==='Tüm ekip yazdı / hâlâ müsait'));
  assert.equal((await reader.readXlsxRows(exhaustedBook.buffer)).length,1);
  const multi=writer.workbookEntries(first,true);
  multi.find(e=>e.name==='xl/workbook.xml').content=multi.find(e=>e.name==='xl/workbook.xml').content.replace('</sheets>','<sheet name="İkinci" sheetId="2" r:id="rId3"/></sheets>');
  const rel=multi.find(e=>e.name==='xl/_rels/workbook.xml.rels');
  rel.content=rel.content.replace('</Relationships>','<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
  multi.push({name:'xl/worksheets/sheet2.xml',content:writer.workbookEntries(second,true).find(e=>e.name==='xl/worksheets/sheet1.xml').content});
  const multiBytes=writer.createZip(multi);
  assert.equal((await reader.readXlsxRows(multiBytes.buffer)).length,3);
  assert.equal((await reader.readXlsxRows(multiBytes.buffer,true)).length,6);


  // Feedback output: actual zipped worksheet roundtrip, strict single-sheet/formula checks.
  const P=require('../src/core/feedback-package');
  const feedbackEntries=writer.workbookEntries([],true);
  const xmlEscape=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const feedbackData=[P.headers,['pkg:1','kai35.5','2026-09-08','2026-09-14','Merhaba Kai, takip hatırlatmasını deneyebilirsin. 🙂','Takip hatırlatması','']];
  const sheet=feedbackEntries.find(e=>e.name==='xl/worksheets/sheet1.xml');
  sheet.content='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+feedbackData.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>'<c r="'+String.fromCharCode(65+j)+(i+1)+'" t="inlineStr"><is><t>'+xmlEscape(v)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';
  const feedbackBytes=writer.createZip(feedbackEntries);
  const feedbackRows=await reader.readXlsxRows(feedbackBytes.buffer,false,{strictFeedback:true});
  const feedbackObjects=P.objectsFromRows(Array.from(feedbackRows,r=>Array.from(r)));
  assert.equal(feedbackObjects[0].message,feedbackData[1][4]);
  assert.equal(feedbackObjects[0].from,'2026-09-08');
  sheet.content=sheet.content.replace('<is><t>pkg:1</t></is>','<f>1+1</f><v>2</v>');
  await assert.rejects(reader.readXlsxRows(writer.createZip(feedbackEntries).buffer,false,{strictFeedback:true}),/formül/);
  await assert.rejects(reader.readXlsxRows(multiBytes.buffer,false,{strictFeedback:true}),/tek çalışma/);

  if (process.env.BTG_TEST_LEAGUE_XLSX) {
    const leagueFile = new File(
      [fs.readFileSync(process.env.BTG_TEST_LEAGUE_XLSX)],
      path.basename(process.env.BTG_TEST_LEAGUE_XLSX),
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
    const leagueUsernames = await reader.readUsernamesFromFile(leagueFile);
    assert.deepEqual(Array.from(leagueUsernames), [
      "mahmut.mustafa42",
      "Bildir",
      "x.atillaozcfc",
      "ismailyilmaz4",
      "Prens",
      "m__x__8",
      "diyarkmk.56",
      "kaotik258",
      "ahmetatasss",
      "emin.karagn1",
      "tulay_tulayy",
      "mokars",
      "mmiracylmz1",
      "user64300067780",
      "Kesfet"
    ]);
  }

  console.log("Excel/CSV kullanıcı adı okuyucu testleri geçti.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
