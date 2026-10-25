// Turkish for the older log lines that carry no code (Auto Play / Quick Play task,
// task engine, Daily Reward, Scout, browser sign-in). Shown in Turkish on the page;
// the stored entry keeps the English text. First matching pattern wins.
const RULES = [
  [/^Quick Play started · Match (.+?)\.?$/, m => `Quick Play başladı · Maç ${m[1]}`],
  [/^Quick Play started\.?$/, () => 'Quick Play başladı'],
  [/^Quick Play was not started: (.+)$/, m => `Quick Play başlatılamadı: ${m[1]}`],
  [/^Quick Play error: (.+)$/, m => `Quick Play hatası: ${m[1]}`],
  [/^Quick Play stopped: (.+)$/, m => `Quick Play durduruldu: ${m[1]}`],
  [/^Quick Play screen is ready\.?$/, () => 'Quick Play ekranı hazır'],
  [/^Quick Play clicked\.?$/, () => 'Quick Play\'e basıldı'],
  [/^Quick Play was clicked but the disabled state was not observed\.?$/, () => 'Quick Play\'e basıldı ama düğmenin kilitlendiği görülmedi'],
  [/^Quick Play paused while another game screen is in use\.?$/, () => 'Başka bir oyun ekranı kullanıldığı için Quick Play bekletildi'],
  [/^Quick Play is still disabled\. Recovery attempt (\d+)\/(\d+)…$/, m => `Quick Play hâlâ kapalı · kurtarma denemesi ${m[1]}/${m[2]}…`],
  [/^Quick Play remained disabled after recovery\..*$/, () => 'Quick Play kurtarmadan sonra da kapalı kaldı · birazdan yeniden denenecek'],
  [/^The game is reachable again · Quick Play continues\.?$/, () => 'Oyun bağlantısı geri geldi · Quick Play devam ediyor'],
  [/^Game not reachable \((.+)\) · waiting.*$/, m => `Oyuna bağlanılamıyor (${m[1]}) · bekleniyor, tek bağlantıyla 2 dakikada bir kontrol ediliyor`],
  [/^Socket mode ready\. Chromium is closed to save RAM\.?$/, () => 'Soket modu hazır · RAM için Chromium kapatıldı'],
  [/^Socket connected\. Verifying the session…$/, () => 'Soket bağlandı · oturum doğrulanıyor…'],
  [/^Socket disconnected; waiting for reconnection…$/, () => 'Bağlantı koptu · yeniden bağlanma bekleniyor…'],
  [/^Socket mode unavailable: (.+)$/, m => `Soket modu kullanılamıyor: ${m[1]}`],
  [/^Switching to headless Chromium fallback\.?$/, () => 'Gizli Chromium yedeğine geçiliyor'],
  [/^Opening a temporary Chromium session…$/, () => 'Geçici Chromium oturumu açılıyor…'],
  [/^Opening visible Chromium…$/, () => 'Görünür Chromium açılıyor…'],
  [/^Opening headless Chromium fallback…$/, () => 'Gizli Chromium yedeği açılıyor…'],
  [/^Checking Stadium data and Daily Reward…$/, () => 'Stadyum verisi ve Daily Reward kontrol ediliyor…'],
  [/^Signing in…$/, () => 'Giriş yapılıyor…'],
  [/^Opening DreamTeam…$/, () => 'DreamTeam açılıyor…'],
  [/^Loading game assets · (\d+)\/(\d+)$/, m => `Oyun dosyaları yükleniyor · ${m[1]}/${m[2]}`],
  [/^Preparing Task (\d+) · (.+?)…$/, m => `Görev ${m[1]} · ${m[2]} hazırlanıyor…`],
  [/^Task (\d+) · (.+?) is ready\.?$/, m => `Görev ${m[1]} · ${m[2]} hazır`],
  [/^Task (\d+) · (.+?) started\.?$/, m => `Görev ${m[1]} · ${m[2]} başladı`],
  [/^Task (\d+) · (.+?) stopped\.?$/, m => `Görev ${m[1]} · ${m[2]} durduruldu`],
  [/^Preparation failed: (.+)$/, m => `Hazırlık başarısız: ${m[1]}`],
  [/^Daily Reward Tier (\d+) collected\.?$/, m => `Daily Reward ${m[1]}. kademe toplandı`],
  [/^Daily Reward clicked · waiting (\d+) seconds…$/, m => `Daily Reward'a basıldı · ${m[1]} sn bekleniyor…`],
  [/^Daily Reward collected\.?$/, () => 'Daily Reward toplandı'],
  [/^Daily Rewards completed for today\.?$/, () => 'Bugünkü Daily Reward\'lar tamamlandı'],
  [/^Daily Reward Stadium check: (.+)$/, m => `Daily Reward stadyum kontrolü: ${m[1]}`],
  [/^Daily Reward · Match restore failed: (.+)$/, m => `Daily Reward · maç ekranına dönülemedi: ${m[1]}`],
  [/^Daily Reward: (.+)$/, m => `Daily Reward hatası: ${m[1]}`],
  [/^Scout list refreshed\.?$/, () => 'Scout listesi yenilendi'],
  [/^Scout closed · Chromium released\.?$/, () => 'Scout kapatıldı · Chromium bırakıldı'],
  [/^Scout refresh: (.+)$/, m => `Scout yenileme hatası: ${m[1]}`],
  [/^Scout: (.+)$/, m => `Scout hatası: ${m[1]}`]
];

export function legacyTr(message) {
  const text = String(message || '');
  // "Daily Reward · <inner>" wraps other lines (sign-in steps, asset loading).
  const wrapped = /^Daily Reward · (.+)$/.exec(text);
  if (wrapped && !/^Match restore failed/.test(wrapped[1])) { const inner = legacyTr(wrapped[1]); return inner === wrapped[1] ? text : `Daily Reward · ${inner}`; }
  for (const [re, fn] of RULES) { const m = re.exec(text); if (m) return fn(m); }
  return text;
}
