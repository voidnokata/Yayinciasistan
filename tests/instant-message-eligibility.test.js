const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let api;
class Element { getBoundingClientRect() { return {width:100,height:30}; } }
const popup = new Element();
let rows = [];
let tags = [];
popup.querySelectorAll = selector => selector.includes('backstage_search_result_item') ? rows : tags;
const input = {value:'naomiros.07',getAttribute:()=>'search-popup'};
const context = {
  window:{}, chrome:{runtime:{onMessage:{addListener(){}}}}, Element,
  getComputedStyle:()=>({display:'block',visibility:'visible'}),
  document:{getElementById:id=>id==='search-popup'?popup:null},
  expose:value=>{api=value;}
};
const source = fs.readFileSync(path.join(__dirname,'..','src/content/backstage-content.js'),'utf8');
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'expose({readMessageSearchResult});})();'),context);
function row(name,blocked=false) {
  const el = new Element();
  el.innerText=name+(blocked?'Uygun değil':'');
  el.querySelectorAll=()=>blocked?[{getAttribute:()=>'Tag: Uygun değil'}]:[];
  return el;
}
const read = (fresh=true)=>api.readMessageSearchResult(input,'naomiros.07',fresh);
popup.innerText='Esra🦩'; rows=[row('Esra🦩')];
assert.equal(read(false),null,'Eski kart uygun sayılamaz');
assert.equal(read().eligible,true,'Taze etiketsiz tek kart uygundur');
popup.innerText='Yükleniyor...'; assert.equal(read(),null,'Yükleme sırasında kart kullanılamaz');
popup.innerText='Melisa 🐆Uygun değil'; rows=[row('Melisa 🐆',true)];
assert.equal(read().eligible,false);
input.value='other'; assert.equal(read(),null,'Değişen kullanıcı sonucu kullanılamaz');
input.value='naomiros.07'; rows=[]; assert.equal(read(),null,'Boş sonuç uygun değildir');
rows=[row('a'),row('b')]; assert.equal(read(),null,'Çoklu sonuç uygun değildir');
rows=[row('')]; assert.equal(read(),null,'Boş kart uygun değildir');
// Uygun olmayan kart seçilebilir satır olmadan yalnız semi-tag-content etiketiyle gelebilir.
rows=[]; popup.innerText='Melisa 🐆Uygun değil';
tags=[{className:'semi-tag-content semi-tag-content-center',textContent:'Uygun değil',getAttribute:()=>null}];
const tagOnly=read();
assert.deepEqual({...tagOnly},{ok:true,eligible:false,reason:'Uygun değil'},'Etiketli taze sonuç hata değil, atlanacak sonuçtur');
assert.equal(read(false),null,'Eski etiket yeni arama sonucu sayılamaz');
tags=[{className:'semi-tag-content',textContent:'Mevcut',getAttribute:()=>null}];
assert.equal(read(),null,'Uygun değil dışındaki etiket satırsız sonuçta karar vermez');
tags=[];
console.log('Anlık mesaj uygunluğu ve eski/boş/yüklenen sonuç korumaları geçti.');
