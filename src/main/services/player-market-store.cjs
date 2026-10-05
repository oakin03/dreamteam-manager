const fs = require('fs');
const path = require('path');

class PlayerMarketStore {
  constructor(dataDir) {
    this.file = path.join(
      dataDir,
      'player-market.json'
    );
  }

  _empty() {
    return {
      version: 1,
      updatedAt: null,
      players: {}
    };
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) {
        return this._empty();
      }

      const raw = JSON.parse(
        fs.readFileSync(this.file, 'utf8')
      );

      return {
        ...this._empty(),
        ...raw,
        players:
          raw?.players &&
          typeof raw.players === 'object'
            ? raw.players
            : {}
      };
    } catch {
      return this._empty();
    }
  }

  save(data) {
    fs.mkdirSync(
      path.dirname(this.file),
      { recursive: true }
    );

    fs.writeFileSync(
      this.file,
      JSON.stringify(data, null, 2),
      'utf8'
    );
  }

  previousPlayers() {
    return this.load().players;
  }
}

module.exports = {
  PlayerMarketStore
};