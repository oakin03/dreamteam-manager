import { useEffect, useRef, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const num = v => (v == null ? '—' : Number(v).toLocaleString());
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const LETTERS = ['A', 'B', 'C', 'D'];

const TEXT = {
  tr: {
    title: 'Günlük İşler', howTitle: 'Nasıl çalışır?', subtitle: 'Go-up, Professional, Daily Boss, Elite Ascent, Prop, Daily Quiz, Cheer ve Chat · hepsi tarayıcı açmadan',
    pf: {"title":"Professional","start":"Başlat ({n})","refresh":"Durumları oku","stage":"Aşama","next":"Sıradaki rakip","left":"Kalan maç","cards":"Maç kartı","status":"Durum","result":"Sonuç","hint":"Sezon ve playoff otomatik oynanır. Hall of Fame'de rakibi sen seçersin.","createHof":"Hall of Fame'i başlat","pickHof":"Rakip seç","hofTeam":"{name} (Ofans {off} · Defans {def})","props":"Props {n}/2","stg":{"noSeason":"Sezon yok · başlatılacak","season":"Sezon {p}/{t} · {w}-{l}","noPlayoffs":"Sezon bitti · playoff kurulacak","playoffs":"Playoff · {round} · seri {w}-{l}","champion":"Şampiyon · Hall of Fame hazır","eliminated":"Playoff'ta elendi","hof":"Hall of Fame · {d}/{t} yenildi","hofDone":"Hall of Fame tamam · Honor Way açılacak","seasonOver":"Sezon bitti · yeni sezon kurulacak","honor":"Honor Way · {d}/{t} yenildi","honorDone":"Honor Way tamam · Legacy Way açılacak","legacy":"Legacy Way · {d}/{t} yenildi","legacyDone":"Legacy Way tamam","error":"Okunamadı"},"rounds":{"FIRST_ROUND":"1. tur","CONFERENCE_SEMIFINALS":"Konferans yarı finali","CONFERENCE_FINALS":"Konferans finali","NBA_FINALS":"Final"},"st":{"eliminated":"Elendi","champion":"Şampiyon","needPick":"Rakip seçilmeli","hofDone":"HOF tamam","legacyDone":"Legacy Way tamam"},"how":["Her hesabın aşaması otomatik bulunur: sezon yoksa konferans rastgele seçilip 82 maçlık sezon kurulur; sezon bitince playoff kurulur ve sıradaki playoff maçı oynanır.","Günlük maç hakkı bitene kadar oynar. Hak bitince, varsa oyundan kazanılan Prof Match Card ile \"Props\" yenilemesi yapılır (günde en fazla 2). TIX ile yenileme asla yapılmaz.","Hall of Fame'deki hesaplarda rakipler hücum/savunma toplamlarıyla listelenir; hangi rakiple oynanacağını sen seçersin. O rakip yenilince durur ve yeni seçim bekler.","Playoff'ta elenen hesapta playoff otomatik sıfırlanır ve normal sezona dönülür. Hall of Fame bitince Honor Way, o da bitince Legacy Way açılır; bunlarda rakip sırası oyunda sabittir, sırayla oynanır. Auto Play bu hesaplarda durdurulur, bitince yeniden başlatılır."]},
    tabs: { goup: 'Go-up', pro: 'Professional', boss: 'Daily Boss', ascent: 'Elite Ascent', props: 'Prop', quiz: 'Daily Quiz', cheer: 'Cheer', chat: 'Chat' },
    pr: {
      button: 'Prop bas', stop: 'Durdur', refresh: 'Çantaları oku', small: 'Su şişesi küçük (+10)', medium: 'Su şişesi orta (+30)', used: 'Kullanılan', players: 'İlk 5',
      st: { finding: 'Maç aranıyor', noMatch: 'Takım maçta değil', late: '3./4. periyotta · devre arası geçti', waitingHalftime: 'Devre arası bekleniyor', using: 'Prop basılıyor', done: 'Bitti', error: 'Hata', stopped: 'Durduruldu' },
      quarter: '{n}. periyot', countdown: 'devre arası {s} sn',
      how: ['Her hesabın kendi "Prop bas" düğmesi var. Takım maçta değilse "takım maçta değil" der; maç 3. ya da 4. periyottaysa devre arası geçtiği için basmaz.', '1. ya da 2. periyottaysa devre arasını bekler. Devre arasında (20 sn) ilk 5\'teki her oyuncuyu staminası 95 ve üstü olana kadar doldurur: önce +10\'luk, +10 bitince staminası 85 ve altındaysa +30\'luk.', 'Sadece tek oyunculuk su şişeleri kullanılır; takım prop\'ları ve büyük şişe kullanılmaz. Bitince sonuç Aktivite\'ye yazılır ve maç ekranından çıkılır.']
    },
    pg: {
      start: 'Başlat ({n})', include: 'Oynasın', level: 'Lv', boss: 'Boss', attempts: 'Kalan hak', result: 'Sonuç', floor: 'Kat', enemy: 'Rakip',
      applyAll: 'Hepsine uygula', best: 'Her hesaba en güçlü uygun boss', needs: 'Lv {n} gerekir', noBoss: 'Uygun boss yok', wl: '{w} G · {l} M',
      refreshAscent: 'Katları oku', ascentHint: 'Katları okumak için hesaplara kısa süreliğine giriş yapılır; o hesap oyunda açıksa oradan çıkış yapılır.',
      st: { queued: 'Sırada', login: 'Bağlanıyor', starting: 'Maç başlatılıyor', playing: 'Maçta', otherMatch: 'Başka maçta · bekliyor', waitingGame: 'Oyun bekleniyor', done: 'Bitti', noAttempts: 'Hak yok', locked: 'Seviye yetmiyor', error: 'Hata', stopped: 'Durduruldu' },
      bossHow: ['Her hesap seçtiğin boss ile günlük 2 hakkını bitirene kadar oynar; rakip bot olduğu için sıra beklenmez.', 'Her boss bir seviye ister; seviyesi yetmeyen hesapta o boss seçilemez.', 'Başlarken bu hesaplardaki Auto Play durdurulur, bitince yeniden başlatılır. Hak 19:10\'da yenilenir.'],
      ascentHow: ['Her hesap bulunduğu kattaki botla oynar; kazanırsa bir üst kata çıkar. Günlük 2 bedava hak bitene kadar devam eder.', 'Ücretli haklar asla satın alınmaz ve kullanılmaz.', 'Elite Ascent hesaba giriş ister: o hesap oyunda açıksa oradan çıkış yapılır. Auto Play durdurulur, bitince yeniden başlatılır.']
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
      target: 'Cheer atılacak hesap', from: 'Cheer atacak hesaplar', send: 'Şimdi Cheer at ({n})', sending: 'Gönderiliyor…', main: 'ANA',
      noMatch: '{name} şu an bir maçta değil · maç bulunamadı, Cheer atılmadı.', result: 'Son Cheer', rights: 'Bugünkü Cheer hakları', resetAt: '{t} sıfırlanır', today: 'Bugünün Cheer kaydı', noneToday: 'Bugün henüz Cheer atılmadı.', noneLeft: 'Hak bitti', time: 'Saat', target2: 'Hedef', leftHint: 'Oyun kalan hakkı göstermiyor; uygulama hesap başına günde {n} hak sayar, oyun "limit" derse o hesap 0 olur.', ok: 'Atıldı', fail: 'Atılamadı', side: { host: 'ev sahibi takım', opponent: 'deplasman takımı' },
      how: ['Seçilen hesap o an hangi maçtaysa (Auto Play, Kule, PVP…) o maçta kendi takımına Cheer atılır (+5 moral). Maçta değilse hiçbir şey gönderilmez.', 'Her hesabın günde yaklaşık 3 Cheer hakkı var; hak bitince oyunun verdiği hata yazılır.', 'Çantadaki Cheer eşyası asla kullanılmaz; yalnızca maç ekranındaki ücretsiz Cheer.']
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
    title: 'Daily', howTitle: 'How does it work?', subtitle: 'Go-up, Professional, Daily Boss, Elite Ascent, Props, Daily Quiz, Cheer and Chat · all without a browser',
    pf: {"title":"Professional","start":"Start ({n})","refresh":"Read status","stage":"Stage","next":"Next opponent","left":"Matches left","cards":"Match cards","status":"Status","result":"Result","hint":"Season and playoffs are played automatically. In the Hall of Fame you pick the opponent.","createHof":"Start the Hall of Fame","pickHof":"Pick an opponent","hofTeam":"{name} (Offense {off} · Defense {def})","props":"Props {n}/2","stg":{"noSeason":"No season · will be started","season":"Season {p}/{t} · {w}-{l}","noPlayoffs":"Season over · playoffs will be created","playoffs":"Playoffs · {round} · series {w}-{l}","champion":"Champion · Hall of Fame ready","eliminated":"Eliminated in the playoffs","hof":"Hall of Fame · {d}/{t} beaten","hofDone":"Hall of Fame done · Honor Way will open","seasonOver":"Season over · a new season will be created","honor":"Honor Way · {d}/{t} beaten","honorDone":"Honor Way done · Legacy Way will open","legacy":"Legacy Way · {d}/{t} beaten","legacyDone":"Legacy Way done","error":"Could not be read"},"rounds":{"FIRST_ROUND":"Round 1","CONFERENCE_SEMIFINALS":"Conference semifinals","CONFERENCE_FINALS":"Conference finals","NBA_FINALS":"Finals"},"st":{"eliminated":"Eliminated","champion":"Champion","needPick":"Pick an opponent","hofDone":"HOF done","legacyDone":"Legacy Way done"},"how":["Every account's stage is found automatically: with no season a random conference is chosen and the 82-game season is created; after the season the playoffs are created and the next playoff game is played.","It plays until the daily matches are used. Then, if there is a Prof Match Card won in the game, a \"Props\" refill is used (at most 2 a day). TIX refills are never used.","Accounts in the Hall of Fame list the opponents with their offense/defense totals; you pick who to play. When that opponent is beaten it stops and waits for a new pick.","An account eliminated in the playoffs gets its playoffs reset automatically and goes back to the regular season. After the Hall of Fame the Honor Way opens, after that the Legacy Way; their opponents come in a fixed order and are played in turn. Auto Play is stopped on these accounts and started again afterwards."]},
    tabs: { goup: 'Go-up', pro: 'Professional', boss: 'Daily Boss', ascent: 'Elite Ascent', props: 'Props', quiz: 'Daily Quiz', cheer: 'Cheer', chat: 'Chat' },
    pr: {
      button: 'Use props', stop: 'Stop', refresh: 'Read bags', small: 'Water Bottle Small (+10)', medium: 'Water Bottle Medium (+30)', used: 'Used', players: 'Starters',
      st: { finding: 'Finding the match', noMatch: 'The team is not in a match', late: 'Quarter 3/4 · halftime is over', waitingHalftime: 'Waiting for halftime', using: 'Using props', done: 'Done', error: 'Error', stopped: 'Stopped' },
      quarter: 'quarter {n}', countdown: 'halftime {s} s',
      how: ['Every account has its own "Use props" button. If the team is not in a match it says so; in quarter 3 or 4 nothing is used because halftime is over.', 'In quarter 1 or 2 it waits for halftime. During the 20 s halftime every starter is filled to 95+ stamina: +10 bottles first, +30 ones only at 85 or below once the +10s run out.', 'Only single-player water bottles are used; team props and large bottles are not. The result goes to Activity and the match screen is left.']
    },
    pg: {
      start: 'Start ({n})', include: 'Plays', level: 'Lv', boss: 'Boss', attempts: 'Attempts left', result: 'Result', floor: 'Floor', enemy: 'Opponent',
      applyAll: 'Apply to all', best: 'Strongest allowed boss for each account', needs: 'needs Lv {n}', noBoss: 'No boss allowed', wl: '{w} W · {l} L',
      refreshAscent: 'Read floors', ascentHint: 'Reading the floors signs in to each account briefly; if the account is open in the game it is signed out there.',
      st: { queued: 'Queued', login: 'Connecting', starting: 'Starting the match', playing: 'In a match', otherMatch: 'In another match · waiting', waitingGame: 'Waiting for the game', done: 'Done', noAttempts: 'No attempts', locked: 'Level too low', error: 'Error', stopped: 'Stopped' },
      bossHow: ['Every account plays the chosen boss until its 2 daily attempts are used; the opponent is a bot, so there is no queue.', 'Each boss needs a level; an account below it cannot choose that boss.', 'On start Auto Play on these accounts is stopped and started again afterwards. Attempts reset at 19:10.'],
      ascentHow: ['Every account plays the bot of its current floor; a win moves it one floor up. It goes on until the 2 free daily attempts are used.', 'Paid attempts are never bought or used.', 'Elite Ascent needs the account signed in: if it is open in the game it is signed out there. Auto Play is stopped and started again afterwards.']
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
      target: 'Account to cheer for', from: 'Accounts that cheer', send: 'Cheer now ({n})', sending: 'Sending…', main: 'MAIN',
      noMatch: '{name} is not in a match right now · no match found, nothing was sent.', result: 'Last cheer', rights: 'Cheers left today', resetAt: 'resets {t}', today: "Today's cheers", noneToday: 'No cheers sent today yet.', noneLeft: 'None left', time: 'Time', target2: 'Target', leftHint: 'The game does not show the cheers left; the app counts {n} a day per account, and a "limit" reply sets that account to 0.', ok: 'Sent', fail: 'Not sent', side: { host: 'host team', opponent: 'away team' },
      how: ['Whatever match the chosen account plays right now (Auto Play, Tower, PVP…), its own team gets the cheer (+5 morale). If it is not in a match, nothing is sent.', 'Each account has about 3 cheers a day; when they run out the game\'s message is shown.', 'The Cheer item from the bag is never used; only the free cheer of the match screen.']
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
    <div className="pvp-picks">{accounts.map(a => <button key={a.id} type="button" disabled={disabled} className={ids.includes(a.id) ? 'selected' : ''} onClick={() => setIds(ids.includes(a.id) ? ids.filter(v => v !== a.id) : [...ids, a.id])}>
      <span>{a.name}</span>{extra?.(a)}</button>)}</div>
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
      <tbody>{rows.map(({ a, p, r }) => <tr key={a.id} className={r && ['searching', 'playing'].includes(r.status) ? 'dp-live' : ''}>
        <td><b>{a.name}</b></td>
        <td>{p?.tier ? `${p.tier.name}${p.tier.level ? ` ${p.tier.level}` : ''}` : '—'}</td>
        <td><b>{num(r?.season ?? p?.season)}</b>{r?.seasonStart != null && r?.season != null && r.season !== r.seasonStart && <small className={`cell-sub ${r.season > r.seasonStart ? 'good-text' : 'bad-text'}`}>{r.season > r.seasonStart ? '+' : ''}{r.season - r.seasonStart}</small>}</td>
        <td>{num(r?.total ?? p?.total)}</td>
        <td>{(r?.attemptsLeft ?? p?.left) == null ? '—' : `${r?.attemptsLeft ?? p?.left}/${p?.max ?? 2}`}</td>
        <td className={r?.status === 'error' || r?.status === 'inactive' ? 'bad-text' : ''}>{statusText(r)}</td>
        <td>{r?.lastDiff != null ? <span className={r.lastDiff >= 0 ? 'good-text' : 'bad-text'}>{r.lastDiff >= 0 ? '+' : ''}{r.lastDiff}</span> : '—'}</td>
      </tr>)}</tbody></SortTable></div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.gu.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Daily Boss: per account the boss to play (only bosses its level allows).
function BossTab({ state, x, toast }) {
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
      <tbody>{accounts.map(a => {
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
      })}</tbody></SortTable></div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.pg.bossHow.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Professional: season and playoffs play by themselves; Hall of Fame accounts play the opponent picked here.
function ProTab({ state, x, toast }) {
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
      <tbody>{accounts.map(a => {
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
      })}</tbody></SortTable></div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.pf.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Elite Ascent: every chosen account plays its current floor until the attempts are used.
function AscentTab({ state, x, toast }) {
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
      <tbody>{accounts.map(a => {
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
      })}</tbody></SortTable></div>
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.pg.ascentHow.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

// Props: one button per account; the bag counts update while props are used.
function PropsTab({ state, x, toast }) {
  const p = state.props || {};
  const accounts = state.accounts || [];
  const [checking, setChecking] = useState(false);
  const read = async () => { if (!api.props) return toast(x.notReady, 'error'); setChecking(true); try { await api.props.bags(accounts.map(a => a.id)); } catch (e) { toast(e.message, 'error'); } finally { setChecking(false); } };
  useEffect(() => { if (api.props) read(); }, []);
  const busy = new Set(p.busy || []);
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
    <div className="panel table-panel dp-table"><SortTable><thead><tr><th>{x.account}</th><th>{x.pr.small}</th><th>{x.pr.medium}</th><th>{x.pr.used}</th><th>{x.status}</th><th>{x.pr.players}</th><th></th></tr></thead>
      <tbody>{accounts.map(a => {
        const r = p.runs?.[a.id];
        const bag = p.bags?.[a.id];
        const live = r && ['using', 'waitingHalftime', 'finding'].includes(r.status);
        const small = live && r.bagSmall != null ? r.bagSmall : bag?.small;
        const medium = live && r.bagMedium != null ? r.bagMedium : bag?.medium;
        return <tr key={a.id} className={r?.status === 'using' ? 'dp-live' : ''}>
          <td><b>{a.name}</b></td>
          <td className="num">{small ?? '—'}</td>
          <td className="num">{medium ?? '—'}</td>
          <td className="num">{r?.used ? `${r.used.small}×10 · ${r.used.medium}×30` : '—'}</td>
          <td className={['error', 'noMatch', 'late'].includes(r?.status) ? 'bad-text' : r?.status === 'done' ? 'good-text' : ''}>{status(r)}</td>
          <td className="pr-players">{(r?.players || []).map(pl => <span key={pl.id} className={pl.stamina >= 95 ? 'ok' : 'low'} title={`${pl.name}: ${pl.start} → ${pl.stamina}`}>{pl.name.split(' ').slice(-1)[0]} {pl.stamina}</span>)}</td>
          <td className="actions">{busy.has(a.id) ? <button className="btn danger-soft small" onClick={() => api.props.stop(a.id).catch(e => toast(e.message, 'error'))}>{x.pr.stop}</button> : <button className="btn primary small" onClick={() => api.props.run(a.id).catch(e => toast(e.message, 'error'))}>{x.pr.button}</button>}</td>
        </tr>;
      })}</tbody></SortTable></div>
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
      <tbody>{report.rows.map(r => <tr key={r.accountId}><td><b>{r.name}</b></td><td className={r.status === 'error' ? 'bad-text' : ''}>{x.qz.st[r.status] || r.status}{r.reason && r.status === 'error' ? `: ${r.reason}` : ''}</td><td>{r.correct}/10</td><td>{r.auto} / {r.byUser} / {r.random}</td><td>{r.learned}</td></tr>)}</tbody></SortTable></div>}
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.qz.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}

function CheerTab({ state, x, toast }) {
  const accounts = state.accounts || [];
  const mainId = state.accountProfile?.mainAccountId || accounts[0]?.id || '';
  const [target, setTarget] = useState(() => state.settings?.cheerTargetId && accounts.some(a => a.id === state.settings.cheerTargetId) ? state.settings.cheerTargetId : mainId);
  const others = accounts.filter(a => a.id !== target);
  const [ids, setIds] = useSavedIds(state, 'cheerAccountIds', others, others.map(a => a.id));
  const from = ids.filter(id => id !== target);
  const cs = state.cheer || {};
  const busy = Boolean(cs.busy);
  const last = cs.last;
  const daily = cs.daily || 3;
  const left = id => (cs.left ? cs.left[id] ?? daily : null);
  const entries = [...(cs.entries || [])].reverse();
  const nameOf = id => accounts.find(a => a.id === id)?.name || '';
  const send = async () => {
    if (!api.cheer) return toast(x.notReady, 'error');
    try {
      const r = await api.cheer.send(from, target);
      if (r?.error === 'noMatch') toast(fill(x.ch.noMatch, { name: r.targetName }), 'error');
    } catch (e) { toast(e.message, 'error'); }
  };
  return <>
    <div className="panel dp-controls dp-row">
      <label><span>{x.ch.target}</span><select value={target} disabled={busy} onChange={e => { setTarget(e.target.value); api.settings.update({ cheerTargetId: e.target.value }).catch(() => {}); }}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.id === mainId ? ` (${x.ch.main})` : ''}</option>)}</select></label>
      <div className="dp-actions"><button className="btn primary" disabled={busy || !from.length || !target} onClick={send}>{busy ? x.ch.sending : fill(x.ch.send, { n: from.length })}</button></div>
    </div>
    <div className="panel dp-section"><b className="dp-label">{x.ch.from}</b><AccountPicks accounts={others} ids={from} setIds={setIds} disabled={busy} x={x} extra={a => <em className={left(a.id) === 0 ? 'zero' : ''}>{left(a.id) == null ? '—' : `${left(a.id)}/${daily}`}</em>} /></div>
    <div className="panel dp-section">
      <div className="dp-table-head dp-flush"><b>{x.ch.rights}</b><small className="muted-text">{cs.resetAt ? fill(x.ch.resetAt, { t: new Date(cs.resetAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }) : ''}</small></div>
      <div className="dp-rights">{accounts.map(a => { const n = left(a.id); return <div key={a.id} className={`dp-right ${n === 0 ? 'zero' : ''}`}><span>{a.name}</span><b>{n == null ? '—' : `${n}/${daily}`}</b></div>; })}</div>
      <small className="muted-text">{fill(x.ch.leftHint, { n: daily })}</small>
    </div>
    {last && <div className="panel table-panel dp-table">
      <div className="dp-table-head"><b>{x.ch.result}</b><span>{new Date(last.at).toLocaleTimeString()} · {last.targetName}{last.side ? ` · ${x.ch.side[last.side] || last.side}` : ''}</span></div>
      {last.error === 'noMatch' ? <p className="bad-text dp-pad">{fill(x.ch.noMatch, { name: last.targetName })}</p>
        : last.error && !last.rows?.length ? <p className="bad-text dp-pad">{last.error}</p>
        : <SortTable><thead><tr><th>{x.account}</th><th>{x.status}</th><th></th></tr></thead><tbody>{(last.rows || []).map(r => <tr key={r.accountId}><td><b>{r.name}</b></td><td className={r.ok ? 'good-text' : 'bad-text'}>{r.ok ? x.ch.ok : r.message === 'noCheersLeft' ? x.ch.noneLeft : x.ch.fail}</td><td>{r.message === 'noCheersLeft' ? '' : r.message}</td></tr>)}</tbody></SortTable>}
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

export default function DailyPage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [tab, setTab] = useState(() => state.settings?.dailyTab || 'goup');
  const choose = id => { setTab(id); api.settings.update({ dailyTab: id }).catch(() => {}); };
  const live = { pro: state.professional?.running, props: (state.props?.busy || []).length > 0, boss: state.dailyBoss?.running, ascent: state.eliteAscent?.running, goup: state.goup?.running, quiz: state.quiz?.running, cheer: state.cheer?.busy, chat: state.chat?.running };
  const asking = Object.values(state.quiz?.run?.accounts || {}).some(r => r.status === 'askUser');
  return <div className="page daily-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div></div>
    <div className="dp-tabs">{Object.keys(x.tabs).map(id => <button key={id} className={tab === id ? 'active' : ''} onClick={() => choose(id)}>{x.tabs[id]}{live[id] && <i className={`dp-dot ${id === 'quiz' && asking ? 'ask' : ''}`} />}</button>)}</div>
    {tab === 'goup' && <GoUpTab state={state} x={x} toast={toast} />}
    {tab === 'pro' && <ProTab state={state} x={x} toast={toast} />}
    {tab === 'boss' && <BossTab state={state} x={x} toast={toast} />}
    {tab === 'ascent' && <AscentTab state={state} x={x} toast={toast} />}
    {tab === 'props' && <PropsTab state={state} x={x} toast={toast} />}
    {tab === 'quiz' && <QuizTab state={state} x={x} toast={toast} />}
    {tab === 'cheer' && <CheerTab state={state} x={x} toast={toast} />}
    {tab === 'chat' && <ChatTab state={state} x={x} toast={toast} />}
  </div>;
}
