import ResetProgress from './ResetProgress';
import { useEffect, useRef, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import { GroupedPicks, useGroupedRows, groupRowOf, asAccounts } from './AccountGroups';
import PvpPage from './PvpPage';
import TowerPage from './TowerPage';
import { RotationModes, RotationLive } from './RotationPanel'; // @strip(basic)

const api = window.dreamteam;
const num = v => (v == null ? '—' : Number(v).toLocaleString());
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const LETTERS = ['A', 'B', 'C', 'D'];

const TEXT = {
  tr: {
    title: 'Günlük İşler', howTitle: 'Nasıl çalışır?', subtitle: 'Go-up, Professional, Daily Boss, Elite Ascent, Big 3, Prop, Daily Quiz, Cheer, Chat ve Daily Slot · hepsi tarayıcı açmadan',
    pf: {"title":"Professional","start":"Başlat ({n})","refresh":"Durumları oku","stage":"Aşama","next":"Sıradaki rakip","left":"Kalan maç","cards":"Maç kartı","status":"Durum","result":"Sonuç","hint":"Sezon ve playoff otomatik oynanır. Hall of Fame'de rakibi sen seçersin.","createHof":"Hall of Fame'i başlat","pickHof":"Rakip seç","hofTeam":"{name} (Ofans {off} · Defans {def})","props":"Props {n}/2","stg":{"noSeason":"Sezon yok · başlatılacak","season":"Sezon {p}/{t} · {w}-{l}","noPlayoffs":"Sezon bitti · playoff kurulacak","playoffs":"Playoff · {round} · seri {w}-{l}","champion":"Şampiyon · Hall of Fame hazır","eliminated":"Playoff'ta elendi","hof":"Hall of Fame · {d}/{t} yenildi","hofDone":"Hall of Fame tamam · Honor Way açılacak","seasonOver":"Sezon bitti · yeni sezon kurulacak","honor":"Honor Way · {d}/{t} yenildi","honorDone":"Honor Way tamam · Legacy Way açılacak","legacy":"Legacy Way · {d}/{t} yenildi","legacyDone":"Legacy Way tamam","error":"Okunamadı"},"rounds":{"FIRST_ROUND":"1. tur","CONFERENCE_SEMIFINALS":"Konferans yarı finali","CONFERENCE_FINALS":"Konferans finali","NBA_FINALS":"Final"},"st":{"eliminated":"Elendi","champion":"Şampiyon","needPick":"Rakip seçilmeli","hofDone":"HOF tamam","legacyDone":"Legacy Way tamam"},"how":["Her hesabın aşaması otomatik bulunur: sezon yoksa konferans rastgele seçilip 82 maçlık sezon kurulur; sezon bitince playoff kurulur ve sıradaki playoff maçı oynanır.","Günlük maç hakkı bitene kadar oynar. Hak bitince, varsa oyundan kazanılan Prof Match Card ile \"Props\" yenilemesi yapılır (günde en fazla 2). TIX ile yenileme asla yapılmaz.","Hall of Fame'deki hesaplarda rakipler hücum/savunma toplamlarıyla listelenir; hangi rakiple oynanacağını sen seçersin. O rakip yenilince durur ve yeni seçim bekler.","Playoff'ta elenen hesapta playoff otomatik sıfırlanır ve normal sezona dönülür. Hall of Fame bitince Honor Way, o da bitince Legacy Way açılır; bunlarda rakip sırası oyunda sabittir, sırayla oynanır. Auto Play bu hesaplarda durdurulur, bitince yeniden başlatılır."]},
    batch: { title: 'Toplu Başlat', hint: 'Tikli sistemler yukarıdan aşağıya sırayla, seçili hesaplarda çalışır; biri bitince sıradaki başlar. Her biri kendi Başlat düğmesine basılmış gibi çalışır (Daily Boss: hesabın seviyesine uygun en yüksek boss ya da Daily Boss sekmesinde seçilen). Sıra ve tikler hatırlanır.', start: 'Sırayla başlat ({n} sistem · {a} hesap)', stop: 'Durdur', order: 'Sıra', up: 'Yukarı', down: 'Aşağı', st: { queued: 'Sırada', running: 'Çalışıyor', done: 'Bitti', error: 'Hata', skipped: 'Atlandı', stopped: 'Durduruldu' }, running: 'Çalışıyor · {name}', finished: 'Bitti', accs: 'Hesaplar', accShared: 'Ortak ({n})', accOwn: 'Kendi listesi ({n})', accTitle: '{name} · hesaplar', accHint: 'Bu sistem sadece burada seçilen hesaplarda çalışır. Ortak listeyi kullanırsa aşağıdaki ortak seçim geçerlidir.', accUseShared: 'Ortak listeyi kullan', accDone: 'Tamam', sharedTitle: 'Ortak hesaplar', sharedHint: 'Kendi listesi olmayan sistemler bu hesaplarda çalışır.' },
    tabs: { batch: 'Toplu Başlat', rotation: 'Rotasyon', pvp: 'PVP Arena', tower: 'Kule', goup: 'Go-up', pro: 'Professional', boss: 'Daily Boss', ascent: 'Elite Ascent', magic: 'Big 3 (Magic Team)', props: 'Prop', quiz: 'Daily Quiz', cheer: 'Cheer', chat: 'Chat', slot: 'Daily Slot' },
    ds: { scan: 'Durumu tara', spin: 'Hepsini çevir ({n})', spinning: 'Çevriliyor…', stop: 'Durdur', accounts: 'Hesaplar', hint: 'Daily Sign-in penceresindeki günlük slot: günde 1 çevirme, 3 ödül. Tarama hiçbir hesaba giriş yapmaz; çevirme, hesabın uygulamada açık bağlantısını kullanır (Auto Play maç oynuyorsa maç bitince çevrilir), yoksa giriş yapar. Zaten çevrilmiş hesapların bugünkü ödülleri de görünür.', account: 'Hesap', status: 'Durum', prizes: 'Kazanılan 3 ödül', when: 'Saat', summary: '{spun} çevrildi · {already} zaten çevrilmişti · {failed} hata', none: 'Henüz tarama yok · “Durumu tara”ya bas.', tally: 'Bugün: {spun}/{total} hesap çevrildi', st: { queued: 'Sırada', reading: 'Okunuyor', ready: 'Çevrilebilir', spinning: 'Çevriliyor', waitMatch: 'Maç bitince', spun: 'Çevrildi', error: 'Hata', stopped: 'Durduruldu' }, inMatch: 'maç bitmedi', totals: 'Bugünün ödülleri (toplam) · kimin kazandığını görmek için ödüle tıkla', whoCount: '{n} hesap', close: 'Kapat', pool: 'Ödül havuzu (şans)' },
    pr: {
      runSel: 'Seçilenlere bas ({n})', stopSel: 'Seçilenleri durdur ({n})', selectAll: 'Tümünü seç', clearSel: 'Seçimi kaldır',
      button: 'Prop bas', stop: 'Durdur', refresh: 'Çantaları oku', small: 'Su şişesi küçük (+10)', medium: 'Su şişesi orta (+30)', used: 'Kullanılan', players: 'İlk 5',
      st: { finding: 'Maç aranıyor', noMatch: 'Takım maçta değil', late: '3./4. periyotta · devre arası geçti', waitingHalftime: 'Devre arası bekleniyor', using: 'Prop basılıyor', done: 'Bitti', error: 'Hata', stopped: 'Durduruldu' },
      quarter: '{n}. periyot', countdown: 'devre arası {s} sn',
      how: ['Her hesabın kendi "Prop bas" düğmesi var. Takım maçta değilse "takım maçta değil" der; maç 3. ya da 4. periyottaysa devre arası geçtiği için basmaz.', '1. ya da 2. periyottaysa devre arasını bekler. Devre arasında (20 sn) ilk 5\'teki her oyuncuyu staminası 95 ve üstü olana kadar doldurur: staminası 75 ve altındaysa (25 ya da daha fazla eksik) +30\'luk, 76–94 arasındaysa +10\'luk basılır. Örnek: 15 staminalı oyuncuya 3 × +30, 55 staminalıya +30 sonra +10. Gereken şişe bittiyse diğeri kullanılır (85\'in üstünde +30 basılmaz).', 'Sadece tek oyunculuk su şişeleri kullanılır; takım prop\'ları ve büyük şişe kullanılmaz. Bitince sonuç Aktivite\'ye yazılır ve maç ekranından çıkılır.']
    },
    pg: {
      start: 'Başlat ({n})', include: 'Oynasın', level: 'Lv', boss: 'Boss', attempts: 'Kalan hak', result: 'Sonuç', floor: 'Kat', enemy: 'Rakip',
      applyAll: 'Hepsine uygula', best: 'Her hesaba en güçlü uygun boss', needs: 'Lv {n} gerekir', noBoss: 'Uygun boss yok', wl: '{w} G · {l} M',
      refreshAscent: 'Katları oku', ascentHint: 'Katları okumak için hesaplara kısa süreliğine giriş yapılır; o hesap oyunda açıksa oradan çıkış yapılır.',
      st: { queued: 'Sırada', login: 'Bağlanıyor', starting: 'Maç başlatılıyor', playing: 'Maçta', otherMatch: 'Başka maçta · bekliyor', waitingGame: 'Oyun bekleniyor', done: 'Bitti', noAttempts: 'Hak yok', locked: 'Seviye yetmiyor', error: 'Hata', stopped: 'Durduruldu' },
      bossHow: ['Her hesap seçtiğin boss ile günlük 2 hakkını bitirene kadar oynar; rakip bot olduğu için sıra beklenmez.', 'Her boss bir seviye ister; seviyesi yetmeyen hesapta o boss seçilemez.', 'Başlarken bu hesaplardaki Auto Play durdurulur, bitince yeniden başlatılır. Hak 19:10\'da yenilenir.'],
      ascentHow: ['Her hesap bulunduğu kattaki botla oynar; kazanırsa bir üst kata çıkar. Günlük 2 bedava hak bitene kadar devam eder.', 'Ücretli haklar asla satın alınmaz ve kullanılmaz.', 'Elite Ascent hesaba giriş ister: o hesap oyunda açıksa oradan çıkış yapılır. Auto Play durdurulur, bitince yeniden başlatılır.'],
      refreshMagic: 'Üçlüleri oku', magicHint: 'Lv 15 bir Big3 üçlüsü MIAMI ve PHILADELPHIA botlarını yener, ödül alınır; sonra üçlü Ofis\'te 20. seviyeye kadar çalışabilir.', trio: 'Üçlü', beaten: 'Yenilen bot', auto: 'Otomatik (hazır üçlü)',
      magicState: { LOCKED: 'Kilitli', FIGHTING: 'Maça hazır', REWARD: 'Ödül hazır', TRAINING: 'Antrenmanda' },
      magicSt: { claimed: 'Ödül alındı', locked: 'Lv 15 üçlü yok', inactive: 'Üçlü aktif değil (Ofis → Big Three)', pkLimit: 'Günlük PK sınırı' },
      magicHow: ['Her hesap hazır üçlüsüyle (Lv 15, Ofis\'te aktif) sıradaki botla oynar; iki bot yenilince ödül kendiliğinden alınır.', 'Maçlar PK maçı gibi ödül verir ve günlük PK sınırından düşer; bir çalıştırmada hesap başına en fazla 6 maç oynanır.', 'Başlarken bu hesaplardaki Auto Play durdurulur, bitince yeniden başlatılır.']
    },
    selectAll: 'Tümünü seç', clear: 'Seçimi temizle', stop: 'Durdur', refresh: 'Durumu yenile', checking: 'Kontrol ediliyor…', account: 'Hesap', status: 'Durum',
    notReady: 'Bu özellik uygulama yeniden başlatılınca çalışır.',
    gu: {
      start: 'Go-up Başlat ({n})', mode: 'Başlatma', parallel: 'Tümü aynı anda', staggered: 'Sırayla', gap: 'Hesaplar arası bekleme (sn)',
      event: 'Etkinlik', active: 'Açık', inactive: 'Kapalı', unknown: 'Bilinmiyor', league: 'Lig', season: 'Sezon puanı', total: 'Toplam puan', attempts: 'Kalan hak', last: 'Son maç',
      st: { queued: 'Sırada', waitingStart: 'Başlaması bekleniyor', login: 'Bağlanıyor', finding: 'Maç aranıyor', searching: 'Kuyrukta · rakip bekleniyor', playing: 'Maçta', otherMatch: 'Başka maçta · bitmesi bekleniyor', waitingGame: 'Oyun bekleniyor', done: 'Bitti', noAttempts: 'Hak yok', inactive: 'Etkinlik kapalı', error: 'Hata', stopped: 'Durduruldu' },
      vs: 'rakip', startsIn: '{t} sonra başlar',
      how: ['Her hesap günlük 2 hakkını kullanana kadar kuyruğa girer, rakip bulununca maç oynanır, maç bitince puanlar güncellenir. Kuyruk uzun sürebilir; süre canlı gösterilir. Durdur kuyruktan da çıkar.', 'Haklar her gün 19:10 civarında yenilenir. Etkinlik kapalıysa (sezon arası) uyarı verip durur.', 'Başlatırken seçili hesaplarda çalışan Auto Play durdurulur, Go-up bitince yeniden başlatılır. Mağazadan hiçbir şey alınmaz.', 'Aynı görevi Auto Play sayfasındaki "Zamanla" ile belirli bir saate de kurabilirsin.']
    },
    qz: {
      start: 'Quiz Başlat ({n})', bank: 'Bilinen soru: {n}', question: 'Soru {n}/10', score: 'Skor {n}/10',
      known: 'Uygulama biliyor', unknown: 'Yeni soru · cevabını seç', auto: 'oto', user: 'senin', random: 'rastgele', randomIn: '{s} sn içinde seçmezsen rastgele denenecek',
      correct: 'Doğru', wrong: 'Yanlış', rightAnswer: 'doğru cevap', learned: 'öğrenildi',
      st: { queued: 'Sırada', login: 'Bağlanıyor', answering: 'Cevaplanıyor', askUser: 'Cevabını bekliyor', claiming: 'Ödüller toplanıyor', done: 'Bitti · ödüller toplandı', already: 'Bugün oynanmış', waitingGame: 'Oyun bekleniyor', error: 'Hata', stopped: 'Durduruldu' },
      how: ['Bilinen sorular otomatik cevaplanır. İlk kez gelen soruda kartta şıklar çıkar; birkaç saniye içinde seçmezsen rastgele bir şık denenir.', 'Cevaptan sonra oyun doğru cevabı gösterir; uygulama senin cevabını değil doğru cevabı öğrenir. Cevabı değişen soru kendiliğinden yeniden öğrenilir.', 'Bütün sorular bitince ödüller toplanır. Öğrenilen cevaplar kalıcıdır ve kurulum dosyasına eklenir.']
    },
    ch: {
      targets: 'Cheer atılacak hesaplar', start: 'Cheer başlat · {t} hedef · {n} hesap', stop: 'Durdur', run: 'Çalışan Cheer', morale: 'Moral', sent: 'Atılan', quarter: '{n}. periyot',
      rst: { finding: 'Maç aranıyor', noMatch: 'Maçta değil', waiting2ndHalf: '2. yarı bekleniyor', cheering: 'Cheer atılıyor', full: 'Moral 200 · durdu', ended: 'Maç bitti', noCheerers: 'Cheer atacak hesap kalmadı', stopped: 'Durduruldu', error: 'Hata' },
      target: 'Cheer atılacak hesap', from: 'Cheer atacak hesaplar', send: 'Şimdi Cheer at ({n})', sending: 'Gönderiliyor…', main: 'ANA',
      noMatch: '{name} şu an bir maçta değil · maç bulunamadı, Cheer atılmadı.', result: 'Son Cheer', rights: 'Bugünkü Cheer hakları', resetAt: '{t} sıfırlanır', today: 'Bugünün Cheer kaydı', noneToday: 'Bugün henüz Cheer atılmadı.', noneLeft: 'Hak bitti', time: 'Saat', target2: 'Hedef', leftHint: 'Oyun kalan hakkı göstermiyor; uygulama hesap başına günde {n} hak sayar, oyun "limit" derse o hesap 0 olur.', ok: 'Atıldı', fail: 'Atılamadı', side: { host: 'ev sahibi takım', opponent: 'deplasman takımı' },
      how: ['Birden çok hedef seçebilirsin; Cheer atan hesaplar hedeflere sırayla dağılır (biri ona, biri ona). Her hedefe 2. yarı (3. periyot) başlayınca atılır, moral 200 olunca o hedef için durur. Bir hesap bir maçta yalnızca bir kez Cheer atabilir.', 'Seçilen hesap o an hangi maçtaysa (Auto Play, Kule, PVP…) o maçta kendi takımına Cheer atılır (+5 moral). Maçta değilse hiçbir şey gönderilmez.', 'Her hesabın günde yaklaşık 3 Cheer hakkı var; hak bitince oyunun verdiği hata yazılır.', 'Çantadaki Cheer eşyası asla kullanılmaz; yalnızca maç ekranındaki ücretsiz Cheer.']
    },
    cs: {
      messages: 'Mesajlar', add: 'Mesaj ekle', text: 'Mesaj', pickAccount: 'Hesap seç', interval: 'Mesajlar arası (sn)', loopCount: 'Döngü sayısı', infinite: 'Sonsuz döngü',
      start: 'Chat Başlat', minHint: 'Oyun her mesaj arasında 10 sn bekletir; en az {n} sn girilebilir.', maxHint: 'En fazla {n} karakter',
      feed: 'Oyun sohbeti', feedHint: 'genel sohbette herkesin yazdıkları · uygulama 2 gün saklar', feedSearch: 'Ara (takım ya da mesaj)…', feedEmpty: 'Henüz mesaj yok. Uygulama açıkken gelen mesajlar burada birikir.',
      loop: 'Döngü {a}/{b}', message: 'Mesaj {a}/{b}', next: 'Sonraki mesaj {t} sonra', sending: 'Gönderiliyor…', sent: 'Gönderilen', failed: 'Başarısız', blocked: 'Sohbeti engellenen hesaplar', saved: 'Mesaj listesi kaydedildi',
      how: ['Mesajlar listedeki sırayla, her biri kendi hesabından yazılır; liste döngü sayısı kadar (ya da durdurana kadar) tekrarlanır.', 'Oyun genel sohbette her hesaba 10 sn bekleme koyar ve mesaj en fazla 50 karakter olabilir; uygulama bu sınırların altına inmez.', 'Oyun bir hesabın sohbetini engellerse o hesabın mesajları atlanır ve uyarı yazılır. Megafon kullanılmaz.']
    }
  },
  en: {
    title: 'Daily', howTitle: 'How does it work?', subtitle: 'Go-up, Professional, Daily Boss, Elite Ascent, Big 3, Props, Daily Quiz, Cheer, Chat and Daily Slot · all without a browser',
    pf: {"title":"Professional","start":"Start ({n})","refresh":"Read status","stage":"Stage","next":"Next opponent","left":"Matches left","cards":"Match cards","status":"Status","result":"Result","hint":"Season and playoffs are played automatically. In the Hall of Fame you pick the opponent.","createHof":"Start the Hall of Fame","pickHof":"Pick an opponent","hofTeam":"{name} (Offense {off} · Defense {def})","props":"Props {n}/2","stg":{"noSeason":"No season · will be started","season":"Season {p}/{t} · {w}-{l}","noPlayoffs":"Season over · playoffs will be created","playoffs":"Playoffs · {round} · series {w}-{l}","champion":"Champion · Hall of Fame ready","eliminated":"Eliminated in the playoffs","hof":"Hall of Fame · {d}/{t} beaten","hofDone":"Hall of Fame done · Honor Way will open","seasonOver":"Season over · a new season will be created","honor":"Honor Way · {d}/{t} beaten","honorDone":"Honor Way done · Legacy Way will open","legacy":"Legacy Way · {d}/{t} beaten","legacyDone":"Legacy Way done","error":"Could not be read"},"rounds":{"FIRST_ROUND":"Round 1","CONFERENCE_SEMIFINALS":"Conference semifinals","CONFERENCE_FINALS":"Conference finals","NBA_FINALS":"Finals"},"st":{"eliminated":"Eliminated","champion":"Champion","needPick":"Pick an opponent","hofDone":"HOF done","legacyDone":"Legacy Way done"},"how":["Every account's stage is found automatically: with no season a random conference is chosen and the 82-game season is created; after the season the playoffs are created and the next playoff game is played.","It plays until the daily matches are used. Then, if there is a Prof Match Card won in the game, a \"Props\" refill is used (at most 2 a day). TIX refills are never used.","Accounts in the Hall of Fame list the opponents with their offense/defense totals; you pick who to play. When that opponent is beaten it stops and waits for a new pick.","An account eliminated in the playoffs gets its playoffs reset automatically and goes back to the regular season. After the Hall of Fame the Honor Way opens, after that the Legacy Way; their opponents come in a fixed order and are played in turn. Auto Play is stopped on these accounts and started again afterwards."]},
    batch: { title: 'Run in order', hint: 'The ticked systems run one after another from top to bottom on the chosen accounts; the next starts when one is over. Each runs as if its own Start button was pressed (Daily Boss: the highest boss the account’s level allows, or the one chosen on the Daily Boss tab). Order and ticks are remembered.', start: 'Run in order ({n} systems · {a} accounts)', stop: 'Stop', order: 'Order', up: 'Up', down: 'Down', st: { queued: 'Queued', running: 'Running', done: 'Done', error: 'Error', skipped: 'Skipped', stopped: 'Stopped' }, running: 'Running · {name}', finished: 'Finished', accs: 'Accounts', accShared: 'Shared ({n})', accOwn: 'Own list ({n})', accTitle: '{name} · accounts', accHint: 'This system runs only on the accounts chosen here. With the shared list it uses the shared choice below.', accUseShared: 'Use the shared list', accDone: 'Done', sharedTitle: 'Shared accounts', sharedHint: 'Systems without a list of their own run on these accounts.' },
    tabs: { batch: 'Run in order', rotation: 'Rotation', pvp: 'PVP Arena', tower: 'Tower', goup: 'Go-up', pro: 'Professional', boss: 'Daily Boss', ascent: 'Elite Ascent', magic: 'Big 3 (Magic Team)', props: 'Props', quiz: 'Daily Quiz', cheer: 'Cheer', chat: 'Chat', slot: 'Daily Slot' },
    ds: { scan: 'Check status', spin: 'Spin all ({n})', spinning: 'Spinning…', stop: 'Stop', accounts: 'Accounts', hint: 'The daily slot of the Daily Sign-in window: 1 spin a day, 3 prizes. Checking signs in to no account; spinning uses the account\'s open connection in the app (when Auto Play is in a match it spins after the match), otherwise it signs in. The prizes of accounts that already spun today show too.', account: 'Account', status: 'Status', prizes: 'The 3 prizes won', when: 'Time', summary: '{spun} spun · {already} had already spun · {failed} failed', none: 'Nothing checked yet · press “Check status”.', tally: 'Today: {spun}/{total} accounts spun', st: { queued: 'Queued', reading: 'Reading', ready: 'Can spin', spinning: 'Spinning', waitMatch: 'After the match', spun: 'Spun', error: 'Error', stopped: 'Stopped' }, inMatch: 'the match did not end', totals: 'Today\'s prizes (total) · click a prize to see who won it', whoCount: '{n} account(s)', close: 'Close', pool: 'Prize pool (chance)' },
    pr: {
      runSel: 'Use on selected ({n})', stopSel: 'Stop selected ({n})', selectAll: 'Select all', clearSel: 'Clear selection',
      button: 'Use props', stop: 'Stop', refresh: 'Read bags', small: 'Water Bottle Small (+10)', medium: 'Water Bottle Medium (+30)', used: 'Used', players: 'Starters',
      st: { finding: 'Finding the match', noMatch: 'The team is not in a match', late: 'Quarter 3/4 · halftime is over', waitingHalftime: 'Waiting for halftime', using: 'Using props', done: 'Done', error: 'Error', stopped: 'Stopped' },
      quarter: 'quarter {n}', countdown: 'halftime {s} s',
      how: ['Every account has its own "Use props" button. If the team is not in a match it says so; in quarter 3 or 4 nothing is used because halftime is over.', 'In quarter 1 or 2 it waits for halftime. During the 20 s halftime every starter is filled to 95+ stamina: a +30 bottle at 75 or below (25 or more missing), a +10 bottle from 76 to 94. Example: a player at 15 gets 3 × +30, one at 55 gets +30 then +10. When the needed bottle has run out the other is used (no +30 above 85).', 'Only single-player water bottles are used; team props and large bottles are not. The result goes to Activity and the match screen is left.']
    },
    pg: {
      start: 'Start ({n})', include: 'Plays', level: 'Lv', boss: 'Boss', attempts: 'Attempts left', result: 'Result', floor: 'Floor', enemy: 'Opponent',
      applyAll: 'Apply to all', best: 'Strongest allowed boss for each account', needs: 'needs Lv {n}', noBoss: 'No boss allowed', wl: '{w} W · {l} L',
      refreshAscent: 'Read floors', ascentHint: 'Reading the floors signs in to each account briefly; if the account is open in the game it is signed out there.',
      st: { queued: 'Queued', login: 'Connecting', starting: 'Starting the match', playing: 'In a match', otherMatch: 'In another match · waiting', waitingGame: 'Waiting for the game', done: 'Done', noAttempts: 'No attempts', locked: 'Level too low', error: 'Error', stopped: 'Stopped' },
      bossHow: ['Every account plays the chosen boss until its 2 daily attempts are used; the opponent is a bot, so there is no queue.', 'Each boss needs a level; an account below it cannot choose that boss.', 'On start Auto Play on these accounts is stopped and started again afterwards. Attempts reset at 19:10.'],
      ascentHow: ['Every account plays the bot of its current floor; a win moves it one floor up. It goes on until the 2 free daily attempts are used.', 'Paid attempts are never bought or used.', 'Elite Ascent needs the account signed in: if it is open in the game it is signed out there. Auto Play is stopped and started again afterwards.'],
      refreshMagic: 'Read trios', magicHint: 'A level 15 Big3 trio beats the MIAMI and PHILADELPHIA bots and claims a prize; then the trio can train to level 20 in the Office.', trio: 'Trio', beaten: 'Bots beaten', auto: 'Automatic (ready trio)',
      magicState: { LOCKED: 'Locked', FIGHTING: 'Ready to fight', REWARD: 'Prize ready', TRAINING: 'Training' },
      magicSt: { claimed: 'Prize claimed', locked: 'No level 15 trio', inactive: 'Trio not active (Office → Big Three)', pkLimit: 'Daily PK limit' },
      magicHow: ['Every account plays the next bot with its ready trio (level 15, active in the Office); after both bots the prize is claimed by itself.', 'The matches pay like PK matches and count against the daily PK limit; at most 6 matches per account in one run.', 'Auto Play on these accounts is stopped at the start and started again when it is over.']
    },
    selectAll: 'Select all', clear: 'Clear selection', stop: 'Stop', refresh: 'Refresh status', checking: 'Checking…', account: 'Account', status: 'Status',
    notReady: 'This works after the app is restarted.',
    gu: {
      start: 'Start Go-up ({n})', mode: 'Start', parallel: 'All at once', staggered: 'One by one', gap: 'Gap between accounts (s)',
      event: 'Event', active: 'Open', inactive: 'Closed', unknown: 'Unknown', league: 'League', season: 'Season points', total: 'Total points', attempts: 'Attempts left', last: 'Last match',
      st: { queued: 'Queued', waitingStart: 'Waiting to start', login: 'Connecting', finding: 'Finding a match', searching: 'In the queue · waiting for an opponent', playing: 'In a match', otherMatch: 'In another match · waiting', waitingGame: 'Waiting for the game', done: 'Done', noAttempts: 'No attempts', inactive: 'Event closed', error: 'Error', stopped: 'Stopped' },
      vs: 'vs', startsIn: 'starts in {t}',
      how: ['Each account joins the queue until its 2 daily attempts are used; when an opponent is found the match is played and the points are refreshed. The queue may take long; the time is shown live. Stop also leaves the queue.', 'Attempts reset every day around 19:10. When the event is closed (season break) it warns and stops.', 'On start, Auto Play on the selected accounts is stopped and started again when Go-up is over. Nothing is bought from the shop.', 'The same task can be set for a time with "Schedule" on the Auto Play page.']
    },
    qz: {
      start: 'Start Quiz ({n})', bank: 'Known questions: {n}', question: 'Question {n}/10', score: 'Score {n}/10',
      known: 'The app knows it', unknown: 'New question · pick the answer', auto: 'auto', user: 'yours', random: 'random', randomIn: 'a random answer is tried in {s} s',
      correct: 'Correct', wrong: 'Wrong', rightAnswer: 'right answer', learned: 'learned',
      st: { queued: 'Queued', login: 'Connecting', answering: 'Answering', askUser: 'Waiting for your answer', claiming: 'Claiming rewards', done: 'Done · rewards claimed', already: 'Already played today', waitingGame: 'Waiting for the game', error: 'Error', stopped: 'Stopped' },
      how: ['Known questions are answered by the app. A new question shows its options on the card; if you do not pick one within a few seconds a random option is tried.', 'After answering, the game shows the right answer; the app learns that, not your answer. A question whose answer changed is relearned by itself.', 'When every question is done the rewards are claimed. Learned answers are permanent and go into the setup build.']
    },
    ch: {
      targets: 'Accounts to cheer for', start: 'Start cheering · {t} target(s) · {n} account(s)', stop: 'Stop', run: 'Running cheer', morale: 'Morale', sent: 'Sent', quarter: 'quarter {n}',
      rst: { finding: 'Finding the match', noMatch: 'Not in a match', waiting2ndHalf: 'Waiting for the 2nd half', cheering: 'Cheering', full: 'Morale 200 · stopped', ended: 'Match over', noCheerers: 'No account left to cheer', stopped: 'Stopped', error: 'Error' },
      target: 'Account to cheer for', from: 'Accounts that cheer', send: 'Cheer now ({n})', sending: 'Sending…', main: 'MAIN',
      noMatch: '{name} is not in a match right now · no match found, nothing was sent.', result: 'Last cheer', rights: 'Cheers left today', resetAt: 'resets {t}', today: "Today's cheers", noneToday: 'No cheers sent today yet.', noneLeft: 'None left', time: 'Time', target2: 'Target', leftHint: 'The game does not show the cheers left; the app counts {n} a day per account, and a "limit" reply sets that account to 0.', ok: 'Sent', fail: 'Not sent', side: { host: 'host team', opponent: 'away team' },
      how: ['You can pick several targets; the cheering accounts take turns over them (one to this, one to that). A target gets cheers once the 2nd half (quarter 3) starts, and none once its morale is 200. An account can cheer only once per match.', 'Whatever match the chosen account plays right now (Auto Play, Tower, PVP…), its own team gets the cheer (+5 morale). If it is not in a match, nothing is sent.', 'Each account has about 3 cheers a day; when they run out the game\'s message is shown.', 'The Cheer item from the bag is never used; only the free cheer of the match screen.']
    },
    cs: {
      messages: 'Messages', add: 'Add message', text: 'Message', pickAccount: 'Choose account', interval: 'Seconds between messages', loopCount: 'Loops', infinite: 'Endless',
      start: 'Start Chat', minHint: 'The game makes every account wait 10 s between messages; at least {n} s.', maxHint: 'At most {n} characters',
      feed: 'Game chat', feedHint: 'everything written in the global chat · kept 2 days by the app', feedSearch: 'Search (team or message)…', feedEmpty: 'No messages yet. Messages that come while the app is open collect here.',
      loop: 'Loop {a}/{b}', message: 'Message {a}/{b}', next: 'Next message in {t}', sending: 'Sending…', sent: 'Sent', failed: 'Failed', blocked: 'Accounts blocked from the chat', saved: 'Message list saved',
      how: ['Messages are written in list order, each by its own account; the list repeats for the number of loops (or until stopped).', 'The game puts a 10 s wait on every account in the global chat and a message can be at most 50 characters; the app never goes below these limits.', 'If the game blocks an account\'s chat, that account\'s messages are skipped with a warning. No megaphone.']
    }
  },
  get fil() { return filOf(this.en); }
};

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [active]);
  return now;
}

