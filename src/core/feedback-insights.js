/* Editorial decisions, not platform benchmarks. Pure functions; no network or sends. */
(function(root){
'use strict';
const DAY=86400000;
const policy=Object.freeze({version:6,source:'agency_editorial_pilot',
  inactivityDays:7,sparseDays14:4,activityDropRatio:.4,activityDropSeconds:7200,similarDurationRatio:.15,
  diamondBaseline:100,diamondAbsoluteDifference:100,diamondRelativeDifference:.3,
  diamondYieldRelativeDifference:.3,diamondYieldMinimumHours:2,
  minPairSeconds:1800,maxDurationRatio:1.5,minPairViewers:30,maxViewerRatio:2,
  watchDifferenceSeconds:30,watchRatio:1.6,concentrationTotal:100,concentrationShare:.7,
  minRateViewers:100,followDifference:5,commenterDifference:10,
  shortWatchSeconds:25,shortWatchMinimumLives:2,shortWatchShare:.5,shortWatchFrequencyMinimumLives:4,shortLiveDays:3,
  standoutRatio:2,standoutWatchDifference:15,standoutViewerDifference:100,standoutRateRatio:1.5});
const actions={
 'BS-D01':{family:'continuity',step:'Yeniden yayın açmanı zorlaştıran bir durum var mı diye tek, nazik soru sor. Sorunun anlamı yayına dönmekle ilgili olmalı; ara vermeyi zorlaştıran bir durum sorulmaz.'},
 'BS-D02':{family:'continuity',step:'Görülen yayın azalmasını veya seyrekliği kısaca belirt; yayın açmayı zorlaştıran teknik bir sorun ya da başka bir durum olup olmadığını tek, nazik soruyla sor. Bu mesaj için durum sorusu yeterlidir. Nedeni öğrenmeden çözüm, yayın takvimi veya gün seçme görevi ekleme.'},
 'BS-S01':{family:'duration',step:'Sonraki yayın günlerinde, o gün başka bir yayında bir saat dolmadıysa tek yayında en az bir saati tamamlamayı öner. Ajansın trafik geliştirme hedefi açısından bir saati tamamlamanın önemini, kısa yayınların beklenen trafik katkısını sağlamadığını anlat. Kesin algoritma kuralı veya trafik garantisi verme.'},
 'BS-S02':{family:'preparation',step:'Benzer kısa yayınları bir saate taşıyabilmek için kendi içeriğinde ele alacağı birkaç başlığı önceden seçmeyi denemesini öner.'},
 'BS-H02':{family:'diamonds',step:'Anlamlı elmas değişimini yayın süresiyle birlikte sade biçimde açıkla. Süreler yakınsa dakika dökümü yerine benzer süre yayında kaldığını belirt; gün sayısı değiştiyse bütün düzen aynı deme. Artışı olumla. Düşüşte destek sunabilirsin: Yardım edebileceğim bir şey olursa söylemekten çekinme. Yalnız elmas azaldığı için yayın açmakta zorlandığını varsayma. Veride neden veya özel yöntem yoksa reçete uydurma.'},
 'BS-H03':{family:'diamonds',step:'Desteğin toplandığı gerçek günleri belirt ve bu günleri yararlı bir odak olarak göster. O gün ne yapıldığını veya sonucu neyin doğurduğunu varsayma.'},
 'BS-I04':{family:'retention-observation',step:'Karşılaştırılabilir yayınlardaki izleme farkını yalnız destekleyici gözlem olarak kullan. Bunun kalıcı eğilim veya belirli bir davranışın sonucu olduğunu söyleme.'},
 'BS-I02':{family:'brief-context',step:'İzleme ihtiyacına bağlı küçük bir deneme olarak, konu değiştiğinde ne yaptığını tek cümleyle anlatmayı öner.'},
 'BS-I05':{family:'retention-focus',step:'Verilen tarihlerdeki kısa ortalama izlemeyi açıkça belirt ve izleyicilerin yayında daha uzun kalmasına odaklanılmasını öner. Veride belirli bir yöntemin dayanağı yoksa burada bitir; açılış cümlesi, içerik anlatma, soru sorma veya başka hazır reçete ekleme.'},
 'BS-P01':{family:'repeat-own-approach',step:'Belirgin güçlü yayının tarihini ve hangi sonuçta öne çıktığını söyle. O yayında işe yaradığını düşündüğü şeyleri sonraki benzer yayınlarında yeniden deneyebileceğini belirt. Ne yaptığını biliyormuş gibi davranma; aynı sonucun tekrarlanacağını vaat etme.'},
 'BS-R01':{family:'schedule-announcement',step:'İzleyiciler kalırken daha az kişiye ulaşan yayınlar için, açmaya zaten karar verdiği bir yayını takipçilerine önceden haber vermeyi denemesini öner. Yeni bir yayın takvimi veya sabit gün/saat düzeni oluşturmasını isteme.'},
 'BS-R02':{family:'preview',step:'İzleme korunurken daha az kişiye ulaşan yayınlar için, kendi yayınında sunduğunu doğru anlatan kısa bir tanıtım paylaşmayı denemesini öner.'},
 'BS-F01':{family:'return-reason',step:'Takip kazanımını desteklemek için, bir sonraki yayında gerçekten sunabileceği şeyi kısaca söylemeyi denemesini öner.'},
 'BS-F03':{family:'participation-invite',step:'Takip kazanımı ihtiyacına bağlı olarak uygun bir anda kısa, doğal bir takip hatırlatmasını denemesini öner.'},
 'BS-E01':{family:'reply',step:'Yorum katılımı ihtiyacına bağlı olarak, gelen gerçek bir yorumdaki noktaya kısa ve anlamlı karşılık vermeyi denemesini öner; yorumları görmezden geldiğini söyleme.'},
 'BS-E02':{family:'participation-invite',step:'Yorum katılımı ihtiyacına bağlı olarak kendi içeriğiyle ilgili kolay yanıtlanabilir bir görüş isteyip cevaba yer vermeyi denemesini öner.'},
 'BS-K01':{family:'maintain',step:'Görülen güçlü yönü, onu destekleyen somut gözlemle olumla. Yeni sorun veya gereksiz görev ekleme.'}
};
const diffDays=(a,b)=>Math.round((Date.parse(a)-Date.parse(b))/DAY);
const change=(a,b)=>a>0?(b-a)/a:null;
const between=(a,b,max)=>a>0&&b>0&&Math.max(a,b)/Math.min(a,b)<=max;
function durationText(seconds){
 if(seconds===null||seconds===undefined)return null;
 if(seconds<60)return seconds+' saniye';
 const minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
 return (seconds%60?'yaklaşık ':'')+(hours?hours+' saat'+(minutes%60?' '+minutes%60+' dakika':''):minutes+' dakika');
}
function watchText(seconds){
 if(seconds===null||seconds===undefined)return null;
 const minutes=Math.floor(seconds/60),remaining=seconds%60;
 return [minutes?minutes+' dakika':'',remaining||!minutes?remaining+' saniye':''].filter(Boolean).join(' ');
}
function build(report,record,history,core,overrides={}){
 const p={...policy,...overrides},f=core.feedbackFacts(report),candidates=[],evidence={},checks=[];
 const ref=(key,value)=>{const id=record.recordKey+':'+key;evidence[id]={id,...value,
   display:{duration:durationText(value.durationSeconds),averageWatch:watchText(value.averageWatchSeconds),diamonds:value.diamonds===null||value.diamonds===undefined?null:value.diamonds.toLocaleString('tr-TR')}};return id;};
 const periodRef=(key)=>ref(key,{kind:'daily_period',...f[key],source:'calculatedFacts.'+key});
 const sessionRef=s=>ref('s'+s.source.match(/\d+/)[0],{kind:'single_live',...s});
 const dayRef=d=>ref('day-'+d.date,{kind:'daily_total',...d});
 const add=(key,priority,topic,meaning,refs,codes,limits=[],meta={})=>{
   const candidate={id:record.recordKey+':'+key,key,priority,topic,meaning,evidenceIds:[...new Set(refs)],adviceCodes:codes,limits,
     role:meta.role||'topic',confidence:meta.confidence||'high'};candidates.push(candidate);return candidate;
 };
 const obs=f.observation,prev=f.previous7,recent=f.recent7;
 checks.push({area:'session-integrity',invalidSessionDates:f.invalidSessionDates,duplicateSessionCount:f.duplicateSessionCount});
 const fullObs=obs.complete&&obs.activeDays!==null&&!obs.beforeJoining;
 // A visible recent live contradicting an all-zero daily window makes inactivity uncertain.
 const lastVisible=f.sessions.map(s=>s.displayedDate).sort().at(-1);
 const zeroConflict=fullObs&&obs.activeDays===0&&!!lastVisible;
 const gap=fullObs&&obs.lastActiveDate?diffDays(obs.to,obs.lastActiveDate):null;
 const inactive=fullObs&&!zeroConflict&&!f.invalidSessionDates&&obs.calendarDays>=p.inactivityDays&&
   (obs.activeDays===0||(gap>=p.inactivityDays&&(!lastVisible||diffDays(obs.to,lastVisible)>=p.inactivityDays-1)));
 const durationChange=f.comparison.comparable&&prev.durationSeconds!==null&&recent.durationSeconds!==null?change(prev.durationSeconds,recent.durationSeconds):null;
 const durationPreserved=durationChange!==null&&recent.durationSeconds!==null&&durationChange>=-p.similarDurationRatio;
 const fewerDaysWithPreservedDuration=durationPreserved&&recent.activeDays!==null&&prev.activeDays!==null&&recent.activeDays<prev.activeDays;
 const sparse=fullObs&&obs.calendarDays>=14&&obs.activeDays>0&&obs.activeDays<=p.sparseDays14&&
   !(recent.activeDays>=3&&recent.activeDays>prev.activeDays)&&!fewerDaysWithPreservedDuration;
 // Fewer days can contain the same or more total airtime. Days alone do not establish a broadcasting difficulty.
 const activityDrop=f.comparison.comparable&&prev.activeDays!==null&&recent.activeDays!==null&&
   prev.durationSeconds>=p.activityDropSeconds&&recent.durationSeconds!==null&&prev.durationSeconds-recent.durationSeconds>=p.activityDropSeconds&&durationChange<=-p.activityDropRatio;
 if(inactive)add('inactive',110,'Yayına dönüş için durum sorusu',obs.activeDays===0?'Tam gözlem aralığında yayın görünmüyor. Öncelik eski yayınları yorumlamak değil, mevcut engeli anlamak.':'Son doğrulanmış yayın gününden sonra uzun ara var. Öncelik yeniden yayın açmasını zorlaştıran durumu anlamak.',[periodRef('observation')],['BS-D01']);
 else if(activityDrop)add('activity-drop',100,'Toplam yayın süresinde belirgin azalma','Eşit ve tam dönemlerde toplam yayın süresi belirgin azalıyor. Gün sayısını ancak bu durumu açıklıyorsa ekle. Yayın açmayı zorlaştıran bir durum olup olmadığını sor; nedeni veriden bilinmiyor.',[periodRef('previous7'),periodRef('recent7')],['BS-D02']);
 else if(sparse)add('sparse',95,'Seyrek yayın için durum sorusu','Tam iki haftada az sayıda yayın günü görülüyor. Ayrıntılı performans tavsiyesinden önce yayın açmayı zorlaştıran durum olup olmadığını sor.',[periodRef('observation')],['BS-D02']);
 checks.push({area:'regularity',result:inactive?'long-break':activityDrop?'meaningful-decline':sparse?'sparse':fullObs?'observed-window-usable':'incomplete',zeroConflict});
 const diamondDown=f.comparison.comparable&&prev.diamonds>=p.diamondBaseline&&recent.diamonds!==null&&
   prev.diamonds-recent.diamonds>=p.diamondAbsoluteDifference&&change(prev.diamonds,recent.diamonds)<=-p.diamondRelativeDifference&&prev.activeDays>=2&&recent.activeDays>=2;
 if(diamondDown&&!inactive){
   const yieldDown=prev.diamondsPerHour>0&&recent.diamondsPerHour!==null&&change(prev.diamondsPerHour,recent.diamondsPerHour)<=-.2;
   add('diamond-decline',98,'Elmas kazanımında anlamlı azalma',
    activityDrop?'Elmas kazanımıyla birlikte yayın süresi/günleri de azalmış. İki gözlemi birlikte anlat; toplam farkı tek başına yayın kalitesine bağlama.'+ (yieldDown?' Saat başına elmas da daha düşük; toplam fark yalnızca sürenin azalmasından ibaret değil.':''):
    (durationPreserved?'Toplam yayın süresi korunmasına rağmen elmas kazanımı belirgin daha düşük. Sürelerin benzer veya daha yüksek olması yayın günlerinin de aynı kaldığı anlamına gelmez. ':'Eşit dönemlerde elmas kazanımı belirgin daha düşük. ')+'Kazanıma odaklan ve ihtiyaç duyarsa yardım edebileceğini söyle. Yayın açmasını zorlaştıran bir durum olduğu sonucunu çıkarma; düşüşün nedeni bilinmiyor.',[periodRef('previous7'),periodRef('recent7')],['BS-H02'],['Elmasın TL/jeton karşılığı veya düşüşün nedeni bilinmiyor.']);
 }
 const diamondUp=f.comparison.comparable&&prev.diamonds>=p.diamondBaseline&&recent.diamonds!==null&&
   recent.diamonds-prev.diamonds>=p.diamondAbsoluteDifference&&change(prev.diamonds,recent.diamonds)>=p.diamondRelativeDifference&&prev.activeDays>=2&&recent.activeDays>=2;
 if(diamondUp&&!inactive&&!sparse){
   add('diamond-growth',94,'Elmas kazanımındaki güçlü gelişimi destekleme','Eşit ve tam iki dönemde elmas kazanımı anlamlı biçimde artmış. Yayın süresi ve gün sayısını da göster; artışı nedeni bilinmeyen ama korunmaya değer bir güçlü yön olarak anlat.',[periodRef('previous7'),periodRef('recent7')],['BS-H02'],['Artışın nedenini, destekçiyi veya belirli yayın davranışını veriden çıkarma.']);
 }
 const previousHours=prev.durationSeconds===null?null:prev.durationSeconds/3600,recentHours=recent.durationSeconds===null?null:recent.durationSeconds/3600;
 const yieldChange=f.comparison.comparable&&prev.diamondsPerHour>0&&recent.diamondsPerHour!==null&&previousHours>=p.diamondYieldMinimumHours&&recentHours>=p.diamondYieldMinimumHours
   ?change(prev.diamondsPerHour,recent.diamondsPerHour):null;
 if(!inactive&&!sparse&&!diamondDown&&yieldChange!==null&&yieldChange<=-p.diamondYieldRelativeDifference&&prev.diamonds>=p.diamondBaseline&&recent.diamonds>=p.diamondBaseline){
   add('diamond-yield-decline',90,'Yayın süresine göre elmas verimindeki düşüşe dikkat etme','Toplam elmas tek başına büyük düşüş göstermese de yayın süresine göre kazanım belirgin gerilemiş. Toplam elması, toplam süreyi ve saat başına değişimi birlikte sade biçimde anlat; özel neden veya yöntem uydurma.',[periodRef('previous7'),periodRef('recent7')],['BS-H02'],['Saat başına elmas ajansın hesaplanmış karşılaştırmasıdır; platform standardı veya gelir karşılığı değildir.']);
 } else if(!inactive&&!sparse&&!diamondUp&&yieldChange!==null&&yieldChange>=p.diamondYieldRelativeDifference&&prev.diamonds>=p.diamondBaseline&&recent.diamonds>=p.diamondBaseline){
   add('diamond-yield-growth',72,'Yayın süresine göre elmas verimindeki gelişimi destekleme','Eşit dönemlerde yayın süresine göre elmas kazanımı anlamlı biçimde güçlenmiş. Bunu korunmaya değer bir güçlü yön olarak belirt; sebebini bildiğini varsayma.',[periodRef('previous7'),periodRef('recent7')],['BS-H02'],['Saat başına elmas ajansın hesaplanmış karşılaştırmasıdır; platform standardı veya gelir karşılığı değildir.']);
 }
 checks.push({area:'diamonds',result:diamondDown?'meaningful-decline':diamondUp?'meaningful-growth':yieldChange!==null&&Math.abs(yieldChange)>=p.diamondYieldRelativeDifference?'meaningful-yield-change':f.comparison.comparable?'no-material-change':'no-full-equal-periods',previous:prev.diamonds,recent:recent.diamonds});
 // Only observed dates in the last seven days count; never add separate lives together.
 const recentSessionDays=f.sessionDays.filter(d=>d.displayedDate>=recent.from);
 const shortDays=recentSessionDays.filter(d=>!d.hasObserved60MinuteSession&&d.unknownDurationCount===0&&d.longestSessionSeconds>0&&d.longestSessionSeconds<3600)
   .sort((a,b)=>b.displayedDate.localeCompare(a.displayedDate));
 // A failed page or an unreadable date may hide a longer live on the same date.
 if(report.sessions?.tableComplete!==false&&!f.invalidSessionDates&&shortDays.length>=p.shortLiveDays&&!inactive&&!sparse){
   const summary=ref('short-live-frequency',{kind:'session_pattern',source:'calculatedFacts.sessionDays',from:recent.from,to:recent.to,
     observedShortDays:shortDays.length,observedActiveDays:recentSessionDays.length,minimumSeconds:3600,
     days:shortDays.map(d=>({...d})),scope:'observed_sessions',timezone:f.sessionTimezone});
   add('short-lives',88,'Tek yayında bir saatin sık tamamlanmaması',`Son yedi günün görülebilen yayınlarında ${shortDays.length} ayrı günde tek yayında bir saat tamamlanmamış. Ara sıra kısa yayın sorun değildir; burada tekrarlanan durumu ve sonraki yayın günlerinde tek yayında bir saat hedefini anlat.`,
     [summary,...shortDays.slice(0,2).map(d=>sessionRef(f.sessions.find(s=>s.factId===d.longestSessionFactId)))],['BS-S01','BS-S02'],
     ['Görülen tarihlerdeki örüntüdür; tam geçmiş veya platform geçerli gün sayısı değildir. Gelecek yayınlarda aynı yayın günündeki bir saat koşulunu koru.']);
 }
 // Comparable single lives: same displayed type, different dates, similar duration, enough observed viewers.
 const base=f.sessions.filter(s=>s.durationSeconds>=p.minPairSeconds&&s.viewers>=p.minPairViewers&&s.type&&s.averageWatchSeconds!==null);
 const pairs=[];
 for(let i=0;i<base.length;i++)for(let j=i+1;j<base.length;j++){
   let a=base[i],b=base[j];if(a.displayedDate===b.displayedDate||a.type!==b.type||!between(a.durationSeconds,b.durationSeconds,p.maxDurationRatio))continue;
   if(a.displayedDate>b.displayedDate)[a,b]=[b,a];
   if(b.displayedDate<recent.from)continue;
   pairs.push({a,b,similarReach:between(a.viewers,b.viewers,p.maxViewerRatio)});
 }
 const bestPair=(items,score)=>items.sort((x,y)=>score(y)-score(x)||y.b.displayedDate.localeCompare(x.b.displayedDate)||x.a.factId.localeCompare(y.a.factId))[0];
 const pairRefs=pair=>[sessionRef(pair.a),sessionRef(pair.b)];
 const diamondPairs=pairs.filter(({a,b,similarReach})=>similarReach&&a.diamonds!==null&&b.diamonds!==null&&Math.max(a.diamonds,b.diamonds)>=p.diamondBaseline&&Math.abs(a.diamonds-b.diamonds)>=p.diamondAbsoluteDifference&&Math.abs(a.diamonds-b.diamonds)/Math.max(a.diamonds,b.diamonds)>=p.diamondRelativeDifference);
 const dp=bestPair(diamondPairs,({a,b})=>Math.abs(a.diamonds-b.diamonds));
 if(dp&&!inactive&&!sparse){
   const better=dp.a.diamonds>dp.b.diamonds?dp.a:dp.b;
   add('diamond-pair',76,'Benzer yayınlardaki elmas farkı',`Süre, yayın türü ve izleyici sayısı yakın iki yayında elmas kazanımı farklı. Daha güçlü örnek ${better.displayedDate}; bu yalnız ana elmas değerlendirmesini somutlaştıran bir gözlemdir.`,pairRefs(dp),[],['Bu iki yayına özgü farktır; haftalık eğilim, kesin neden veya tekrar edilecek davranış değildir.'],{role:'supporting_observation',confidence:'medium'});
 }
 const recentDaily=f.dailyRows.filter(d=>d.date>=recent.from);
 const top=recentDaily.filter(d=>d.diamonds>0).sort((a,b)=>b.diamonds-a.diamonds);
 if(recent.complete&&recent.activeDays>=3&&recent.diamonds>=p.concentrationTotal&&top.length&&!inactive&&!sparse){
   const chosen=top[0].diamonds/recent.diamonds>=p.concentrationShare?top.slice(0,1):top.slice(0,2);
   const share=chosen.reduce((sum,d)=>sum+d.diamonds,0)/recent.diamonds;
   if(share>=p.concentrationShare&&chosen.length<recent.activeDays){
     add('diamond-concentration',74,'Desteğin güçlü olduğu günleri çoğaltma','Elmasların büyük bölümü belirtilen az sayıdaki günde toplanmış. O günlerde işe yaradığını düşündüğü bir şeyi diğer benzer yayınlarda denemek, yalnızca “düzenin güzel” demekten daha somut bir odak.',[periodRef('recent7'),...chosen.map(dayRef)],['BS-H03'],['Günlük toplamdır; bir yayın veya tek destekçi sayılmaz. Bu günlerde ne yaptığı ve desteğin nedeni bilinmiyor.']);
   }
 }
 const watchPairs=pairs.filter(({a,b,similarReach})=>similarReach&&Math.abs(a.averageWatchSeconds-b.averageWatchSeconds)>=p.watchDifferenceSeconds&&Math.max(a.averageWatchSeconds,b.averageWatchSeconds)>=p.watchRatio*Math.max(1,Math.min(a.averageWatchSeconds,b.averageWatchSeconds)));
 const wp=bestPair(watchPairs,({a,b})=>diffDays(b.displayedDate,f.window.from)*100+diffDays(a.displayedDate,f.window.from)*10+Math.min(300,Math.abs(a.averageWatchSeconds-b.averageWatchSeconds)));
 if(wp&&!inactive&&!sparse){
   const better=wp.a.averageWatchSeconds>wp.b.averageWatchSeconds?wp.a:wp.b;
    add('watch-comparison',70,'Karşılaştırılabilir yayınlardaki izleme farkı',`Süre, tür ve izleyici sayısı açısından karşılaştırılabilir iki yayından ${better.displayedDate} tarihinde izleyiciler daha uzun kalmış. Bu, genel değerlendirmeyi kişiselleştiren destekleyici bir gözlemdir.`,pairRefs(wp),[],['Yalnız verilen iki yayını karşılaştır; kalıcı trend, neden veya tekrar edilecek davranış çıkarma.'],{role:'supporting_observation',confidence:'medium'});
 }
 // Retention does not require a full hour, a known live type or two complete daily tables.
 const latestLives=f.sessions.filter(s=>s.displayedDate>=recent.from&&s.durationSeconds>0&&s.viewers>0&&s.averageWatchSeconds!==null&&s.averageWatchSeconds>=0);
 const lowWatch=latestLives.filter(s=>s.averageWatchSeconds<p.shortWatchSeconds).sort((a,b)=>b.displayedDate.localeCompare(a.displayedDate)||b.start.localeCompare(a.start));
 if(lowWatch.length>=p.shortWatchMinimumLives&&lowWatch.length/latestLives.length>=p.shortWatchShare&&!inactive&&!sparse){
   const limitedSample=latestLives.length<p.shortWatchFrequencyMinimumLives;
   const summary=ref('watch-frequency',{kind:'session_pattern',source:'calculatedFacts.sessions',from:recent.from,to:recent.to,
     thresholdSeconds:p.shortWatchSeconds,belowThresholdCount:lowWatch.length,measuredSessionCount:latestLives.length,
     belowThresholdShare:lowWatch.length/latestLives.length,scope:'observed_sessions',languageScope:limitedSample?'observed_lives':'frequent_pattern',
     observations:latestLives.map(s=>({factId:s.factId,source:s.source,displayedDate:s.displayedDate,averageWatchSeconds:s.averageWatchSeconds}))});
   add('short-watch',86,limitedSample?'Görülen yayınlarda 25 saniye altı izleme':'Sık tekrarlanan 25 saniye altı izleme',`Son yedi gündeki ölçülebilir ${latestLives.length} yayının ${lowWatch.length} tanesinde izleyici başına ortalama izleme ${p.shortWatchSeconds} saniyenin altında. ${limitedSample?'Yalnız iki veya üç ölçüm var: “bu yayınlarda” diyerek sınırla; “sık tekrarlanıyor”, “genellikle” veya kalıcı alışkanlık deme. ':''}Gelenlerin yayında daha uzun kalmasına odaklanılmasını öner.`,
     [summary,...lowWatch.slice(0,2).map(sessionRef)],['BS-I05'],['Yalnız görülebilen, ölçülebilir yayınlar sayıldı. Ortalamaları yeniden ortalama alma. Bu eşik ajans hedefidir; izleyicilerin neden veya hangi anda ayrıldığı bilinmiyor.']);
 }
 // Strong single-live results are a usable topic even when daily collection failed.
 // Compare the same type and similar duration; normalize totals to avoid rewarding duration alone.
 const standoutBase=f.sessions.filter(s=>s.durationSeconds>=p.minPairSeconds&&s.viewers>=p.minPairViewers&&s.type);
 const standouts=[];
 for(const better of standoutBase.filter(s=>s.displayedDate>=recent.from))for(const other of standoutBase){
   if(better.displayedDate===other.displayedDate||better.type!==other.type||!between(better.durationSeconds,other.durationSeconds,p.maxDurationRatio))continue;
   for(const [metric,minimum,difference] of [['diamonds',p.diamondBaseline,p.diamondAbsoluteDifference],['averageWatchSeconds',p.shortWatchSeconds,p.standoutWatchDifference],['viewers',p.minRateViewers,p.standoutViewerDifference]]){
     const a=better[metric],b=other[metric];
     if(a===null||b===null||a<minimum||a-b<difference||a<p.standoutRatio*Math.max(1,b))continue;
     if(metric==='diamonds'&&!between(better.viewers,other.viewers,p.maxViewerRatio))continue;
     if(metric!=='averageWatchSeconds'&&b>0&&(a/b)*(other.durationSeconds/better.durationSeconds)<p.standoutRateRatio)continue;
     standouts.push({better,other,metric,ratio:b>0?a/b:null,score:(metric==='diamonds'?3:metric==='averageWatchSeconds'?2:1)});
   }
 }
 standouts.sort((a,b)=>b.score-a.score||b.better.displayedDate.localeCompare(a.better.displayedDate)||(b.ratio||0)-(a.ratio||0));
 const standout=standouts[0];
 if(standout&&!inactive&&!sparse){
   const {better,other,metric,ratio}=standout,label={diamonds:'elmas kazanımı',averageWatchSeconds:'izleyicilerin ortalama kalışı',viewers:'gelen izleyici sayısı'}[metric];
   const summary=ref('standout-comparison',{kind:'session_comparison',source:'calculatedFacts.sessions',metric,betterFactId:better.factId,otherFactId:other.factId,
     betterValue:better[metric],otherValue:other[metric],ratio,betterDate:better.displayedDate,otherDate:other.displayedDate});
   add('standout-live',82,'Belirgin güçlü yayını yeniden deneme',`${better.displayedDate} yayınında ${label}, benzer uzunluk ve türdeki ${other.displayedDate} yayınına göre belirgin yüksek. Hangi sonuçta öne çıktığını tarih vererek belirt; o yayında işe yaradığını düşündüğü şeyleri yeniden denemesini öner.`,
     [sessionRef(better),sessionRef(other),summary],['BS-P01'],['Yalnız bu yayınların karşılaştırmasıdır; tüm yayınların en iyisi veya kalıcı trend değildir. Yayın içeriği ve farkın nedeni bilinmiyor.'],{confidence:'medium'});
 }
 const reachPair=bestPair(pairs.filter(({a,b})=>a.viewers>=p.minRateViewers&&b.viewers<=a.viewers*.6&&a.viewers-b.viewers>=100&&b.averageWatchSeconds>=a.averageWatchSeconds*.85),({a,b})=>a.viewers-b.viewers);
 if(reachPair&&!inactive&&!sparse)add('reach',68,'İzleme korunurken erişim farkı','Bu iki benzer yayında gelen kişi sayısı daha düşükken izleme süresi korunuyor. Ana değerlendirmede erişim ihtiyacını destekleyebilir.',pairRefs(reachPair),[],['Duyuru yapmadığını, algoritmanın cezalandırdığını veya içerik türünü varsayma.'],{role:'supporting_observation',confidence:'medium'});
 const stable=pairs.filter(({a,b,similarReach})=>similarReach&&a.viewers>=p.minRateViewers&&b.viewers>=p.minRateViewers&&b.averageWatchSeconds>=a.averageWatchSeconds*.85);
 const followPair=bestPair(stable.filter(({a,b})=>a.newFollowers>=p.followDifference&&b.newFollowers!==null&&a.newFollowers-b.newFollowers>=p.followDifference&&(b.newFollowers/b.viewers)<=(a.newFollowers/a.viewers)*.5),({a,b})=>a.newFollowers-b.newFollowers);
 if(followPair&&!inactive&&!sparse)add('followers',66,'Benzer yayınlarda takip kazanımı farkı','İzleme korunurken benzer iki yayında izleyici sayısına göre takip kazanımı farklı. Ana değerlendirmeyi destekleyebilen sınırlı bir gözlem.',pairRefs(followPair),[],['Az sayıdaki takipçi farkını büyük yüzdeyle sunma. Dönemlik tekil izleyici oranı değildir.'],{role:'supporting_observation',confidence:'medium'});
 const commentPair=bestPair(stable.filter(({a,b})=>a.commenters>=p.commenterDifference&&b.commenters>0&&a.commenters-b.commenters>=p.commenterDifference&&(b.commenters/b.viewers)<=(a.commenters/a.viewers)*.5),({a,b})=>a.commenters-b.commenters);
 if(commentPair&&!inactive&&!sparse)add('comments',64,'Benzer yayınlarda yorum katılımı farkı','İzleme korunurken benzer iki yayında yorum yapanların izleyicilere oranı farklı. Ana değerlendirmeyi destekleyebilen sınırlı bir gözlem.',pairRefs(commentPair),[],['Görünmeyen yorumları veya yayıncının davranışını uydurma.'],{role:'supporting_observation',confidence:'medium'});
 const growing=f.comparison.comparable&&prev.activeDays!==null&&recent.activeDays>=prev.activeDays+2&&recent.activeDays>=3;
 if(!inactive&&!sparse&&fullObs&&obs.activeDays>=2){
   add(growing?'growing':'maintain',growing?25:10,growing?'Gelişen yayın düzenini destekleme':'Görülen güçlü düzeni destekleme',growing?'Tam ve eşit dönemlerde daha fazla yayın gününe ulaşılmış. Bu çabayı olumla; varsa seçilmiş gelişim bulgusuyla birleştir.':'Mevcut gözlem penceresinde birden fazla yayın günü var. Yalnız başka anlamlı ihtiyaç yoksa somut düzeni destekleyen kısa mesaj yeterli.',growing?[periodRef('previous7'),periodRef('recent7')]:[periodRef('observation')],['BS-K01']);
 }
 if(!inactive&&!sparse&&!fullObs&&!obs.beforeJoining&&recent.observedActiveDays>=2){
   add('observed-activity',20,'Güncel kayıtlarda görülen yayın emeğini destekleme','Son yedi günün mevcut günlük kayıtlarında birden fazla aktif gün açıkça görülüyor. Yalnız bu günlerdeki emeği kısaca destekle; eksik kapsamdan “düzenin iyi” veya “bu düzeni sürdür” sonucu çıkarma.',[periodRef('recent7')],['BS-K01'],['Görülmeyen günü sıfır veya yayın yapılmamış sayma. Eski haftadaki birkaç yayın gününü güncel yayın düzeni diye olumlama.'],{confidence:'medium'});
 }
 const past=(history||[]).slice(-4);
 function priorFamilies(message){
   const codes=message.recommendationIds||[...String(message.recommendations||'').matchAll(/BS-[A-Z]\d{2}/g)].map(m=>m[0]);
   // Retired advice remains recognizable in sent history, but cannot be selected again.
   const families=new Set(codes.map(id=>actions[id]?.family||(id==='BS-I03'?'start':null)).filter(Boolean));
   const t=String(message.text||message.message||'').toLocaleLowerCase('tr');
   if(/soru sor|görüş.{0,20}iste|takip.{0,20}(hatırlat|davet)|takibe/.test(t))families.add('participation-invite');
   if(/yeniden dene|tekrar dene|işe yara/.test(t))families.add('repeat-own-approach');
   if(/bir saat|60 dakika/.test(t))families.add('duration');
   if(/önceden.{0,20}duyur/.test(t))families.add('schedule-announcement');
   if(/birkaç başlık|önceden.{0,20}plan/.test(t))families.add('preparation');
   if(/düzen.{0,24}(topar|plan)|yayın.{0,16}gün.{0,20}(seç|belirle)/.test(t))families.add('continuity');
   return families;
 }
 const used=new Set(past.flatMap(m=>[...priorFamilies(m)]));
  const actionFamily=(candidate,code)=>code==='BS-H02'?(candidate.key==='diamond-decline'&&activityDrop?'continuity':'diamonds'):code==='BS-H03'?'diamonds':actions[code].family;
 for(const candidate of candidates){
   candidate.actions=candidate.adviceCodes.map(code=>({code,...actions[code],family:actionFamily(candidate,code)}));
   for(const a of candidate.actions)a.recentlySent=used.has(a.family);
   candidate.actions.sort((a,b)=>Number(a.recentlySent)-Number(b.recentlySent));
    candidate.selectedAdviceCode=candidate.actions[0]?.code||null;
    candidate.repeatNote=candidate.actions.length&&candidate.actions.every(a=>a.recentlySent)?'Aynı davranış yakın geçmişte gönderilmiş. Yeni kayıtla ihtiyacın sürdüğünü sınırlı biçimde belirt; uygulamadı/işe yaramadı deme. Yeni yöntem uydurma.':null;
 }
  candidates.sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key));
  const mainCandidates=candidates.filter(c=>c.role==='topic');
  const topicCandidates=[...candidates];
  const supportingObservations=candidates.filter(c=>c.role==='supporting_observation');
  let primary=mainCandidates[0]||null;
 // Keep a genuinely unresolved agency priority; for comparable lower priorities, prefer unused applicable advice.
 if(primary&&primary.priority<80&&primary.actions.every(a=>a.recentlySent)){
    primary=mainCandidates.find(c=>c.priority>=primary.priority-8&&c.priority>=60&&c.actions.some(a=>!a.recentlySent))||primary;
 }
  const critical=mainCandidates.filter(c=>['inactive','activity-drop','sparse','diamond-decline','diamond-yield-decline'].includes(c.key));
  // Keep messages to two topics. A concrete scenario must not be replaced with generic praise.
  const scenario=mainCandidates.find(c=>['short-lives','short-watch','standout-live'].includes(c.key));
  const mandatory=[...critical];
  if(!critical.length&&scenario)mandatory.push(scenario);
  const support=primary?mainCandidates.filter(c=>c!==primary&&(mandatory.includes(c)||['diamond-growth','diamond-yield-decline','diamond-yield-growth','growing','maintain','observed-activity'].includes(c.key))).slice(0,2):[];
  const exported=topicCandidates;
  const ids=[...new Set(exported.flatMap(c=>c.evidenceIds))];
 const limits=['Günlük toplam tek yayın değildir. Günlük UTC ile yayınların görüntülenen tarihlerini birleştirme.','Veri yayın içeriğini, teknik sorunu ve davranışın nedenini göstermez.','Geçerli yayın günü sayısı hesaplanmadı.'];
  const responseMode=!primary?'no_message':['inactive','activity-drop','sparse'].includes(primary.key)?'check_in':primary.key==='short-watch'?'focus':['maintain','growing','observed-activity','diamond-growth','diamond-yield-growth'].includes(primary.key)?'affirmation':'coaching';
  const overallContext={activityComparison:{comparable:f.comparison.comparable,durationChangeRatio:durationChange,durationPreserved,fewerDaysWithPreservedDuration,significantDurationDrop:activityDrop},coverage:{from:obs.from,to:obs.to,complete:obs.complete,missingDates:obs.missingDates,duplicateDates:obs.duplicateDates,beforeJoining:obs.beforeJoining},
    observation:{activeDays:obs.activeDays,observedActiveDays:obs.observedActiveDays,durationSeconds:obs.durationSeconds,diamonds:obs.diamonds,lastActiveDate:obs.lastActiveDate},
    previous7:{from:prev.from,to:prev.to,complete:prev.complete,activeDays:prev.activeDays,durationSeconds:prev.durationSeconds,diamonds:prev.diamonds,diamondsPerHour:prev.diamondsPerHour},
    recent7:{from:recent.from,to:recent.to,complete:recent.complete,activeDays:recent.activeDays,durationSeconds:recent.durationSeconds,diamonds:recent.diamonds,diamondsPerHour:recent.diamondsPerHour},
    sessions:{observedCount:f.sessions.length,recentCount:f.sessions.filter(s=>s.displayedDate>=recent.from).length,observedActiveDays:recentSessionDays.length,timezone:f.sessionTimezone},
    regularity:inactive?'inactive':activityDrop?'declining':sparse?'sparse':growing?'growing':fullObs?'regular':recent.observedActiveDays>=2?'observed-partial':'unknown'};
  const noMessageDetails=primary?null:{recentSessionCount:overallContext.sessions.recentCount,
    recentDailyRowCount:recentDaily.length,recentObservedActiveDays:recent.observedActiveDays,
    measuredWatchCount:latestLives.length,belowWatchThresholdCount:lowWatch.length,observedShortDays:shortDays.length,
    invalidSessionDates:f.invalidSessionDates,duplicateSessionCount:f.duplicateSessionCount,
    dailyCoverageComplete:recent.complete,sessionTableComplete:report.sessions?.tableComplete??null,missingDailyDates:recent.missingDates,duplicateDailyDates:recent.duplicateDates};
  let noMessageReason=null;
  if(!primary){
    const available=`Son yedi günde görülen tek yayın: ${noMessageDetails.recentSessionCount}; tekil günlük satır: ${recentDaily.length}; ölçülebilir izleme: ${latestLives.length}; ${p.shortWatchSeconds} saniye altı: ${lowWatch.length}; görülen kısa yayın günü: ${shortDays.length}.`;
    noMessageReason=available+' '+(!noMessageDetails.recentSessionCount&&!recent.complete?
      'Güncel tek yayın kaydı yok ve günlük kapsam eksik; yayın yapmadığı sonucu çıkarılamaz.':
      'Mevcut kayıtlardan güvenilir bir ana mesaj konusu seçilemedi; senaryo koşulları veya konu için gereken kapsam sağlanmadı.')+
      (f.invalidSessionDates?' Tarihi çözülemeyen yayın kaydı var; yayın yapılmadığı veya bir saatin tamamlanmadığı kesinleştirilemez.':'')+
      ' Eksik kayıt, normal performans ve devamsızlık aynı şey değildir.';
  }
  return {version:2,responseMode,recordKey:record.recordKey,creatorKey:record.creatorKey,username:record.username,
   policyVersion:p.version,firstFeedback:past.length===0,observationWindow:{from:obs.from,to:obs.to,complete:obs.complete,days:obs.calendarDays},
    overallContext,primary,support,topicCandidates,supportingObservations,requiredFindingIds:[...new Set(mandatory.map(c=>c.id))],
   evidence:ids.map(id=>evidence[id]),checks,limits,
   previousSentMessages:past.map(m=>({sentAt:m.sentAt,text:m.text||m.message||'',recommendationIds:m.recommendationIds||[],recommendations:m.recommendations||''})),
   noMessageReason,noMessageDetails,
    considered:candidates.map(c=>({id:c.id,key:c.key,priority:c.priority,topic:c.topic,role:c.role,selected:c===primary||support.includes(c)}))};
}
const api={policy,actions,build,durationText,watchText};if(typeof module!=='undefined')module.exports=api;root.BTGFeedbackInsights=api;
})(globalThis);
