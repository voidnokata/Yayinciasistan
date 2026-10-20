const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/core/xlsx-writer.js"), "utf8");
const context = {
  window: {},
  TextEncoder,
  Uint8Array,
  DataView,
  Date,
  Blob,
  URL,
  console
};
vm.runInNewContext(source, context);

const rows = [
  {
    order: 1,
    username: "resool0728",
    backstageResult: "Uygun değil — başka ajansta",
    outcome: "DM gönderilmedi",
    detail: "Backstage sonucu uygun değil",
    checkedAt: "2026-08-07T10:00:00.000Z"
  },
  {
    order: 2,
    username: "miar_mobel",
    backstageResult: "Mevcut",
    outcome: "DM gönderildi",
    detail: "Mesaj gönderimi doğrulandı",
    checkedAt: "2026-08-07T10:01:00.000Z"
  }
];

const bytes = context.window.BTGXlsxWriter.buildReportWorkbook(rows);
assert.ok(bytes instanceof Uint8Array);
assert.equal(bytes[0], 0x50);
assert.equal(bytes[1], 0x4b);
const archiveText = Buffer.from(bytes).toString("utf8");
assert.match(archiveText, /\[Content_Types\]\.xml/);
assert.match(archiveText, /xl\/worksheets\/sheet1\.xml/);
assert.match(archiveText, /Kontrol Raporu/);
assert.match(archiveText, /resool0728/);
assert.match(archiveText, /Uygun değil — başka ajansta/);
assert.match(archiveText, /DM gönderildi/);

const collectionBytes = context.window.BTGXlsxWriter.buildNameCollectionWorkbook([
  { username: "yayinci_01", classId: 3, assessment: {summary: "Yüksek takipçi sayısı, ancak seyrek yayın."} },
  { username: "@yayinci_02", classId: 1, summary: "Düşük takipçi sayısı ve seyrek yayın." }
]);
assert.ok(collectionBytes instanceof Uint8Array);
const collectionArchiveText = Buffer.from(collectionBytes).toString("utf8");
assert.match(collectionArchiveText, /BTG İsim Toplama/);
assert.match(collectionArchiveText, /Yayıncı ID/);
assert.match(collectionArchiveText, /Sınıf/);
assert.match(collectionArchiveText, /Takipçi/);
assert.match(collectionArchiveText, /yayinci_01/);
assert.match(collectionArchiveText, /<v>3<\/v>/);
assert.match(collectionArchiveText, /Kısa Değerlendirme/);
assert.match(collectionArchiveText, /Yüksek takipçi sayısı, ancak seyrek yayın\./);
assert.match(collectionArchiveText, /Düşük takipçi sayısı ve seyrek yayın\./);
assert.match(collectionArchiveText, /Veri Alınma Zamanı/);
assert.match(collectionArchiveText, /autoFilter ref="A1:S3"/);
assert.doesNotMatch(collectionArchiveText, /Backstage Sonucu/);

const styledTeam = Buffer.from(context.window.BTGXlsxWriter.buildTeamPlanWorkbook([
  {member:'Yağız',username:'ornek_1',classId:1,summary:'Düşük takipçi.'},
  {member:'Yağız',username:'ornek_3',classId:3,summary:'Düzenli.'},
  {member:'Emrina',username:'ornek_2',classId:2,summary:'Gelişiyor.'}
])).toString('utf8');
assert.match(styledTeam, /mergeCell ref="A4:A5"/);
assert.match(styledTeam, /r="A6" t="inlineStr" s="4"/);
assert.match(styledTeam, /r="C4" s="5"><v>3/);
assert.match(styledTeam, /r="C5" s="7"><v>1/);
assert.match(styledTeam, /r="C7" s="6"><v>2/);
for(const color of ['FF1F6F78','FF000000','FF4EA72E','FF215C98','FFC00000'])assert.ok(styledTeam.includes(color));
assert.match(styledTeam, /sz val="20"/);
assert.match(styledTeam, /autoFilter ref="A1:E7"/);
const zeroBook=Buffer.from(context.window.BTGXlsxWriter.buildTeamPlanWorkbook([{member:'Ece',username:'yeni',classId:0,summary:'Yeni.'}])).toString('utf8');
assert.match(zeroBook,/r="C4" s="9"><v>0/);
assert.match(zeroBook,/FF8B4513/);
const zeroCollection=Buffer.from(context.window.BTGXlsxWriter.buildNameCollectionWorkbook([{username:'yeni',classId:0}])).toString('utf8');
assert.match(zeroCollection,/r="B2" s="2"><v>0/);
assert.match(zeroCollection,/FF8B4513/);

// Both download paths use this writer; verify the requested local filename.
let downloaded = '';
context.window.BTGOutput={save:(name)=>{downloaded=name;return Promise.resolve({ok:true});}};
context.Date = class extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-07T12:13:00Z'])); }
};
context.URL = {createObjectURL:()=> 'blob:test', revokeObjectURL:()=>{}};
context.document = {body:{append(){}}, createElement:()=>({
  click(){ downloaded=this.download; }, remove(){}
})};
context.window.BTGXlsxWriter.downloadNameCollection([{username:'test',classId:2}]);
assert.equal(downloaded,'Eylül_7_15-13.xlsx');

if (process.env.BTG_XLSX_TEST_OUTPUT) {
  fs.writeFileSync(process.env.BTG_XLSX_TEST_OUTPUT, Buffer.from(bytes));
}

console.log("Gerçek XLSX paket yapısı ve rapor satırları testi geçti.");