function AccountPicks({ accounts, ids, setIds, disabled, x, extra }) {
  const all = ids.length === accounts.length;
  return <div className="dp-picks-wrap">
    <button className="chip" disabled={disabled} onClick={() => setIds(all ? [] : accounts.map(a => a.id))}>{all ? x.clear : x.selectAll}</button>
    <div className="pvp-picks"><GroupedPicks storeKey="daily" accounts={accounts} selected={ids} disabled={disabled} onSet={setIds} render={a => <button key={a.id} type="button" disabled={disabled} className={ids.includes(a.id) ? 'selected' : ''} onClick={() => setIds(ids.includes(a.id) ? ids.filter(v => v !== a.id) : [...ids, a.id])}>
      <span>{a.name}</span>{extra?.(a)}</button>} /></div>
  </div>;
}

function useSavedIds(state, key, accounts, fallback) {
  const [ids, setIdsRaw] = useState(() => (state.settings?.[key] || fallback || accounts.map(a => a.id)).filter(id => accounts.some(a => a.id === id)));
  const setIds = next => { setIdsRaw(next); api.settings.update({ [key]: next }).catch(() => {}); };
  return [ids, setIds];
}

function GoUpTab({ state, x, toast }) {
  const g = state.goup || {};
  const accounts = state.accounts || [];
  const running = Boolean(g.running);
  const [ids, setIds] = useSavedIds(state, 'goupAccountIds', accounts);
  const grp = useGroupedRows('dp-goup');
  const [mode, setMode] = useState(state.settings?.goupMode || 'parallel');
  const [gap, setGap] = useState(state.settings?.goupGapSec ?? 30);
  const [checking, setChecking] = useState(false);
  const now = useNow(running);
  const check = async () => { if (!api.goup) return toast(x.notReady, 'error'); setChecking(true); try { await api.goup.status(accounts.map(a => a.id)); } catch (e) { toast(e.message, 'error'); } finally { setChecking(false); } };
  useEffect(() => { if (api.goup) check(); }, []);
  const saveMode = (m, s) => api.settings.update({ goupMode: m, goupGapSec: Number(s) || 0 }).catch(() => {});
  const start = async () => { if (!api.goup) return toast(x.notReady, 'error'); try { await api.goup.start(ids, { mode, gapSec: Number(gap) || 0 }); } catch (e) { toast(e.message, 'error'); } };
  const ev = g.event;
  const rows = accounts.map(a => ({ a, p: g.points?.[a.id] || null, r: g.run?.accounts?.[a.id] || null }));
  const statusText = r => {
    if (!r) return '';
    const base = x.gu.st[r.status] || r.status;
    if (r.status === 'searching' && r.queuedAt) return `${base} · ${mmss(now - Date.parse(r.queuedAt))}`;
    if (r.status === 'playing' && r.matchStartedAt) return `${base}${r.opponent ? ` · ${x.gu.vs} ${r.opponent}` : ''} · ${mmss(now - Date.parse(r.matchStartedAt))}`;
    if (r.status === 'waitingStart' && r.startAt) return fill(x.gu.startsIn, { t: mmss(Date.parse(r.startAt) - now) });
    if (r.status === 'error' && r.reason) return `${base}: ${r.reason}`;
    return base;
  };
  return <>
    <div className="dp-toolbar">
      <div className={`panel pvp-arena ${ev?.active === true ? 'ok' : ev?.active === false ? 'bad' : 'muted'}`}><span>{x.gu.event}</span><b>{ev?.active === true ? x.gu.active : ev?.active === false ? x.gu.inactive : x.gu.unknown}</b>{ev?.info && <em>{ev.info}</em>}{ev?.range && <small>{ev.range}</small>}</div>
      <div className="panel dp-controls">
        <label><span>{x.gu.mode}</span><select value={mode} disabled={running} onChange={e => { setMode(e.target.value); saveMode(e.target.value, gap); }}><option value="parallel">{x.gu.parallel}</option><option value="staggered">{x.gu.staggered}</option></select></label>
        {mode === 'staggered' && <label><span>{x.gu.gap}</span><input type="number" min="0" value={gap} disabled={running} onChange={e => { setGap(e.target.value); saveMode(mode, e.target.value); }} /></label>}
        <div className="dp-actions">
          <button className="btn ghost" disabled={checking} onClick={check}>{checking ? x.checking : x.refresh}</button>
          {running ? <button className="btn danger-soft" onClick={() => api.goup.stop().catch(e => toast(e.message, 'error'))}>{x.stop}</button>
            : <button className="btn primary" disabled={!ids.length} onClick={start}>{fill(x.gu.start, { n: ids.length })}</button>}
        </div>
      </div>
    </div>
    <div className="panel dp-section"><AccountPicks accounts={accounts} ids={ids} setIds={setIds} disabled={running} x={x} extra={a => { const p = g.points?.[a.id]; return <em className={p?.left === 0 ? 'zero' : ''}>{p?.left == null ? '—' : `${p.left}/${p.max ?? 2}`}</em>; }} /></div>
    <div className="panel table-panel dp-table"><SortTable><thead><tr><th>{x.account}</th><th>{x.gu.league}</th><th>{x.gu.season}</th><th>{x.gu.total}</th><th>{x.gu.attempts}</th><th>{x.status}</th><th>{x.gu.last}</th></tr></thead>
      <tbody>{grp(rows.map(row => ({ ...row, id: row.a.id, name: row.a.name })), ({ a, p, r }) => <tr key={a.id} className={r && ['searching', 'playing'].includes(r.status) ? 'dp-live' : ''}>
        <td><b>{a.name}</b></td>
        <td>{p?.tier ? `${p.tier.name}${p.tier.level ? ` ${p.tier.level}` : ''}` : '—'}</td>
        <td><b>{num(r?.season ?? p?.season)}</b>{r?.seasonStart != null && r?.season != null && r.season !== r.seasonStart && <small className={`cell-sub ${r.season > r.seasonStart ? 'good-text' : 'bad-text'}`}>{r.season > r.seasonStart ? '+' : ''}{r.season - r.seasonStart}</small>}</td>
        <td>{num(r?.total ?? p?.total)}</td>
        <td>{(r?.attemptsLeft ?? p?.left) == null ? '—' : `${r?.attemptsLeft ?? p?.left}/${p?.max ?? 2}`}</td>
        <td className={r?.status === 'error' || r?.status === 'inactive' ? 'bad-text' : ''}>{statusText(r)}</td>
        <td>{r?.lastDiff != null ? <span className={r.lastDiff >= 0 ? 'good-text' : 'bad-text'}>{r.lastDiff >= 0 ? '+' : ''}{r.lastDiff}</span> : '—'}</td>
      </tr>, groupRowOf(7, g => <><td /><td /><td /><td>{g.reduce((n, { r, p }) => n + (Number(r?.attemptsLeft ?? p?.left) || 0), 0)}/{g.reduce((n, { p }) => n + (Number(p?.max) || 2), 0)}</td><td className="muted-text">{g.filter(({ r }) => r && ['searching', 'playing'].includes(r.status)).length || ''}</td><td /></>))}</tbody></SortTable></div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.gu.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Daily Boss: per account the boss to play (only bosses its level allows).
// A closed group of same-prefix accounts: one row (box = the whole group, name opens it).
function groupHeadRow(g, { open, toggle }, { ids = [], setIds = null, disabled = false, select = true, rest = 0 }) {
  const gi = g.accounts.map(a => a.id);
  const on = gi.filter(id => ids.includes(id)).length;
  return <tr key={g.key} className="grp-row">
    {select && <td><input type="checkbox" disabled={disabled} checked={on === gi.length} ref={el => { if (el) el.indeterminate = on > 0 && on < gi.length; }} onChange={() => setIds(on === gi.length ? ids.filter(id => !gi.includes(id)) : [...new Set([...ids, ...gi])])} aria-label={g.label} /></td>}
    <td className="grp-name" onClick={toggle}><i className="grp-arrow">{open ? '▾' : '▸'}</i><b>{g.label}</b> <small className="muted-text">{select ? `${on}/${gi.length}` : gi.length}</small></td>
    {rest > 0 && <td colSpan={rest} className="muted-text" onClick={toggle} />}
  </tr>;
}

function BossTab({ state, x, toast }) {
  const grp = useGroupedRows('dp-boss');
  const b = state.dailyBoss || {};
  const accounts = state.accounts || [];
  const running = Boolean(b.running);
  const bosses = b.bosses || [];
  const [ids, setIds] = useSavedIds(state, 'bossAccountIds', accounts);
  const [plan, setPlanRaw] = useState(() => state.settings?.bossPlan || {});
  const [checking, setChecking] = useState(false);
  const levelOf = id => b.info?.[id]?.level ?? state.accountProfile?.accounts?.[id]?.level ?? null;
  const allowed = id => bosses.filter(x2 => levelOf(id) == null || levelOf(id) >= x2.levelRequired);
  const bestFor = id => allowed(id).slice(-1)[0]?.id || null;
  const pick = id => (plan[id] && allowed(id).some(x2 => x2.id === plan[id])) ? plan[id] : bestFor(id);
  const setPlan = next => { setPlanRaw(next); api.settings.update({ bossPlan: next }).catch(() => {}); };
  const check = async () => { if (!api.boss) return toast(x.notReady, 'error'); setChecking(true); try { await api.boss.status(accounts.map(a => a.id)); } catch (e) { toast(e.message, 'error'); } finally { setChecking(false); } };
  useEffect(() => { if (api.boss) check(); }, []);
  const chosen = ids.filter(id => pick(id));
  const allOn = accounts.length > 0 && accounts.every(a => ids.includes(a.id));
  const start = async () => { try { await api.boss.start(Object.fromEntries(chosen.map(id => [id, pick(id)]))); } catch (e) { toast(e.message, 'error'); } };
  const applyAll = bossId => setPlan(Object.fromEntries(accounts.map(a => [a.id, bossId === 'best' ? bestFor(a.id) : (allowed(a.id).some(x2 => x2.id === bossId) ? bossId : bestFor(a.id))])));
  return <>
    <div className="panel pg-bar">
      <button className="btn ghost" disabled={running} onClick={() => setIds(allOn ? [] : accounts.map(a => a.id))}>{allOn ? x.clear : x.selectAll}</button>
      <label className="pg-apply"><span>{x.pg.applyAll}</span><select value="" disabled={running || !bosses.length} onChange={e => e.target.value && applyAll(e.target.value)}><option value="">—</option><option value="best">{x.pg.best}</option>{bosses.map(o => <option key={o.id} value={o.id}>{o.name} · Lv {o.levelRequired}</option>)}</select></label>
      <span className="sp" />
      <button className="btn ghost" disabled={checking} onClick={check}>{checking ? x.checking : x.refresh}</button>
      {running ? <button className="btn danger-soft" onClick={() => api.boss.stop().catch(e => toast(e.message, 'error'))}>{x.stop}</button>
        : <button className="btn primary" disabled={!chosen.length} onClick={start}>{fill(x.pg.start, { n: chosen.length })}</button>}
    </div>
    <div className="panel table-panel dp-table"><SortTable><thead><tr><th className="select-col"><input type="checkbox" disabled={running} checked={allOn} onChange={() => setIds(allOn ? [] : accounts.map(a => a.id))} aria-label={x.selectAll} /></th><th>{x.account}</th><th>{x.pg.level}</th><th>{x.pg.boss}</th><th>{x.pg.attempts}</th><th>{x.status}</th><th>{x.pg.result}</th></tr></thead>
      <tbody>{grp(accounts, a => {
        const r = b.run?.accounts?.[a.id];
        const info = b.info?.[a.id];
        const options = allowed(a.id);
        const left = r?.left ?? info?.left;
        return <tr key={a.id} className={r?.status === 'playing' ? 'dp-live' : ''}>
          <td><input type="checkbox" disabled={running} checked={ids.includes(a.id)} onChange={() => setIds(ids.includes(a.id) ? ids.filter(i => i !== a.id) : [...ids, a.id])} aria-label={a.name} /></td>
          <td><b>{a.name}</b></td>
          <td>{levelOf(a.id) ?? '—'}</td>
          <td>{options.length ? <select className="dp-select" disabled={running} value={pick(a.id) || ''} onChange={e => setPlan({ ...plan, [a.id]: e.target.value })}>{bosses.map(o => <option key={o.id} value={o.id} disabled={!options.some(p => p.id === o.id)}>{o.name} · {o.tier} · {levelOf(a.id) != null && levelOf(a.id) < o.levelRequired ? fill(x.pg.needs, { n: o.levelRequired }) : `Lv ${o.levelRequired}`}</option>)}</select> : <span className="muted">{bosses.length ? x.pg.noBoss : '—'}</span>}</td>
          <td>{left == null ? '—' : `${left}/${info?.max ?? 2}`}</td>
          <td className={r?.status === 'error' ? 'bad-text' : ''}>{r ? (x.pg.st[r.status] || r.status) + (r.status === 'error' && r.reason ? `: ${r.reason}` : '') : ''}</td>
          <td>{r?.played ? fill(x.pg.wl, { w: r.won, l: r.lost }) : '—'}</td>
        </tr>;
      }, (g, o) => groupHeadRow(g, o, { ids, setIds, disabled: running, select: true, rest: 5 }))}</tbody></SortTable></div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.pg.bossHow.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Professional: season and playoffs play by themselves; Hall of Fame accounts play the opponent picked here.
function ProTab({ state, x, toast, lang }) {
  const grp = useGroupedRows('dp-pro');
  const p = state.professional || {};
  const accounts = state.accounts || [];
  const running = Boolean(p.running);
  const [ids, setIds] = useSavedIds(state, 'proAccountIds', accounts);
  const [picks, setPicksRaw] = useState(() => state.settings?.proHofPicks || {});
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(null);
  const setPick = (id, team) => { const next = { ...picks, [id]: team }; setPicksRaw(next); api.settings.update({ proHofPicks: next }).catch(() => {}); };
  const check = async () => { if (!api.pro) return toast(x.notReady, 'error'); setChecking(true); try { await api.pro.status(ids.length ? ids : accounts.map(a => a.id)); } catch (er) { toast(er.message, 'error'); } finally { setChecking(false); } };
  useEffect(() => { if (api.pro && !Object.keys(p.info || {}).length) check(); }, []);
  const allOn = accounts.length > 0 && accounts.every(a => ids.includes(a.id));
  const openTeams = id => (p.info?.[id]?.teams || []).filter(t => !t.defeated && t.playable !== false);
  const target = id => p.info?.[id]?.stage === 'hof' ? (openTeams(id).some(t => t.id === picks[id]) ? picks[id] : null) : true;
  const start = async () => { try { await api.pro.start(Object.fromEntries(ids.map(id => [id, target(id) || true]))); } catch (er) { toast(er.message, 'error'); } };
  const createHof = async id => { setBusy(id); try { await api.pro.createHof(id); } catch (er) { toast(er.message, 'error'); } finally { setBusy(null); } };
  const stageText = i => {
    if (!i) return '—';
    const t = x.pf.stg[i.stage] || i.stage;
    if (i.stage === 'season') return fill(t, { p: i.played, t: i.total, w: i.won, l: i.lost });
    if (i.stage === 'playoffs') return fill(t, { round: x.pf.rounds[i.round] || i.round, w: i.seriesWon, l: i.seriesLost });
    if (['hof', 'honor', 'legacy'].includes(i.stage)) return fill(t, { d: i.defeated, t: (i.teams || []).length });
    if (i.stage === 'error') return `${t}: ${i.error}`;
    return t;
  };
  const final = ['eliminated', 'champion', 'needPick', 'hofDone'];
  return <>
    <div className="panel pg-bar">
      <button className="btn ghost" disabled={running} onClick={() => setIds(allOn ? [] : accounts.map(a => a.id))}>{allOn ? x.clear : x.selectAll}</button>
      <span className="pg-hint">{x.pf.hint}</span>
      <span className="sp" />
      <button className="btn ghost" disabled={checking || running} onClick={check}>{checking ? x.checking : x.pf.refresh}</button>
      {running ? <button className="btn danger-soft" onClick={() => api.pro.stop().catch(er => toast(er.message, 'error'))}>{x.stop}</button>
        : <button className="btn primary" disabled={!ids.length} onClick={start}>{fill(x.pf.start, { n: ids.length })}</button>}
    </div>
    <div className="panel table-panel dp-table"><SortTable><thead><tr><th className="select-col"><input type="checkbox" disabled={running} checked={allOn} onChange={() => setIds(allOn ? [] : accounts.map(a => a.id))} aria-label={x.selectAll} /></th><th>{x.account}</th><th>{x.pf.stage}</th><th>{x.pf.next}</th><th>{x.pf.left}</th><th>{x.pf.cards}</th><th>{x.pf.status}</th><th>{x.pf.result}</th></tr></thead>
      <tbody>{grp(accounts, a => {
        const r = p.run?.accounts?.[a.id];
        const i = p.info?.[a.id];
        const teams = openTeams(a.id).slice().sort((m, n) => ((m.off || 0) + (m.def || 0)) - ((n.off || 0) + (n.def || 0)));
        const left = r?.left ?? i?.left;
        return <tr key={a.id} className={r?.status === 'playing' ? 'dp-live' : ''}>
          <td><input type="checkbox" disabled={running} checked={ids.includes(a.id)} onChange={() => setIds(ids.includes(a.id) ? ids.filter(v => v !== a.id) : [...ids, a.id])} aria-label={a.name} /></td>
          <td><b>{a.name}</b></td>
          <td className={i?.stage === 'eliminated' || i?.stage === 'error' ? 'bad-text' : i?.stage === 'champion' ? 'good-text' : ''}>{stageText(i)}</td>
          <td>{i?.stage === 'hof'
            ? <select className="dp-select" value={target(a.id) || ''} onChange={e => setPick(a.id, e.target.value)}><option value="">{x.pf.pickHof}</option>{teams.map(t => <option key={t.id} value={t.id}>{fill(x.pf.hofTeam, { name: t.name, off: t.off ?? '?', def: t.def ?? '?' })}</option>)}</select>
            : i?.stage === 'champion' ? <button className="btn primary small" disabled={busy === a.id || running} onClick={() => createHof(a.id)}>{busy === a.id ? x.checking : x.pf.createHof}</button>
            : (r?.enemy || i?.next?.opponent || '—')}</td>
          <td>{left == null ? '—' : left}</td>
          <td>{i ? <>{i.cards ?? 0}<small className="cell-sub">{fill(x.pf.props, { n: i.propsUsed ?? 0 })}</small></> : '—'}</td>
          <td className={r?.status === 'error' ? 'bad-text' : ''}>{r ? (x.pf.st[r.status] || x.pg.st[r.status] || r.status) + (r.status === 'error' && r.reason ? `: ${r.reason}` : '') : ''}</td>
          <td>{r?.played ? fill(x.pg.wl, { w: r.won, l: r.lost }) : '—'}</td>
        </tr>;
      }, (g, o) => groupHeadRow(g, o, { ids, setIds, disabled: running, select: true, rest: 6 }))}</tbody></SortTable></div>
    <ResetProgress lang={lang} kind="pro" ids={ids} accounts={accounts} running={running} onReset={idList => api.pro.reset(idList)} toast={toast} />
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.pf.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Big 3 · Magic Team (Proving Grounds): the ready trio of each account beats two bots, then the prize.
function MagicTab({ state, x, toast }) {
  const grp = useGroupedRows('dp-magic');
  const m = state.magicTeam || {};
  const accounts = state.accounts || [];
  const running = Boolean(m.running);
  const [ids, setIds] = useSavedIds(state, 'magicAccountIds', accounts);
  const [checking, setChecking] = useState(false);
  const check = async () => { if (!api.magic) return toast(x.notReady, 'error'); setChecking(true); try { await api.magic.status(ids.length ? ids : accounts.map(a => a.id)); } catch (er) { toast(er.message, 'error'); } finally { setChecking(false); } };
  const allOn = accounts.length > 0 && accounts.every(a => ids.includes(a.id));
  const start = async () => { if (!api.magic) return toast(x.notReady, 'error'); try { await api.magic.start(Object.fromEntries(ids.map(id => [id, 'auto']))); } catch (er) { toast(er.message, 'error'); } };
  const st = s => x.pg.magicSt[s] || x.pg.st[s] || s;
  return <>
    <div className="panel pg-bar">
      <button className="btn ghost" disabled={running} onClick={() => setIds(allOn ? [] : accounts.map(a => a.id))}>{allOn ? x.clear : x.selectAll}</button>
      <span className="pg-hint">{x.pg.magicHint}</span>
      <span className="sp" />
      <button className="btn ghost" disabled={checking || running} onClick={check}>{checking ? x.checking : x.pg.refreshMagic}</button>
      {running ? <button className="btn danger-soft" onClick={() => api.magic.stop().catch(er => toast(er.message, 'error'))}>{x.stop}</button>
        : <button className="btn primary" disabled={!ids.length} onClick={start}>{fill(x.pg.start, { n: ids.length })}</button>}
    </div>
    <div className="panel table-panel dp-table"><SortTable><thead><tr><th className="select-col"><input type="checkbox" disabled={running} checked={allOn} onChange={() => setIds(allOn ? [] : accounts.map(a => a.id))} aria-label={x.selectAll} /></th><th>{x.account}</th><th>{x.pg.trio}</th><th>{x.pg.beaten}</th><th>{x.pg.enemy}</th><th>{x.status}</th><th>{x.pg.result}</th></tr></thead>
      <tbody>{grp(accounts, a => {
        const r = m.run?.accounts?.[a.id];
        const teams = m.info?.[a.id]?.teams || [];
        const ready = teams.find(tm => tm.status === 'REWARD') || teams.find(tm => tm.status === 'FIGHTING') || teams.slice().sort((p, q) => q.level - p.level)[0];
        return <tr key={a.id} className={r?.status === 'playing' ? 'dp-live' : ''}>
          <td><input type="checkbox" disabled={running} checked={ids.includes(a.id)} onChange={() => setIds(ids.includes(a.id) ? ids.filter(i => i !== a.id) : [...ids, a.id])} aria-label={a.name} /></td>
          <td><b>{a.name}</b></td>
          <td>{ready ? `${ready.team} · Lv ${ready.level}` : '—'}</td>
          <td>{r?.beaten ?? ready?.botsDefeated ?? '—'}{(r?.beaten ?? ready?.botsDefeated) != null ? '/2' : ''}</td>
          <td>{r?.enemy || '—'}</td>
          <td className={r?.status === 'error' ? 'bad-text' : ''}>{r ? st(r.status) + (r.status === 'error' && r.reason ? `: ${r.reason}` : '') : (ready ? (x.pg.magicState[ready.status] || ready.status) : '')}</td>
          <td>{r?.played ? fill(x.pg.wl, { w: r.won, l: r.lost }) : '—'}</td>
        </tr>;
      }, (g, o) => groupHeadRow(g, o, { ids, setIds, disabled: running, select: true, rest: 5 }))}</tbody></SortTable></div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.pg.magicHow.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Elite Ascent: every chosen account plays its current floor until the attempts are used.
function AscentTab({ state, x, toast, lang }) {
  const grp = useGroupedRows('dp-ascent');
  const e = state.eliteAscent || {};
  const accounts = state.accounts || [];
  const running = Boolean(e.running);
  const [ids, setIds] = useSavedIds(state, 'ascentAccountIds', accounts);
  const [checking, setChecking] = useState(false);
  const check = async () => { if (!api.ascent) return toast(x.notReady, 'error'); setChecking(true); try { await api.ascent.status(ids.length ? ids : accounts.map(a => a.id)); } catch (er) { toast(er.message, 'error'); } finally { setChecking(false); } };
  const allOn = accounts.length > 0 && accounts.every(a => ids.includes(a.id));
  const start = async () => { try { await api.ascent.start(Object.fromEntries(ids.map(id => [id, true]))); } catch (er) { toast(er.message, 'error'); } };
  return <>
    <div className="panel pg-bar">
      <button className="btn ghost" disabled={running} onClick={() => setIds(allOn ? [] : accounts.map(a => a.id))}>{allOn ? x.clear : x.selectAll}</button>
      <span className="pg-hint">{x.pg.ascentHint}</span>
      <span className="sp" />
      <button className="btn ghost" disabled={checking || running} onClick={check}>{checking ? x.checking : x.pg.refreshAscent}</button>
      {running ? <button className="btn danger-soft" onClick={() => api.ascent.stop().catch(er => toast(er.message, 'error'))}>{x.stop}</button>
        : <button className="btn primary" disabled={!ids.length} onClick={start}>{fill(x.pg.start, { n: ids.length })}</button>}
    </div>
    <div className="panel table-panel dp-table"><SortTable><thead><tr><th className="select-col"><input type="checkbox" disabled={running} checked={allOn} onChange={() => setIds(allOn ? [] : accounts.map(a => a.id))} aria-label={x.selectAll} /></th><th>{x.account}</th><th>{x.pg.floor}</th><th>{x.pg.enemy}</th><th>{x.pg.attempts}</th><th>{x.status}</th><th>{x.pg.result}</th></tr></thead>
      <tbody>{grp(accounts, a => {
        const r = e.run?.accounts?.[a.id];
        const info = e.info?.[a.id];
        const left = r?.left ?? info?.left;
        return <tr key={a.id} className={r?.status === 'playing' ? 'dp-live' : ''}>
          <td><input type="checkbox" disabled={running} checked={ids.includes(a.id)} onChange={() => setIds(ids.includes(a.id) ? ids.filter(i => i !== a.id) : [...ids, a.id])} aria-label={a.name} /></td>
          <td><b>{a.name}</b></td>
          <td>{r?.floor ?? info?.floor ?? '—'}{r?.floorStart != null && r?.floor > r.floorStart && <small className="cell-sub good-text">+{r.floor - r.floorStart}</small>}</td>
          <td>{r?.enemy || info?.enemy || '—'}</td>
          <td>{left == null ? '—' : `${left}/2`}</td>
          <td className={r?.status === 'error' ? 'bad-text' : ''}>{r ? (x.pg.st[r.status] || r.status) + (r.status === 'error' && r.reason ? `: ${r.reason}` : '') : ''}</td>
          <td>{r?.played ? fill(x.pg.wl, { w: r.won, l: r.lost }) : '—'}</td>
        </tr>;
      }, (g, o) => groupHeadRow(g, o, { ids, setIds, disabled: running, select: true, rest: 5 }))}</tbody></SortTable></div>
    <ResetProgress lang={lang} kind="ascent" ids={ids} accounts={accounts} running={running} onReset={idList => api.ascent.reset(idList)} toast={toast} />
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.pg.ascentHow.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Props: one button per account; the bag counts update while props are used.
function PropsTab({ state, x, toast }) {
  const grp = useGroupedRows('dp-props');
  const p = state.props || {};
  const accounts = state.accounts || [];
  const [checking, setChecking] = useState(false);
  const read = async () => { if (!api.props) return toast(x.notReady, 'error'); setChecking(true); try { await api.props.bags(accounts.map(a => a.id)); } catch (e) { toast(e.message, 'error'); } finally { setChecking(false); } };
  useEffect(() => { if (api.props) read(); }, []);
  const busy = new Set(p.busy || []);
  // bulk (user 2026-11-09): tick accounts, then use props on all of them at once
  const [sel, setSel] = useState(() => new Set());
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = accounts.length > 0 && accounts.every(a => sel.has(a.id));
  const picked = accounts.filter(a => sel.has(a.id));
  const idle = picked.filter(a => !busy.has(a.id));
  const running = picked.filter(a => busy.has(a.id));
  const runSel = async () => { for (const a of idle) await api.props.run(a.id).catch(e => toast(`${a.name}: ${e.message}`, 'error')); };
  const stopSel = async () => { for (const a of running) await api.props.stop(a.id).catch(() => {}); };
  const status = r => {
    if (!r) return '';
    let txt = x.pr.st[r.status] || r.status;
    if (r.status === 'waitingHalftime' && r.quarter) txt += ` · ${fill(x.pr.quarter, { n: r.quarter })}`;
    if (r.status === 'using' && r.countdown != null) txt += ` · ${fill(x.pr.countdown, { s: r.countdown })}`;
    if (r.status === 'error' && r.message) txt += `: ${r.message}`;
    return txt;
  };
  return <>
    <div className="panel pg-bar"><span className="pg-hint">{x.pr.how[0]}</span><span className="sp" /><button className="btn ghost" disabled={checking} onClick={read}>{checking ? x.checking : x.pr.refresh}</button></div>
    <div className="panel pg-bar">
      <button className="chip" onClick={() => setSel(allOn ? new Set() : new Set(accounts.map(a => a.id)))}>{allOn ? x.pr.clearSel : x.pr.selectAll}</button>
      <span className="sp" />
      {running.length > 0 && <button className="btn danger-soft" onClick={stopSel}>{fill(x.pr.stopSel, { n: running.length })}</button>}
      <button className="btn primary" disabled={!idle.length} onClick={runSel}>{fill(x.pr.runSel, { n: idle.length })}</button>
    </div>
    <div className="panel table-panel dp-table"><SortTable><thead><tr><th className="select-col"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(accounts.map(a => a.id)))} aria-label={x.pr.selectAll} /></th><th>{x.account}</th><th>{x.pr.small}</th><th>{x.pr.medium}</th><th>{x.pr.used}</th><th>{x.status}</th><th>{x.pr.players}</th><th></th></tr></thead>
      <tbody>{grp(accounts, a => {
        const r = p.runs?.[a.id];
        const bag = p.bags?.[a.id];
        const live = r && ['using', 'waitingHalftime', 'finding'].includes(r.status);
        const small = live && r.bagSmall != null ? r.bagSmall : bag?.small;
        const medium = live && r.bagMedium != null ? r.bagMedium : bag?.medium;
        return <tr key={a.id} className={r?.status === 'using' ? 'dp-live' : sel.has(a.id) ? 'selected-row-soft' : ''}>
          <td className="select-col"><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} aria-label={a.name} /></td>
          <td><b>{a.name}</b></td>
          <td className="num">{small ?? '—'}</td>
          <td className="num">{medium ?? '—'}</td>
          <td className="num">{r?.used ? `${r.used.small}×10 · ${r.used.medium}×30` : '—'}</td>
          <td className={['error', 'noMatch', 'late'].includes(r?.status) ? 'bad-text' : r?.status === 'done' ? 'good-text' : ''}>{status(r)}</td>
          <td className="pr-players">{(r?.players || []).map(pl => <span key={pl.id} className={pl.stamina >= 95 ? 'ok' : 'low'} title={`${pl.name}: ${pl.start} → ${pl.stamina}`}>{pl.name.split(' ').slice(-1)[0]} {pl.stamina}</span>)}</td>
          <td className="actions">{busy.has(a.id) ? <button className="btn danger-soft small" onClick={() => api.props.stop(a.id).catch(e => toast(e.message, 'error'))}>{x.pr.stop}</button> : <button className="btn primary small" onClick={() => api.props.run(a.id).catch(e => toast(e.message, 'error'))}>{x.pr.button}</button>}</td>
        </tr>;
      }, (g, o) => groupHeadRow(g, o, { select: false, rest: 7 }))}</tbody></SortTable></div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.pr.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.18); setTimeout(() => ctx.close(), 400);
  } catch {}
}

