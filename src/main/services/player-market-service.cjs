const crypto = require('crypto');

const CITY_PLAYER_LIST_SELECTOR =
  'div.absolute.cursor-pointer[style*="bottom: -140px"][style*="left: 90px"]';

const PLAYER_LIST = {
  pageLabel: 'span',
  nextButton: 'button[aria-label="Next page"]',
  previousButton: 'button[aria-label="Previous page"]',
  playerRow: 'ul > li',
  playerButton: 'button',
  playerImage: 'img[alt]'
};

const DEFAULT_ROLES = [
  { id: 'sellable', name: 'Satılabilir' },
  { id: 'stock', name: 'Stok' },
  { id: 'card', name: 'Kart' }
];

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function number(value) {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Oyuncu taraması durduruldu.');
  error.name = 'AbortError';
  throw error;
}

function playerKey(name) {
  return clean(name).toLowerCase();
}

function calculateChange(currentPrice, previousPrice) {
  if (currentPrice == null || previousPrice == null) {
    return {
      value: 0,
      direction: 'none'
    };
  }

  const value = currentPrice - previousPrice;

  return {
    value: Math.abs(value),
    direction:
      value > 0 ? 'up' :
      value < 0 ? 'down' :
      'none'
  };
}

function decoratePlayer(player, previous) {
  const previousPrice = previous?.price ?? null;
  const change = calculateChange(player.price, previousPrice);

  const base = player.base;

  return {
    ...player,
    key: playerKey(player.name),
    previousPrice,
    change: change.value,
    changeDirection: change.direction,
    difference: base != null && player.price != null
      ? player.price - base
      : null,
    differencePercent:
      base != null &&
      base !== 0 &&
      player.price != null
        ? ((player.price - base) / base) * 100
        : null
  };
}

async function readPlayerList(page) {
  return page.evaluate(() => {
    const clean = value =>
      String(value || '').replace(/\s+/g, ' ').trim();

    const rows = [...document.querySelectorAll('ul > li')]
      .filter(row => row.querySelector('button img[alt]'));

    return rows.map(row => {
      const button = row.querySelector('button');
      const image = button?.querySelector('img[alt]');

      const name = clean(image?.getAttribute('alt'));

      const textParts = [...row.querySelectorAll('span')]
        .map(el => clean(el.textContent))
        .filter(Boolean);

      const position =
        textParts.find(value =>
          /^(PG|SG|SF|PF|C)(\/(PG|SG|SF|PF|C))*$/.test(value)
        ) || null;

      const rating =
        textParts.find(value =>
          /^(S\+|S|A\+|A|B\+|B|C|D|F)$/.test(value)
        ) || null;

      const priceContainer = [...row.querySelectorAll('span')]
        .find(el => clean(el.textContent).match(/^\d[\d,]*\s*(TK)?/));

      const priceText = clean(priceContainer?.textContent);

      const priceMatch = priceText.match(/(\d[\d,]*)\s*TK?/i);
      const price = priceMatch
        ? Number(priceMatch[1].replace(/,/g, ''))
        : null;

      let change = 0;
      let changeDirection = 'none';

      const up = row.querySelector('svg.lucide-trending-up');
      const down = row.querySelector('svg.lucide-trending-down');

      const changeElement = up || down;

      if (changeElement) {
        const parentText = clean(
          changeElement.parentElement?.textContent
        );

        const match = parentText.match(/(\d+)\s*$/);

        change = match ? Number(match[1]) : 0;
        changeDirection = up ? 'up' : 'down';
      }

      return {
        name,
        position,
        rating,
        price,
        change,
        changeDirection
      };
    });
  });
}

async function readPager(page) {
  return page.evaluate(() => {
    const text = [...document.querySelectorAll('span')]
      .map(el => String(el.textContent || '').replace(/\s+/g, ' ').trim())
      .find(value => /^\d+\s*\/\s*\d+$/.test(value));

    const match = text?.match(/^(\d+)\s*\/\s*(\d+)$/);

    return {
      current: match ? Number(match[1]) : null,
      total: match ? Number(match[2]) : null
    };
  });
}

