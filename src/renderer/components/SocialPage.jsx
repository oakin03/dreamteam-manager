import { useEffect, useMemo, useRef, useState } from 'react';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const SITE = 'https://www.dreamteamph.com';
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const avatar = url => (url ? (/^https?:/.test(url) ? url : `${SITE}${url.startsWith('/') ? '' : '/'}${url}`) : null);
const itemName = it => it?.itemDetail?.name || it?.metadata?.name || it?.item?.name || it?.name || it?.itemType || '?';
const rewardMails = mails => (mails || []).filter(m => !m.isClaimed && Array.isArray(m.items) && m.items.length);

const TEXT = {
  tr: {
    title: 'Sosyal', subtitle: 'Gelen kutusu, arkadaşlar, sohbet, istekler ve engellenenler · hesap oyundan atılmaz',
    account: 'Hesap', refresh: 'Yenile', loading: 'Yükleniyor…', loadedAt: '{t} güncellendi', notReady: 'Bu sayfa uygulama yeniden başlatılınca çalışır.',
    tabs: { mail: 'Gelen Kutusu', friends: 'Arkadaşlar', chat: 'Sohbet', requests: 'İstekler', blocked: 'Engellenenler' },
    overview: 'Hesaplar', badgeHint: '{r} istek · {u} okunmamış mesaj · {m} ödüllü posta',
    mail: { claimAll: 'Hepsini topla ({n})', claim: 'Topla', claimed: 'Toplandı', noRewards: 'Ödül yok', empty: 'Gelen kutusu boş.', system: 'Sistem', expires: '{t} tarihinde silinir', rewards: 'Ödüller', subject: 'Konu', date: 'Tarih', status: 'Durum' },
    friends: { empty: 'Bu hesabın arkadaşı yok.', online: 'Çevrimiçi', offline: 'Çevrimdışı', chat: 'Sohbet', remove: 'Çıkar', sure: 'Emin misin?', yes: 'Evet, çıkar', no: 'Vazgeç', count: '{n}/50 arkadaş', unread: '{n} yeni' },
    chat: { pick: 'Soldan bir arkadaş seç.', empty: 'Bu sohbette mesaj yok.', placeholder: '{name} kullanıcısına yaz…', send: 'Gönder', sending: 'Gönderiliyor…', archived: 'Oyun sohbetleri her gün 19:00 civarında siler; uygulama bir gün daha saklar.', you: 'Sen', noFriends: 'Sohbet için önce arkadaş gerekir.' },
    requests: { incoming: 'Gelen istekler', outgoing: 'Gönderilen istekler', accept: 'Kabul et', decline: 'Reddet', cancel: 'İptal et', noneIn: 'Bekleyen gelen istek yok.', noneOut: 'Bekleyen gönderilmiş istek yok.' },
    blocked: { unblock: 'Engeli kaldır', empty: 'Engellenen oyuncu yok.' },
    done: { accept: 'İstek kabul edildi', decline: 'İstek reddedildi', cancel: 'İstek iptal edildi', remove: 'Arkadaş çıkarıldı', unblock: 'Engel kaldırıldı', claim: 'Ödüller toplandı', sent: 'Mesaj gönderildi' }
  },
  en: {
    title: 'Social', subtitle: 'Inbox, friends, chat, requests and blocked players · the account is not signed out of the game',
    account: 'Account', refresh: 'Refresh', loading: 'Loading…', loadedAt: 'updated {t}', notReady: 'This page works after the app is restarted.',
    tabs: { mail: 'Inbox', friends: 'Friends', chat: 'Chat', requests: 'Requests', blocked: 'Blocked' },
    overview: 'Accounts', badgeHint: '{r} request(s) · {u} unread message(s) · {m} mail(s) with rewards',
    mail: { claimAll: 'Claim all ({n})', claim: 'Claim', claimed: 'Claimed', noRewards: 'No rewards', empty: 'The inbox is empty.', system: 'System', expires: 'deleted on {t}', rewards: 'Rewards', subject: 'Subject', date: 'Date', status: 'Status' },
    friends: { empty: 'This account has no friends.', online: 'Online', offline: 'Offline', chat: 'Chat', remove: 'Remove', sure: 'Sure?', yes: 'Yes, remove', no: 'Cancel', count: '{n}/50 friends', unread: '{n} new' },
    chat: { pick: 'Pick a friend on the left.', empty: 'No messages in this chat.', placeholder: 'Write to {name}…', send: 'Send', sending: 'Sending…', archived: 'The game wipes chats every day around 19:00; the app keeps them one more day.', you: 'You', noFriends: 'A chat needs a friend first.' },
    requests: { incoming: 'Incoming requests', outgoing: 'Sent requests', accept: 'Accept', decline: 'Decline', cancel: 'Cancel', noneIn: 'No incoming requests.', noneOut: 'No sent requests waiting.' },
    blocked: { unblock: 'Unblock', empty: 'No blocked players.' },
    done: { accept: 'Request accepted', decline: 'Request declined', cancel: 'Request cancelled', remove: 'Friend removed', unblock: 'Unblocked', claim: 'Rewards claimed', sent: 'Message sent' }
  },
  get fil() { return filOf(this.en); }
};

