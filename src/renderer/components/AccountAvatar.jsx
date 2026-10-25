import { useState } from 'react';

const SITE = 'https://www.dreamteamph.com';
const COLORS = ['#e8661c', '#2b5cc0', '#187a47', '#965b05', '#6b4fbf', '#b8352a', '#0f7f86', '#4a5568'];
const colorOf = name => COLORS[[...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];

// The account's team logo from the game (Account health reads it), or its first letter.
export default function AccountAvatar({ name, url, className = 'acc-av' }) {
  const [broken, setBroken] = useState(false);
  const src = url && !broken ? (/^https?:/.test(url) ? url : `${SITE}${url.startsWith('/') ? '' : '/'}${url}`) : null;
  return src
    ? <img className={`${className} img`} src={src} alt="" onError={() => setBroken(true)} />
    : <span className={className} style={{ background: colorOf(name) }}>{String(name || '?').slice(0, 1).toUpperCase()}</span>;
}