async function readPlayerDetails(page) {
  return page.evaluate(() => {
    const clean = value =>
      String(value || '').replace(/\s+/g, ' ').trim();

    const bodyText = clean(document.body.textContent);

    const baseMatch = bodyText.match(
      /\bBase\b\s*[:\-]?\s*(\d[\d,]*)\s*TK/i
    );

    const base = baseMatch
      ? Number(baseMatch[1].replace(/,/g, ''))
      : null;

    const positions = [
      'PG/SG',
      'SG/SF',
      'SF/PF',
      'PF/C',
      'PG',
      'SG',
      'SF',
      'PF',
      'C'
    ];

    const position = positions.find(value =>
      bodyText.includes(value)
    ) || null;

    return {
      base,
      position
    };
  });
}

async function closePlayerDetails(page) {
  await page.mouse.click(20, 20);
}

async function scanPage(page, ctx, previousPlayers) {
  abortIfNeeded(ctx.signal);

  const rows = await readPlayerList(page);

  const result = [];

  for (let index = 0; index < rows.length; index++) {
    abortIfNeeded(ctx.signal);

    const player = rows[index];

    if (!player.name) continue;

    const key = playerKey(player.name);

    ctx.log(
      'info',
      `Oyuncu ${player.name} inceleniyor…`
    );

    const buttons = page.locator(PLAYER_LIST.playerButton);

    await buttons
      .filter({ has: page.locator(`img[alt="${player.name}"]`) })
      .first()
      .click();

    await page.waitForTimeout(250);

    const details = await readPlayerDetails(page);

    await closePlayerDetails(page);

    await page.waitForTimeout(150);

    const previous = previousPlayers[key];

    result.push(
      decoratePlayer(
        {
          ...player,
          position: details.position || player.position,
          base: details.base
        },
        previous
      )
    );

    ctx.setState({
      scannedPlayers: result.length,
      currentPlayer: player.name
    });
  }

  return result;
}

async function scan(ctx) {
  const account = ctx.account;

  ctx.log('info', 'Oyuncu listesi taraması başlatılıyor…');

  const previousData =
    ctx.storage?.load?.() ||
    { players: {} };

  const previousPlayers = previousData.players || {};

  const auth = await ctx.browser.authenticate(
    account,
    ctx.credentials(),
    {
      visible: Boolean(ctx.visibleBrowser),
      forceFresh: ctx.forceFresh,
      keepOpen: true,
      log: ctx.log
    }
  );

  const page = auth.session.page;

  try {
    abortIfNeeded(ctx.signal);

    await ctx.browser.waitForMain(page, {
      timeoutMs: 180000,
      log: ctx.log
    });

    ctx.log('info', 'Anasayfa doğrulandı.');

    const city = page.locator(
      'img[alt="City"], img[src*="/iconss/city.webp"]'
    ).first();

    await city.waitFor({
      state: 'visible',
      timeout: 90000
    });

    await city.click();

    const playerListButton = page.locator(
      CITY_PLAYER_LIST_SELECTOR
    ).first();

    await playerListButton.waitFor({
      state: 'visible',
      timeout: 90000
    });

    await playerListButton.click();

    await page.locator(PLAYER_LIST.playerRow)
      .first()
      .waitFor({
        state: 'visible',
        timeout: 90000
      });

    const firstPager = await readPager(page);

    const totalPages = firstPager.total;

    if (!totalPages) {
      throw new Error(
        'Oyuncu listesinde toplam sayfa sayısı okunamadı.'
      );
    }

    ctx.log(
      'info',
      `Oyuncu listesi açıldı · ${totalPages} sayfa`
    );

    const players = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      abortIfNeeded(ctx.signal);

      const pager = await readPager(page);

      if (pager.current !== pageNumber) {
        throw new Error(
          `Oyuncu listesi ${pageNumber}. sayfaya geçemedi.`
        );
      }

      ctx.setState({
        currentPage: pageNumber,
        totalPages,
        scannedPlayers: players.length,
        message: `Oyuncu listesi taranıyor · ${pageNumber}/${totalPages}`
      });

      const pagePlayers = await scanPage(
        page,
        ctx,
        previousPlayers
      );

      players.push(...pagePlayers);

      if (pageNumber >= totalPages) break;

      const next = page.locator(
        PLAYER_LIST.nextButton
      ).first();

      if (await next.isDisabled()) {
        throw new Error(
          `${pageNumber}. sayfadan sonra Next butonu pasif oldu.`
        );
      }

      await next.click();

      await page.waitForFunction(
        expected => {
          const text = [...document.querySelectorAll('span')]
            .map(el =>
              String(el.textContent || '')
                .replace(/\s+/g, ' ')
                .trim()
            )
            .find(value => /^\d+\s*\/\s*\d+$/.test(value));

          const match = text?.match(/^(\d+)\s*\/\s*(\d+)$/);

          return match && Number(match[1]) === expected;
        },
        pageNumber + 1,
        { timeout: 90000 }
      );
    }

    const nextPlayers = {};

    for (const player of players) {
      nextPlayers[player.key] = player;
    }

    ctx.storage?.save?.({
      updatedAt: new Date().toISOString(),
      players: nextPlayers
    });

    ctx.setState({
      status: 'completed',
      currentPage: totalPages,
      totalPages,
      scannedPlayers: players.length,
      message: `Tarama tamamlandı · ${players.length} oyuncu`
    });

    ctx.log(
      'success',
      `Tüm oyuncular tarandı · ${players.length} oyuncu`
    );

    return {
      players,
      totalPages
    };
  } finally {
    await ctx.browser.release(
      account.id,
      auth.owner,
      {
        closeWhenUnused: true
      }
    ).catch(() => {});
  }
}