function QuizCard({ row, x, now }) {
  const q = row.question;
  const asking = row.status === 'askUser' && q;
  const left = row.waitUntil ? Math.max(0, Math.ceil((Date.parse(row.waitUntil) - now) / 1000)) : null;
  const pick = letter => api.quiz.answer(row.accountId, letter).catch(() => {});
  const last = row.last;
  return <div className={`panel dp-quiz-card ${asking ? 'asking' : ''} ${row.status}`}>
    <div className="dp-quiz-head"><b>{row.name}</b><span>{x.qz.st[row.status] || row.status}</span></div>
    <div className="dp-quiz-meta">{row.number ? <span>{fill(x.qz.question, { n: Math.min(row.number, 10) })}</span> : null}<span>{x.qz.correct} {row.correct}</span><span>{x.qz.auto} {row.auto} · {x.qz.user} {row.byUser} · {x.qz.random} {row.random}</span>{row.learned > 0 && <span className="good-text">+{row.learned} {x.qz.learned}</span>}</div>
    {q && <div className="dp-quiz-q">
      <p>{q.text}</p>
      <small className={q.known ? 'good-text' : 'warn-text'}>{q.known ? x.qz.known : x.qz.unknown}{asking && left != null ? ` · ${fill(x.qz.randomIn, { s: left })}` : ''}</small>
      <div className="dp-quiz-options">{LETTERS.map(l => <button key={l} className="btn ghost" disabled={!asking} onClick={() => pick(l)}><b>{l}</b><span>{q.options?.[l]}</span></button>)}</div>
    </div>}
    {last && <div className={`dp-quiz-last ${last.ok ? 'ok' : 'bad'}`}>{last.n}. {last.ok ? x.qz.correct : x.qz.wrong} ({x.qz[last.by] || last.by}: {last.picked}){!last.ok && last.correct ? ` · ${x.qz.rightAnswer}: ${last.correct} ${last.correctText}` : ''}</div>}
    {row.status === 'error' && row.reason && <small className="bad-text">{row.reason}</small>}
  </div>;
}

