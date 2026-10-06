import { useMemo, useState } from 'react';

const ROLE_OPTIONS = [
  { id: 'sellable', label: 'Satılabilir' },
  { id: 'stock', label: 'Stok' },
  { id: 'card', label: 'Kart' }
];

const SORT_OPTIONS = [
  ['name', 'Oyuncu adı'],
  ['price-asc', 'Price ↑'],
  ['price-desc', 'Price ↓'],
  ['base-gap-lowest', 'Base’e en yakın'],
  ['base-gap-highest', 'Base’den en uzak'],
  ['change-up', 'En çok yükselen'],
  ['change-down', 'En çok düşen'],
  ['change-largest', 'En büyük değişim']
];

export default function PlayerMarketPanel({
  players = [],
  roles = ROLE_OPTIONS,
  scanning = false,
  scanRuntime,
  account,
  onSaveAccount,
  onScan,
  onStop,
  onSetRole
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('all');
  const [position, setPosition] = useState('all');
  const [rating, setRating] = useState('all');
  const [belowBase, setBelowBase] = useState(false);
  const [nearBase, setNearBase] = useState('');
  const [sort, setSort] = useState('name');
  const [accountName, setAccountName] = useState(
    account?.name || ''
  );
  const [accountLogin, setAccountLogin] = useState(
    account?.login || ''
  );
  const [accountPassword, setAccountPassword] =
    useState('');

  const filtered = useMemo(() => {
    let result = players.filter(player => {
      if (
        name &&
        !player.name
          .toLocaleLowerCase()
          .includes(name.toLocaleLowerCase())
      ) {
        return false;
      }

      if (
        role !== 'all' &&
        !(player.roleIds || []).includes(role)
      ) {
        return false;
      }

      if (
        position !== 'all' &&
        player.position !== position
      ) {
        return false;
      }

      if (
        rating !== 'all' &&
        player.rating !== rating
      ) {
        return false;
      }

      if (
        belowBase &&
        !(
          player.price != null &&
          player.base != null &&
          player.price < player.base
        )
      ) {
        return false;
      }

      if (
        nearBase !== '' &&
        player.price != null &&
        player.base != null
      ) {
        const percent =
          Math.abs(player.price - player.base) /
          player.base *
          100;

        if (percent > Number(nearBase)) {
          return false;
        }
      }

      return true;
    });

    return [...result].sort((a, b) => {
      switch (sort) {
        case 'price-asc':
          return (a.price ?? Infinity) -
            (b.price ?? Infinity);

        case 'price-desc':
          return (b.price ?? -Infinity) -
            (a.price ?? -Infinity);

        case 'base-gap-lowest':
          return (a.difference ?? Infinity) -
            (b.difference ?? Infinity);

        case 'base-gap-highest':
          return (b.difference ?? -Infinity) -
            (a.difference ?? -Infinity);

        case 'change-up':
          return (
            (b.changeDirection === 'up'
              ? b.change
              : 0) -
            (a.changeDirection === 'up'
              ? a.change
              : 0)
          );

        case 'change-down':
          return (
            (b.changeDirection === 'down'
              ? b.change
              : 0) -
            (a.changeDirection === 'down'
              ? a.change
              : 0)
          );

        case 'change-largest':
          return (
            (b.change ?? 0) -
            (a.change ?? 0)
          );

        default:
          return String(a.name)
            .localeCompare(String(b.name));
      }
    });
  }, [
    players,
    name,
    role,
    position,
    rating,
    belowBase,
    nearBase,
    sort
  ]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">
            Oyuncu Listesi
          </h2>

          <div className="text-xs text-slate-500">
            {filtered.length} / {players.length} oyuncu
          </div>
        </div>
      <div className="rounded-xl border p-4 space-y-3">
        <h2 className="font-bold">
          Player Market Hesabı
        </h2>

        <div className="grid grid-cols-3 gap-2">
          <input
            value={accountName}
            onChange={e =>
              setAccountName(e.target.value)
            }
            placeholder="Hesap adı"
            className="px-3 py-2 rounded-lg"
          />

          <input
            value={accountLogin}
            onChange={e =>
              setAccountLogin(e.target.value)
            }
            placeholder="Kullanıcı adı"
            className="px-3 py-2 rounded-lg"
          />

          <input
            type="password"
            value={accountPassword}
            onChange={e =>
              setAccountPassword(e.target.value)
            }
            placeholder={
              account
                ? 'Şifreyi değiştirmek için gir'
                : 'Şifre'
            }
            className="px-3 py-2 rounded-lg"
          />
        </div>

        <button
          type="button"
          onClick={() =>
            onSaveAccount({
              name: accountName,
              login: accountLogin,
              password: accountPassword
            })
          }
          className="px-4 py-2 rounded-lg"
        >
          Hesabı Kaydet
        </button>
      </div>
        <div className="flex gap-2">
          {!scanning ? (
            <button
              type="button"
              onClick={onScan}
              className="px-4 py-2 rounded-lg"
            >
              Taramayı Başlat
            </button>
          ) : (
            <button
              type="button"
              onClick={onStop}
              className="px-4 py-2 rounded-lg"
            >
              Durdur
            </button>
          )}
        </div>
      </div>

      {scanning && (
        <div className="rounded-lg border p-3 text-sm">
          <div>
            {scanRuntime?.message ||
              'Oyuncular taranıyor…'}
          </div>

          {scanRuntime?.totalPages && (
            <div className="text-xs mt-1">
              Sayfa: {scanRuntime.currentPage || 0}
              {' / '}
              {scanRuntime.totalPages}
            </div>
          )}

          {scanRuntime?.currentPlayer && (
            <div className="text-xs mt-1">
              Oyuncu: {scanRuntime.currentPlayer}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Oyuncu ara..."
          className="px-3 py-2 rounded-lg"
        />

        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="px-3 py-2 rounded-lg"
        >
          <option value="all">Tüm roller</option>

          {roles.map(item => (
            <option
              key={item.id}
              value={item.id}
            >
              {item.name || item.label}
            </option>
          ))}
        </select>

        <select
          value={position}
          onChange={e => setPosition(e.target.value)}
          className="px-3 py-2 rounded-lg"
        >
          <option value="all">Tüm pozisyonlar</option>
          <option value="PG">PG</option>
          <option value="SG">SG</option>
          <option value="SF">SF</option>
          <option value="PF">PF</option>
          <option value="C">C</option>
          <option value="PG/SG">PG/SG</option>
          <option value="SG/SF">SG/SF</option>
          <option value="SF/PF">SF/PF</option>
          <option value="PF/C">PF/C</option>
        </select>

        <select
          value={rating}
          onChange={e => setRating(e.target.value)}
          className="px-3 py-2 rounded-lg"
        >
          <option value="all">Tüm ratingler</option>
          <option value="S+">S+</option>
          <option value="S">S</option>
          <option value="A+">A+</option>
          <option value="A">A</option>
          <option value="B+">B+</option>
          <option value="B">B</option>
        </select>

        <label className="flex items-center gap-2 px-3 py-2">
        <input
            type="checkbox"
            checked={belowBase}
            onChange={e => setBelowBase(e.target.checked)}
        />
        Price &lt; Base
        </label>

        <input
          value={nearBase}
          onChange={e => setNearBase(e.target.value)}
          type="number"
          min="0"
          step="0.1"
          placeholder="Base'e % kaç yakın?"
          className="px-3 py-2 rounded-lg"
        />

        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="px-3 py-2 rounded-lg"
        >
          {SORT_OPTIONS.map(([value, label]) => (
            <option
              key={value}
              value={value}
            >
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>Oyuncu</th>
              <th>Position</th>
              <th>Rating</th>
              <th>Price</th>
              <th>Base</th>
              <th>Fark</th>
              <th>Değişim</th>
              <th>Rol</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map(player => (
              <tr key={player.key}>
                <td>{player.name}</td>

                <td>{player.position || '—'}</td>

                <td>{player.rating || '—'}</td>

                <td>
                  {player.price != null
                    ? `${player.price} TK`
                    : '—'}
                </td>

                <td>
                  {player.base != null
                    ? `${player.base} TK`
                    : '—'}
                </td>

                <td>
                  {player.difference != null
                    ? `${player.difference} TK`
                    : '—'}

                  {player.differencePercent != null && (
                    <span className="ml-1 text-xs">
                      (
                      {player.differencePercent.toFixed(1)}
                      %)
                    </span>
                  )}
                </td>

                <td>
                  {player.changeDirection === 'up' && (
                    <span className="text-green-500">
                      ↑ {player.change}
                    </span>
                  )}

                  {player.changeDirection === 'down' && (
                    <span className="text-red-500">
                      ↓ {player.change}
                    </span>
                  )}

                  {player.changeDirection === 'none' &&
                    '0'}
                </td>

                <td>
                  <select
                    value={
                      player.roleIds?.[0] || ''
                    }
                    onChange={e =>
                      onSetRole(
                        player.key,
                        e.target.value
                          ? [e.target.value]
                          : []
                      )
                    }
                  >
                    <option value="">
                      Rol yok
                    </option>

                    {roles.map(item => (
                      <option
                        key={item.id}
                        value={item.id}
                      >
                        {item.name || item.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}