function Avatar({ url, name }) {
  const [broken, setBroken] = useState(false);
  const src = avatar(url);
  return src && !broken
    ? <img className="so-av" src={src} alt="" onError={() => setBroken(true)}/>
    : <span className="so-av so-av-txt">{String(name || '?').slice(0, 1).toUpperCase()}</span>;
}

const when = (iso, lang) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString(lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function SocialPage({ state, t, toast }) {
  const lang = t.lang === 'tr' ? 'tr' : t.lang === 'fil' ? 'fil-PH' : 'en';
  const x = TEXT[t.lang] || TEXT.en;
  const accounts = state.accounts || [];
  const mainId = state.accountProfile?.mainAccountId;
  const [accountId, setAccountId] = useState(() => mainId || accounts[0]?.id || null);
  const [tab, setTab] = useState('mail');
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [friendId, setFriendId] = useState(null);
  const [conv, setConv] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const listRef = useRef(null);
  const badges = state.social?.badges || {};
  const ready = Boolean(api?.social);

  const load = async (id = accountId) => {
    if (!id || !ready) return;
    setBusy(true);
    try { setView(await api.social.view(id)); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  useEffect(() => { setView(null); setConv(null); setFriendId(null); load(accountId); }, [accountId]);

  const openChat = async fid => {
    setTab('chat');
    setFriendId(fid);
    setConv(null);
    try { setConv(await api.social.conversation(accountId, fid)); } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [conv]);

  // New messages in the open chat show up with the background check.
  const openUnread = badges[accountId]?.unreadBy?.[friendId] || 0;
  useEffect(() => { if (tab === 'chat' && friendId && openUnread > 0) openChat(friendId); }, [openUnread]);

  const act = async (action, id, done) => {
    setBusy(true);
    try { setView(await api.social.act(accountId, action, id)); toast(done, 'success'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); setConfirm(null); }
  };
  const claim = async mailId => {
    setBusy(true);
    try { setView(await api.social.claimMail(accountId, mailId)); toast(x.done.claim, 'success'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!text.trim() || !friendId) return;
    setSending(true);
    try {
      await api.social.send(accountId, friendId, text);
      setText('');
      setConv(await api.social.conversation(accountId, friendId));
    } catch (e) { toast(e.message, 'error'); } finally { setSending(false); }
  };

  const friends = view?.friends || [];
  const friend = friends.find(f => f.id === friendId);
  const incoming = (view?.requests || []).map(r => ({ id: r.id, user: r.from || r.user || r.sender || {} }));
  const outgoing = (view?.sent || []).map(r => ({ id: r.id, user: r.friend || r.receiver || r.to || {} }));
  const mails = view?.mails || [];
  const withRewards = rewardMails(mails);
  const b = badges[accountId] || {};
  const counts = { mail: withRewards.length, friends: friends.length, chat: b.unread || 0, requests: incoming.length, blocked: (view?.blocked || []).length };
  const sortedFriends = useMemo(() => [...friends].sort((a, z) => (z.unread || 0) - (a.unread || 0) || Number(z.online) - Number(a.online) || String(a.teamName).localeCompare(String(z.teamName))), [friends]);

  if (!ready) return <div className="page"><div className="page-title"><div><h1>{x.title}</h1></div></div><div className="panel empty big"><b>{x.notReady}</b></div></div>;

  return <div className="page social-page">
    <div className="page-title">
      <div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">
        <label className="so-account"><span>{x.account}</span>
          <select value={accountId || ''} onChange={e => setAccountId(e.target.value)}>
            {accounts.map(a => { const k = badges[a.id] || {}; const n = (k.requests || 0) + (k.unread || 0); return <option key={a.id} value={a.id}>{a.name}{n ? ` · ${n} ●` : ''}{k.mail ? ` · ✉${k.mail}` : ''}</option>; })}
          </select>
        </label>
        <button className="btn ghost" disabled={busy} onClick={() => load()}>{busy ? x.loading : x.refresh}</button>
      </div>
    </div>

    <div className="so-overview" aria-label={x.overview}>
      {accounts.map(a => { const k = badges[a.id] || {}; const alert = (k.requests || 0) + (k.unread || 0); return <button key={a.id} className={`so-acc ${a.id === accountId ? 'active' : ''}`} title={fill(x.badgeHint, { r: k.requests || 0, u: k.unread || 0, m: k.mail || 0 })} onClick={() => setAccountId(a.id)}>
        <span>{a.name}</span>{alert > 0 && <i className="so-dot">{alert}</i>}{k.mail > 0 && <i className="so-mail">✉ {k.mail}</i>}
      </button>; })}
    </div>

    <div className="so-tabs" role="tablist">
      {Object.keys(x.tabs).map(k => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
        {x.tabs[k]}{counts[k] > 0 && <i className={(k === 'chat' || k === 'requests') ? 'so-dot' : 'so-count'}>{counts[k]}</i>}
      </button>)}
      <span className="so-loaded">{view?.loadedAt ? fill(x.loadedAt, { t: when(view.loadedAt, lang) }) : busy ? x.loading : ''}</span>
    </div>

    {tab === 'mail' && <div className="panel so-panel">
      <div className="so-panel-head"><b>{x.tabs.mail}</b><button className="btn success small" disabled={busy || !withRewards.length} onClick={() => claim(null)}>{fill(x.mail.claimAll, { n: withRewards.length })}</button></div>
      {!mails.length ? <div className="empty">{busy ? x.loading : x.mail.empty}</div> : <div className="so-mails">
        {mails.map(m => { const open = !m.isClaimed && m.items?.length; return <details key={m.id} className={`so-mail-row ${open ? 'has' : ''}`}>
          <summary>
            <span className="so-mail-sub"><b>{m.subject || '—'}</b>{m.isSystem && <em>{x.mail.system}</em>}</span>
            <span className="so-items">{(m.items || []).map(it => <span key={it.id || itemName(it)} className="so-item">{it.itemDetail?.icon && <img src={avatar(it.itemDetail.icon)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }}/>}{it.quantity ?? it.amount ?? 1} {itemName(it)}</span>)}{!m.items?.length && <span className="muted">{x.mail.noRewards}</span>}</span>
            <time>{when(m.createdAt, lang)}</time>
            {open ? <button className="btn accent small" disabled={busy} onClick={e => { e.preventDefault(); claim(m.id); }}>{x.mail.claim}</button> : <span className="pill muted"><i/>{m.items?.length ? x.mail.claimed : x.mail.noRewards}</span>}
          </summary>
          <p className="so-mail-body">{m.content}</p>
          {m.expiresAt && <small className="muted">{fill(x.mail.expires, { t: new Date(m.expiresAt).toLocaleDateString(lang) })}</small>}
        </details>; })}
      </div>}
    </div>}

    {tab === 'friends' && <div className="panel so-panel">
      <div className="so-panel-head"><b>{fill(x.friends.count, { n: friends.length })}</b></div>
      {!friends.length ? <div className="empty">{busy ? x.loading : x.friends.empty}</div> : <div className="so-list">
        {sortedFriends.map(f => <div key={f.id} className="so-row">
          <Avatar url={f.avatarUrl} name={f.teamName}/>
          <div className="so-who"><b>{f.teamName}</b><small className={f.online ? 'on' : ''}>{f.online ? x.friends.online : x.friends.offline}</small></div>
          {f.unread > 0 && <i className="so-dot">{fill(x.friends.unread, { n: f.unread })}</i>}
          <span className="sp"/>
          <button className="btn ghost small" onClick={() => openChat(f.id)}>{x.friends.chat}</button>
          {confirm === f.id
            ? <><span className="so-sure">{x.friends.sure}</span><button className="btn danger-soft small" disabled={busy} onClick={() => act('remove', f.id, x.done.remove)}>{x.friends.yes}</button><button className="btn ghost small" onClick={() => setConfirm(null)}>{x.friends.no}</button></>
            : <button className="btn danger-soft small" onClick={() => setConfirm(f.id)}>{x.friends.remove}</button>}
        </div>)}
      </div>}
    </div>}

    {tab === 'chat' && <div className="panel so-chat">
      <aside>
        {!friends.length && <div className="empty">{x.chat.noFriends}</div>}
        {sortedFriends.map(f => <button key={f.id} className={f.id === friendId ? 'active' : ''} onClick={() => openChat(f.id)}>
          <Avatar url={f.avatarUrl} name={f.teamName}/><span className="so-name">{f.teamName}</span>{f.unread > 0 && <i className="so-dot">{f.unread}</i>}
        </button>)}
      </aside>
      <section>
        {!friend ? <div className="empty big"><b>{x.chat.pick}</b><span>{x.chat.archived}</span></div> : <>
          <header><Avatar url={friend.avatarUrl} name={friend.teamName}/><b>{friend.teamName}</b><small className={friend.online ? 'on' : ''}>{friend.online ? x.friends.online : x.friends.offline}</small><span className="sp"/><small className="muted">{x.chat.archived}</small></header>
          <div className="so-msgs" ref={listRef}>
            {!conv ? <div className="empty">{x.loading}</div> : !conv.messages.length ? <div className="empty">{x.chat.empty}</div> : conv.messages.map(m => { const mine = m.senderId === conv.userId; return <div key={m.id} className={`so-msg ${mine ? 'mine' : ''}`}>
              <p>{m.message}</p><time>{mine ? x.chat.you : (m.senderName || friend.teamName)} · {when(m.timestamp, lang)}</time>
            </div>; })}
          </div>
          <form className="so-send" onSubmit={e => { e.preventDefault(); send(); }}>
            <input id="so-text" value={text} maxLength={500} onChange={e => setText(e.target.value)} placeholder={fill(x.chat.placeholder, { name: friend.teamName })}/>
            <button className="btn primary" disabled={sending || !text.trim()}>{sending ? x.chat.sending : x.chat.send}</button>
          </form>
        </>}
      </section>
    </div>}

    {tab === 'requests' && <div className="so-two">
      <div className="panel so-panel"><div className="so-panel-head"><b>{x.requests.incoming}</b></div>
        {!incoming.length ? <div className="empty">{x.requests.noneIn}</div> : <div className="so-list">{incoming.map(r => <div key={r.id} className="so-row">
          <Avatar url={r.user.avatarUrl} name={r.user.teamName}/><div className="so-who"><b>{r.user.teamName || '?'}</b></div><span className="sp"/>
          <button className="btn success small" disabled={busy} onClick={() => act('accept', r.id, x.done.accept)}>{x.requests.accept}</button>
          <button className="btn ghost small" disabled={busy} onClick={() => act('decline', r.id, x.done.decline)}>{x.requests.decline}</button>
        </div>)}</div>}
      </div>
      <div className="panel so-panel"><div className="so-panel-head"><b>{x.requests.outgoing}</b></div>
        {!outgoing.length ? <div className="empty">{x.requests.noneOut}</div> : <div className="so-list">{outgoing.map(r => <div key={r.id} className="so-row">
          <Avatar url={r.user.avatarUrl} name={r.user.teamName}/><div className="so-who"><b>{r.user.teamName || '?'}</b></div><span className="sp"/>
          <button className="btn danger-soft small" disabled={busy} onClick={() => act('cancel', r.id, x.done.cancel)}>{x.requests.cancel}</button>
        </div>)}</div>}
      </div>
    </div>}

    {tab === 'blocked' && <div className="panel so-panel">
      {!(view?.blocked || []).length ? <div className="empty">{x.blocked.empty}</div> : <div className="so-list">{view.blocked.map(u => <div key={u.id} className="so-row">
        <Avatar url={u.avatarUrl} name={u.teamName}/><div className="so-who"><b>{u.teamName || '?'}</b></div><span className="sp"/>
        <button className="btn ghost small" disabled={busy} onClick={() => act('unblock', u.id, x.done.unblock)}>{x.blocked.unblock}</button>
      </div>)}</div>}
    </div>}
  </div>;
}