class PlayerMarketService {
  constructor({ store, credentials, browserService, activity, onChanged }) {
    this.store = store;
    this.credentials = credentials;
    this.browser = browserService;
    this.activity = activity;
    this.onChanged = onChanged;
    this.runtime = {
      status: 'idle',
      message: '',
      currentPage: 0,
      totalPages: 0,
      scannedPlayers: 0,
      currentPlayer: null
    };
    this.players = [];
    this.abortController = null;
  }

  snapshot() {
    return {
      players: this.players,
      scanRuntime: this.runtime
    };
  }

  async start() {
    if (this.abortController) {
      return this.snapshot();
    }

    this.abortController = new AbortController();

    this.runtime = {
      ...this.runtime,
      status: 'scanning',
      message: 'Tarama başlatılıyor…'
    };

    this.onChanged?.();

    try {
      const account = this.store.getPlayerMarketAccount?.();

      if (!account) {
        throw new Error('Player Market hesabı tanımlı değil.');
      }

      const result = await scan({
        account,
        credentials: () => this.credentials(account),
        browser: this.browser,
        signal: this.abortController.signal,
        storage: {
          load: () => this.store.getPlayerMarketData?.() || { players: {} },
          save: data => this.store.savePlayerMarketData?.(data)
        },
        visibleBrowser: true,
        forceFresh: true,
        log: (level, message) => this.activity?.add?.({
          level,
          message
        }),
        setState: patch => {
          this.runtime = {
            ...this.runtime,
            ...patch
          };
          this.onChanged?.();
        }
      });

      this.players = result.players || [];

      this.runtime = {
        ...this.runtime,
        status: 'completed',
        message: `Tarama tamamlandı · ${this.players.length} oyuncu`
      };

      return this.snapshot();
    } catch (error) {
      this.runtime = {
        ...this.runtime,
        status: error?.name === 'AbortError' ? 'stopped' : 'error',
        message: error?.message || String(error)
      };

      throw error;
    } finally {
      this.abortController = null;
      this.onChanged?.();
    }
  }

  async stop() {
    this.abortController?.abort();
    return this.snapshot();
  }

  setRole(playerKey, roleIds) {
    const player = this.players.find(
      item => item.key === playerKey
    );

    if (!player) {
      throw new Error('Oyuncu bulunamadı.');
    }

    player.roleIds = Array.isArray(roleIds)
      ? roleIds
      : [];

    this.onChanged?.();

    return this.snapshot();
  }

  async shutdown() {
    await this.stop();
  }
}

module.exports = {
  PlayerMarketService,
  scan,
  readPlayerList,
  readPager,
  readPlayerDetails,
  decoratePlayer
};