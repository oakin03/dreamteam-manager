class PlayerMarketData {
  constructor(store) {
    this.store = store;
  }

  snapshot() {
    const data = this.store.load();

    return {
      updatedAt: data.updatedAt,
      players: Object.values(data.players)
    };
  }

  setRole(playerKey, roleIds) {
    const data = this.store.load();

    if (!data.players[playerKey]) {
      throw new Error('Oyuncu bulunamadı.');
    }

    data.players[playerKey].roleIds = [
      ...new Set(roleIds || [])
    ];

    this.store.save(data);

    return data.players[playerKey];
  }

  setRoles(players) {
    const data = this.store.load();

    for (const player of players || []) {
      if (!data.players[player.key]) continue;

      data.players[player.key].roleIds = [
        ...new Set(player.roleIds || [])
      ];
    }

    this.store.save(data);

    return true;
  }
}

module.exports = {
  PlayerMarketData
};