function QuizTab({ state, x, toast }) {
  const qz = state.quiz || {};
  const accounts = state.accounts || [];
  const running = Boolean(qz.running);
  const [ids, setIds] = useSavedIds(state, 'quizAccountIds', accounts);
  const grp = useGroupedRows('dp-quiz');
  const now = useNow(running);
  const rows = Object.values(qz.run?.accounts || {});
  const asking = rows.filter(r => r.status === 'askUser').map(r => `${r.accountId}:${r.number}`).join('|');
  const prev = useRef('');
  useEffect(() => { if (asking && asking !== prev.current) beep(); prev.current = asking; }, [asking]);
  const start = async () => { if (!api.quiz) return toast(x.notReady, 'error'); try { await api.quiz.start(ids); } catch (e) { toast(e.message, 'error'); } };
  const report = !running ? qz.lastReport : null;
  return <>
    <div className="panel dp-controls dp-row">
      <span className="dp-note">{fill(x.qz.bank, { n: qz.bankSize ?? 0 })}</span>
      <div className="dp-actions">{running ? <button className="btn danger-soft" onClick={() => api.quiz.stop().catch(e => toast(e.message, 'error'))}>{x.stop}</button>
        : <button className="btn primary" disabled={!ids.length} onClick={start}>{fill(x.qz.start, { n: ids.length })}</button>}</div>
    </div>
    <div className="panel dp-section"><AccountPicks accounts={accounts} ids={ids} setIds={setIds} disabled={running} x={x} /></div>
    {running && <div className="dp-quiz-grid">{rows.map(r => <QuizCard key={r.accountId} row={r} x={x} now={now} />)}</div>}
    {report && <div className="panel table-panel dp-table"><SortTable><thead><tr><th>{x.account}</th><th>{x.status}</th><th>{x.qz.correct}</th><th>{x.qz.auto} / {x.qz.user} / {x.qz.random}</th><th>{x.qz.learned}</th></tr></thead>
      <tbody>{grp(asAccounts(report.rows), r => <tr key={r.accountId}><td><b>{r.name}</b></td><td className={r.status === 'error' ? 'bad-text' : ''}>{x.qz.st[r.status] || r.status}{r.reason && r.status === 'error' ? `: ${r.reason}` : ''}</td><td>{r.correct}/10</td><td>{r.auto} / {r.byUser} / {r.random}</td><td>{r.learned}</td></tr>, groupRowOf(5, g => <><td /><td>{g.reduce((n, r) => n + (r.correct || 0), 0)}/{g.length * 10}</td><td /><td>{g.reduce((n, r) => n + (r.learned || 0), 0)}</td></>))}</tbody></SortTable></div>}
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.qz.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

function CheerTab({ state, x, toast }) {
  const accounts = state.accounts || [];
  const mainId = state.accountProfile?.mainAccountId || accounts[0]?.id || '';
  const [targets, setTargets] = useSavedIds(state, 'cheerTargetIds', accounts, [state.settings?.cheerTargetId || mainId].filter(Boolean));
  const [ids, setIds] = useSavedIds(state, 'cheerAccountIds', accounts, accounts.filter(a => a.id !== mainId).map(a => a.id));
  const from = ids;
  const cs = state.cheer || {};
  const run = cs.run;
  const runLive = run?.status === 'running';
  const busy = Boolean(cs.busy);
  const last = cs.last;
  const daily = cs.daily || 3;
  const left = id => (cs.left ? cs.left[id] ?? daily : null);
  const entries = [...(cs.entries || [])].reverse();
  const grp = useGroupedRows('dp-cheer');
  const nameOf = id => accounts.find(a => a.id === id)?.name || '';
  const start = async () => {
    if (!api.cheer?.start) return toast(x.notReady, 'error');
    try { await api.cheer.start(from, targets); } catch (e) { toast(e.message, 'error'); }
  };
  return <>
    <div className="panel dp-controls dp-row">
      <div className="dp-actions">{runLive ? <button className="btn danger-soft" onClick={() => api.cheer.stop().catch(e => toast(e.message, 'error'))}>{x.ch.stop}</button>
        : <button className="btn primary" disabled={busy || !from.length || !targets.length} onClick={start}>{fill(x.ch.start, { t: targets.length, n: from.length })}</button>}</div>
    </div>
    <div className="panel dp-section"><b className="dp-label">{x.ch.targets}</b><AccountPicks accounts={accounts} ids={targets} setIds={setTargets} disabled={busy} x={x} extra={a => a.id === mainId ? <em>{x.ch.main}</em> : null} /></div>
    <div className="panel dp-section"><b className="dp-label">{x.ch.from}</b><AccountPicks accounts={accounts} ids={from} setIds={setIds} disabled={busy} x={x} extra={a => <em className={left(a.id) === 0 ? 'zero' : ''}>{left(a.id) == null ? '—' : `${left(a.id)}/${daily}`}</em>} /></div>
    {run && <div className="panel table-panel dp-table">
      <div className="dp-table-head"><b>{x.ch.run}</b><span>{new Date(run.at).toLocaleTimeString()}{run.finishedAt ? ` → ${new Date(run.finishedAt).toLocaleTimeString()}` : ''}</span></div>
      <SortTable><thead><tr><th>{x.ch.target2}</th><th>{x.status}</th><th>{x.ch.morale}</th><th>{x.ch.sent}</th></tr></thead><tbody>{Object.entries(run.targets || {}).map(([id, r]) => <tr key={id} className={r.status === 'cheering' ? 'dp-live' : ''}>
        <td><b>{r.name}</b></td>
        <td className={['error', 'noMatch'].includes(r.status) ? 'bad-text' : r.status === 'full' ? 'good-text' : ''}>{x.ch.rst[r.status] || r.status}{r.quarter ? ` · ${fill(x.ch.quarter, { n: r.quarter })}` : ''}{r.error ? `: ${r.error}` : ''}</td>
        <td>{r.morale == null ? '—' : <span className="ch-morale"><i style={{ width: `${Math.min(100, r.morale / 2)}%` }} /><b>{r.morale}/200</b></span>}</td>
        <td className="num">{r.sent}</td>
      </tr>)}</tbody></SortTable>
    </div>}
    <div className="panel dp-section">
      <div className="dp-table-head dp-flush"><b>{x.ch.rights}</b><small className="muted-text">{cs.resetAt ? fill(x.ch.resetAt, { t: new Date(cs.resetAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }) : ''}</small></div>
      <div className="dp-rights">{accounts.map(a => { const n = left(a.id); return <div key={a.id} className={`dp-right ${n === 0 ? 'zero' : ''}`}><span>{a.name}</span><b>{n == null ? '—' : `${n}/${daily}`}</b></div>; })}</div>
      <small className="muted-text">{fill(x.ch.leftHint, { n: daily })}</small>
    </div>
    {last && <div className="panel table-panel dp-table">
      <div className="dp-table-head"><b>{x.ch.result}</b><span>{new Date(last.at).toLocaleTimeString()} · {last.targetName}{last.side ? ` · ${x.ch.side[last.side] || last.side}` : ''}</span></div>
      {last.error === 'noMatch' ? <p className="bad-text dp-pad">{fill(x.ch.noMatch, { name: last.targetName })}</p>
        : last.error && !last.rows?.length ? <p className="bad-text dp-pad">{last.error}</p>
        : <SortTable><thead><tr><th>{x.account}</th><th>{x.status}</th><th></th></tr></thead><tbody>{grp(asAccounts(last.rows), r => <tr key={r.accountId}><td><b>{r.name}</b></td><td className={r.ok ? 'good-text' : 'bad-text'}>{r.ok ? x.ch.ok : r.message === 'noCheersLeft' ? x.ch.noneLeft : x.ch.fail}</td><td>{r.message === 'noCheersLeft' ? '' : r.message}</td></tr>, groupRowOf(3, g => <><td className="good-text">{g.filter(r => r.ok).length}/{g.length}</td><td /></>))}</tbody></SortTable>}
    </div>}
    <div className="panel table-panel dp-table">
      <div className="dp-table-head"><b>{x.ch.today}</b><small className="muted-text">{cs.day || ''}</small></div>
      {entries.length ? <SortTable><thead><tr><th>{x.ch.time}</th><th>{x.account}</th><th>{x.ch.target2}</th><th>{x.status}</th><th></th></tr></thead><tbody>{entries.map((e, i) => <tr key={i}><td>{new Date(e.at).toLocaleTimeString()}</td><td><b>{e.name || '—'}</b></td><td>{e.target}</td><td className={e.ok ? 'good-text' : 'bad-text'}>{e.ok ? x.ch.ok : e.message === 'noMatch' ? fill(x.ch.noMatch, { name: e.target }) : e.message === 'noCheersLeft' ? x.ch.noneLeft : x.ch.fail}</td><td>{['noMatch', 'noCheersLeft'].includes(e.message) ? '' : e.message}</td></tr>)}</tbody></SortTable>
        : <p className="muted-text dp-pad">{x.ch.noneToday}</p>}
    </div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.ch.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

function ChatTab({ state, x, toast }) {
  const accounts = state.accounts || [];
  const cs = state.chat || {};
  const limits = cs.limits || { minIntervalSec: 11, maxText: 50 };
  const running = Boolean(cs.running);
  const saved = state.settings?.chatConfig || {};
  const [messages, setMessages] = useState(() => (saved.messages?.length ? saved.messages : [{ text: '', accountId: state.accountProfile?.mainAccountId || accounts[0]?.id || '' }]));
  const [intervalSec, setIntervalSec] = useState(saved.intervalSec ?? 15);
  const [infinite, setInfinite] = useState(saved.infinite === true);
  const [loops, setLoops] = useState(saved.loops ?? 20);
  const now = useNow(running);
  const config = { messages, intervalSec: Number(intervalSec), infinite, loops: Number(loops) };
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) { firstSave.current = false; return; }
    const t = setTimeout(() => api.settings.update({ chatConfig: config }).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [JSON.stringify(config)]);
  const upd = (i, patch) => setMessages(m => m.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const move = (i, d) => setMessages(m => { const n = [...m]; const j = i + d; if (j < 0 || j >= n.length) return m; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const tooShort = !(Number(intervalSec) >= limits.minIntervalSec);
  const valid = messages.some(m => m.text.trim() && m.accountId) && !tooShort && (infinite || Number(loops) >= 1);
  const start = async () => { if (!api.chat) return toast(x.notReady, 'error'); try { await api.chat.start(config); } catch (e) { toast(e.message, 'error'); } };
  const run = cs.run;
  const name = id => accounts.find(a => a.id === id)?.name || id;
  return <>
    <div className="panel dp-section">
      <div className="dp-table-head"><b>{x.cs.messages}</b><small className="muted-text">{fill(x.cs.maxHint, { n: limits.maxText })}</small></div>
      <div className="dp-chat-list">{messages.map((m, i) => <div key={i} className={`dp-chat-row ${run && run.index === i ? 'current' : ''}`}>
        <span className="dp-chat-n">{i + 1}</span>
        <input value={m.text} maxLength={limits.maxText} disabled={running} placeholder={x.cs.text} onChange={e => upd(i, { text: e.target.value.slice(0, limits.maxText) })} />
        <small className="dp-chat-count">{m.text.length}/{limits.maxText}</small>
        <select value={m.accountId} disabled={running} onChange={e => upd(i, { accountId: e.target.value })}><option value="">{x.cs.pickAccount}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="icon-btn" disabled={running || i === 0} onClick={() => move(i, -1)}>↑</button>
        <button className="icon-btn" disabled={running || i === messages.length - 1} onClick={() => move(i, 1)}>↓</button>
        <button className="icon-btn danger" disabled={running || messages.length < 2} onClick={() => setMessages(ms => ms.filter((_, j) => j !== i))}>×</button>
      </div>)}</div>
      <button className="btn ghost small" disabled={running} onClick={() => setMessages(ms => [...ms, { text: '', accountId: ms[ms.length - 1]?.accountId || '' }])}>+ {x.cs.add}</button>
    </div>
    <div className="panel dp-controls dp-row">
      <label><span>{x.cs.interval}</span><input type="number" min={limits.minIntervalSec} value={intervalSec} disabled={running} className={tooShort ? 'invalid' : ''} onChange={e => setIntervalSec(e.target.value)} /></label>
      <label className="dp-check"><input type="radio" checked={!infinite} disabled={running} onChange={() => setInfinite(false)} /><span>{x.cs.loopCount}</span><input type="number" min="1" value={loops} disabled={running || infinite} onChange={e => setLoops(e.target.value)} /></label>
      <label className="dp-check"><input type="radio" checked={infinite} disabled={running} onChange={() => setInfinite(true)} /><span>{x.cs.infinite}</span></label>
      <div className="dp-actions">{running ? <button className="btn danger-soft" onClick={() => api.chat.stop().catch(e => toast(e.message, 'error'))}>{x.stop}</button>
        : <button className="btn primary" disabled={!valid} onClick={start}>{x.cs.start}</button>}</div>
      <small className={`dp-hint ${tooShort ? 'bad-text' : 'muted-text'}`}>{fill(x.cs.minHint, { n: limits.minIntervalSec })}</small>
    </div>
    {run && <div className="panel dp-section dp-chat-live">
      <span>{fill(x.cs.loop, { a: run.loop, b: run.config.infinite ? '∞' : run.config.loops })}</span>
      <span>{fill(x.cs.message, { a: run.index + 1, b: run.config.messages.length })}</span>
      <b>{run.status === 'waiting' && run.nextAt ? fill(x.cs.next, { t: mmss(Date.parse(run.nextAt) - now) }) : run.status === 'sending' ? x.cs.sending : ''}</b>
      <span className="good-text">{x.cs.sent} {run.sent}</span><span className={run.failed ? 'bad-text' : ''}>{x.cs.failed} {run.failed}</span>
      {Object.keys(run.blocked || {}).length > 0 && <span className="bad-text">{x.cs.blocked}: {Object.keys(run.blocked).map(name).join(', ')}</span>}
    </div>}
    <ChatFeed state={state} x={x} />
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.cs.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// The game's global chat as it comes in (kept two days by the app); our accounts stand out.
// A prize of today's total: click → which accounts won it (outside click / Esc / Kapat closes).
function PrizePop({ p, x }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const who = [...p.who.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'tr'));
  return <span className="tn-pop-wrap" ref={ref}>
    <button type="button" className={`ds-prize ds-prize-btn ${RARITY_TONE[p.rarity] || ''}`} onClick={() => setOpen(v => !v)} aria-expanded={open}>{p.name} <b>×{p.n}</b></button>
    {open && <div className="tn-pop" role="dialog" aria-label={p.name}>
      <div className="tn-pop-head"><b>{p.name}</b><small>{fill(x.ds.whoCount, { n: who.length })}</small></div>
      <ul>{who.map(([name, n]) => <li key={name}><b>{name}</b>{n > 1 && <small> ×{n}</small>}</li>)}</ul>
      <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>{x.ds.close}</button>
    </div>}
  </span>;
}

// Daily Slot: one spin a day on every account, the three prizes of each.
const RARITY_TONE = { COMMON: 'r-common', UNCOMMON: 'r-uncommon', RARE: 'r-rare', EPIC: 'r-epic', LEGENDARY: 'r-legendary', MYTHIC: 'r-mythic' };
function SlotTab({ state, x, toast }) {
  const d = x.ds;
  const accounts = state.accounts || [];
  const ds = state.dailySlot || {};
  const rows = ds.rows || {};
  const [ids, setIds] = useSavedIds(state, 'dailySlotAccountIds', accounts, accounts.map(a => a.id));
  const busy = Boolean(ds.running);
  const grp = useGroupedRows('dp-slot');
  const go = fn => fn().catch(e => toast(e.message, 'error'));
  const today = Object.values(rows).map(r => r.dayKey).filter(Boolean).sort().pop();
  const shown = accounts.filter(a => rows[a.id]);
  const spunToday = shown.filter(a => rows[a.id].status === 'spun' && (!today || rows[a.id].dayKey === today)).length;
  const totals = new Map();
  for (const a of shown) if (rows[a.id].status === 'spun') for (const p of rows[a.id].results || []) { const cur = totals.get(p.name) || { ...p, n: 0, who: new Map() }; cur.n++; cur.who.set(a.name, (cur.who.get(a.name) || 0) + 1); totals.set(p.name, cur); }
  const last = ds.lastRun;
  return <>
    <div className="panel dp-controls dp-row">
      <small className="muted-text dp-grow">{d.hint}</small>
      <div className="dp-actions">
        <button className="btn ghost" disabled={busy || !ids.length} onClick={() => go(() => api.dailySlot.scan(ids))}>{d.scan}</button>
        {busy ? <button className="btn danger-soft" onClick={() => go(() => api.dailySlot.stop())}>{d.stop}</button>
          : <button className="btn primary" disabled={!ids.length} onClick={() => go(() => api.dailySlot.spin(ids))}>{fill(d.spin, { n: ids.length })}</button>}
      </div>
    </div>
    <div className="panel dp-section"><b className="dp-label">{d.accounts}</b><AccountPicks accounts={accounts} ids={ids} setIds={setIds} disabled={busy} x={x} extra={a => rows[a.id]?.status === 'spun' ? <em>✓</em> : null} /></div>
    {totals.size > 0 && <div className="panel dp-section"><b className="dp-label">{d.totals}</b><div className="ds-totals">{[...totals.values()].sort((a, b) => b.n - a.n).map(p => <PrizePop key={p.name} p={p} x={x} />)}</div></div>}
    <div className="panel table-panel dp-table">
      <div className="dp-table-head"><b>{fill(d.tally, { spun: spunToday, total: shown.length })}</b>{last?.finishedAt && <span>{new Date(last.finishedAt).toLocaleTimeString()}{last.kind === 'spin' ? ` · ${fill(d.summary, last)}` : ''}</span>}</div>
      {!shown.length ? <p className="muted-text dp-pad">{d.none}</p> :
        <SortTable><thead><tr><th>{d.account}</th><th>{d.status}</th><th>{d.prizes}</th><th>{d.when}</th></tr></thead>
          <tbody>{grp(shown, a => { const r = rows[a.id]; return <tr key={a.id} className={['reading', 'spinning'].includes(r.status) ? 'dp-live' : ''}>
            <td><b>{a.name}</b></td>
            <td><span className={`pill ${r.status === 'spun' ? 'ok' : r.status === 'error' ? 'bad' : r.status === 'ready' ? 'warn' : 'muted'}`}><i />{d.st[r.status] || r.status}</span>{r.error && <small className="cell-sub bad-text">{r.error === 'inMatch' ? d.inMatch : r.error}</small>}</td>
            <td>{(r.results || []).length ? <span className="ds-prizes">{r.results.map((p, i) => <span key={i} className={`ds-prize ${RARITY_TONE[p.rarity] || ''}`}>{p.name}</span>)}</span> : '—'}</td>
            <td>{r.spunAt ? new Date(r.spunAt).toLocaleTimeString() : '—'}</td>
          </tr>; }, groupRowOf(4, g => <><td>{g.filter(a => rows[a.id].status === 'spun').length}/{g.length}</td><td /><td /></>))}</tbody></SortTable>}
    </div>
    {ds.pool?.length > 0 && <details className="panel dp-section"><summary>{d.pool}</summary><div className="ds-totals">{ds.pool.map(p => <span key={p.name} className={`ds-prize ${RARITY_TONE[p.rarity] || ''}`}>{p.name} <b>%{p.chancePct}</b></span>)}</div></details>}
  </>;
}

function ChatFeed({ state, x }) {
  const feed = state.chatFeed || [];
  const mine = new Set((state.accounts || []).map(a => String(a.name).toLowerCase()));
  const [q, setQ] = useState('');
  const box = useRef(null);
  const atEnd = useRef(true);
  const shown = q.trim() ? feed.filter(m => `${m.teamName} ${m.text}`.toLowerCase().includes(q.trim().toLowerCase())) : feed;
  useEffect(() => { if (atEnd.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown.length]);
  const day = ts => new Date(ts).toDateString() === new Date().toDateString();
  return <div className="panel cs-feed">
    <div className="cs-feed-head"><b>{x.cs.feed}</b><span>{x.cs.feedHint}</span><input id="cs-feed-q" placeholder={x.cs.feedSearch} value={q} onChange={e => setQ(e.target.value)} /></div>
    <div className="cs-feed-list" ref={box} onScroll={e => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {!shown.length ? <div className="empty">{x.cs.feedEmpty}</div> : shown.map(m => <div key={`${m.userId}-${m.timestamp}`} className={`cs-msg ${mine.has(String(m.teamName).toLowerCase()) ? 'mine' : ''}`}>
        <time>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{day(m.timestamp) ? '' : ` · ${new Date(m.timestamp).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}`}</time>
        <b>{m.teamName}</b>{m.title && <em>{m.title}</em>}<span>{m.text}</span>
      </div>)}
    </div>
  </div>;
}

// "Toplu Başlat" (user 2026-11-24): the daily systems one after another on the chosen accounts
const BATCH_TAB = { slot: 'slot', quiz: 'quiz', goup: 'goup', ascent: 'ascent', magic: 'magic', boss: 'boss', pro: 'pro', tower: 'tower' };
function BatchTab({ state, x, toast }) {
  const b = state.dailyBatch || {};
  const cfg = b.config || { order: [], enabled: {}, accountIds: [] };
  const run = b.run;
  const running = Boolean(run?.running);
  const accounts = state.accounts || [];
  const ids = cfg.accountIds.filter(id => accounts.some(a => a.id === id));
  // per system its own accounts (user 2026-11-24); none = the shared list
  const by = cfg.accountsBy || {};
  const idsOf = id => (Array.isArray(by[id]) ? by[id].filter(v => accounts.some(a => a.id === v)) : ids);
  const [editing, setEditing] = useState(null);
  const save = patch => api.dailyBatch.config(patch).catch(e => toast(e.message, 'error'));
  const move = (i, d) => { const o = [...cfg.order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ order: o }); };
  const on = cfg.order.filter(id => cfg.enabled[id]);
  const total = new Set(on.flatMap(idsOf)).size;
  const ready = on.length > 0 && on.every(id => idsOf(id).length > 0);
  const rowOf = id => (run?.steps || []).find(r => r.id === id);
  const name = id => x.tabs[BATCH_TAB[id]] || id;
  return <>
    <div className="dp-toolbar"><div className="panel dp-controls"><b>{x.batch.title}</b>
      {running && <span className="pill ok"><i />{fill(x.batch.running, { name: name(run.current) })}</span>}
      {!running && run?.finishedAt && <span className="pill muted"><i />{x.batch.finished}</span>}
      <div className="dp-actions">{running ? <button className="btn danger-soft" onClick={() => api.dailyBatch.stop().catch(e => toast(e.message, 'error'))}>{x.batch.stop}</button>
        : <button className="btn primary" disabled={!ready} onClick={() => api.dailyBatch.start({ accountIds: ids }).catch(e => toast(e.message, 'error'))}>{fill(x.batch.start, { n: on.length, a: total })}</button>}</div></div></div>
    <div className="panel dp-section"><small className="muted-text">{x.batch.hint}</small></div>
    <div className="panel table-panel dp-table"><SortTable><thead><tr><th>{x.batch.order}</th><th /><th>{x.batch.accs}</th><th>{x.status}</th><th /></tr></thead>
      <tbody>{cfg.order.map((id, i) => { const r = rowOf(id); return <tr key={id} className={run?.current === id ? 'dp-live' : ''}>
        <td className="num">{i + 1}</td>
        <td><label className="switchline"><input type="checkbox" disabled={running} checked={Boolean(cfg.enabled[id])} onChange={e => save({ enabled: { ...cfg.enabled, [id]: e.target.checked } })} /><b>{name(id)}</b></label></td>
        <td><button className={`btn small ${Array.isArray(by[id]) ? 'primary' : 'ghost'}`} disabled={running} onClick={() => setEditing(id)}>{fill(Array.isArray(by[id]) ? x.batch.accOwn : x.batch.accShared, { n: idsOf(id).length })}</button></td>
        <td className={r?.status === 'error' ? 'bad-text' : ''}>{r ? `${x.batch.st[r.status] || r.status}${r.error ? ': ' + r.error : ''}` : '—'}</td>
        <td><button className="btn ghost small" disabled={running || i === 0} title={x.batch.up} onClick={() => move(i, -1)}>▲</button> <button className="btn ghost small" disabled={running || i === cfg.order.length - 1} title={x.batch.down} onClick={() => move(i, 1)}>▼</button></td>
      </tr>; })}</tbody></SortTable></div>
    <div className="panel dp-section"><b>{x.batch.sharedTitle}</b> <small className="muted-text">{x.batch.sharedHint}</small>
      <AccountPicks accounts={accounts} ids={ids} setIds={next => save({ accountIds: typeof next === 'function' ? next(ids) : next })} disabled={running} x={x} /></div>
    {editing && <div className="modal-backdrop" onClick={() => setEditing(null)}><div className="modal dp-batch-accs" onClick={e => e.stopPropagation()}>
      <h3>{fill(x.batch.accTitle, { name: name(editing) })}</h3>
      <small className="muted-text">{x.batch.accHint}</small>
      <AccountPicks accounts={accounts} ids={idsOf(editing)} setIds={next => { const list = typeof next === 'function' ? next(idsOf(editing)) : next; save({ accountsBy: { [editing]: list } }); }} disabled={running} x={x} />
      <div className="modal-actions">
        {Array.isArray(by[editing]) && <button className="btn ghost" onClick={() => save({ accountsBy: { [editing]: null } })}>{x.batch.accUseShared}</button>}
        <button className="btn primary" onClick={() => setEditing(null)}>{x.batch.accDone}</button>
      </div>
    </div></div>}
  </>;
}

// tabs a shared edition leaves out (their code is removed from that build)
const DAILY_HIDDEN = new Set();
//@only(basic) DAILY_HIDDEN.add('rotation');

export default function DailyPage({ state, t, toast, refresh, tab: openTab = null }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [tab, setTab] = useState(() => openTab || state.settings?.dailyTab || 'goup');
  const choose = id => { setTab(id); api.settings.update({ dailyTab: id }).catch(() => {}); };
  const live = { batch: state.dailyBatch?.run?.running, rotation: (state.rotation?.live || []).length > 0, pvp: state.pvp?.running, tower: state.tower?.running, pro: state.professional?.running, props: (state.props?.busy || []).length > 0, boss: state.dailyBoss?.running, ascent: state.eliteAscent?.running, magic: state.magicTeam?.running, goup: state.goup?.running, quiz: state.quiz?.running, cheer: state.cheer?.busy, chat: state.chat?.running, slot: state.dailySlot?.running };
  const asking = Object.values(state.quiz?.run?.accounts || {}).some(r => r.status === 'askUser');
  return <div className="page daily-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div></div>
    <div className="dp-tabs">{Object.keys(x.tabs).filter(id => !DAILY_HIDDEN.has(id)).map(id => <button key={id} className={tab === id ? 'active' : ''} onClick={() => choose(id)}>{x.tabs[id]}{live[id] && <i className={`dp-dot ${id === 'quiz' && asking ? 'ask' : ''}`} />}</button>)}</div>
    {tab === 'batch' && <BatchTab state={state} x={x} toast={toast} />}
    {tab === 'goup' && <GoUpTab state={state} x={x} toast={toast} />}
    {tab === 'pro' && <ProTab state={state} x={x} toast={toast} lang={t.lang} />}
    {tab === 'boss' && <BossTab state={state} x={x} toast={toast} />}
    {tab === 'ascent' && <AscentTab state={state} x={x} toast={toast} lang={t.lang} />}
    {tab === 'magic' && <MagicTab state={state} x={x} toast={toast} />}
    {tab === 'props' && <PropsTab state={state} x={x} toast={toast} />}
    {tab === 'quiz' && <QuizTab state={state} x={x} toast={toast} />}
    {tab === 'cheer' && <CheerTab state={state} x={x} toast={toast} />}
    {tab === 'chat' && <ChatTab state={state} x={x} toast={toast} />}
    {tab === 'slot' && <SlotTab state={state} x={x} toast={toast} />}
    {tab === 'pvp' && <div className="embedded-page"><PvpPage state={state} t={t} toast={toast} refresh={refresh} /></div>}
    {tab === 'tower' && <div className="embedded-page"><TowerPage state={state} t={t} toast={toast} /></div>}
    {tab === 'rotation' && <><RotationModes state={state} t={t} toast={toast} /><RotationLive state={state} t={t} toast={toast} /></>}{/* @strip(basic) */}
  </div>;
}
