function matchesPlayer(player, filters = {}) {
  const name = String(filters.name || '')
    .trim()
    .toLocaleLowerCase();

  if (
    name &&
    !String(player.name || '')
      .toLocaleLowerCase()
      .includes(name)
  ) {
    return false;
  }

  if (
    filters.position &&
    filters.position !== 'all' &&
    player.position !== filters.position
  ) {
    return false;
  }

  if (
    filters.rating &&
    filters.rating !== 'all' &&
    player.rating !== filters.rating
  ) {
    return false;
  }

  if (
    filters.role &&
    filters.role !== 'all' &&
    !(player.roleIds || []).includes(filters.role)
  ) {
    return false;
  }

  if (
    filters.priceBelowBase &&
    !(
      player.price != null &&
      player.base != null &&
      player.price < player.base
    )
  ) {
    return false;
  }

  if (
    filters.priceNearBasePercent != null &&
    player.base != null &&
    player.price != null
  ) {
    const percent =
      Math.abs(player.price - player.base) /
      player.base *
      100;

    if (
      percent >
      Number(filters.priceNearBasePercent)
    ) {
      return false;
    }
  }

  if (
    filters.minDifference != null &&
    (player.difference == null ||
      player.difference < Number(filters.minDifference))
  ) {
    return false;
  }

  if (
    filters.maxDifference != null &&
    (player.difference == null ||
      player.difference > Number(filters.maxDifference))
  ) {
    return false;
  }

  return true;
}

function sortPlayers(players, sort) {
  const list = [...players];

  switch (sort) {
    case 'price-asc':
      return list.sort(
        (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
      );

    case 'price-desc':
      return list.sort(
        (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity)
      );

    case 'base-gap-lowest':
      return list.sort(
        (a, b) => (a.difference ?? Infinity) - (b.difference ?? Infinity)
      );

    case 'base-gap-highest':
      return list.sort(
        (a, b) => (b.difference ?? -Infinity) - (a.difference ?? -Infinity)
      );

    case 'change-up':
      return list.sort(
        (a, b) => {
          const av =
            a.changeDirection === 'up'
              ? a.change
              : 0;

          const bv =
            b.changeDirection === 'up'
              ? b.change
              : 0;

          return bv - av;
        }
      );

    case 'change-down':
      return list.sort(
        (a, b) => {
          const av =
            a.changeDirection === 'down'
              ? a.change
              : 0;

          const bv =
            b.changeDirection === 'down'
              ? b.change
              : 0;

          return bv - av;
        }
      );

    case 'change-largest':
      return list.sort(
        (a, b) => (b.change ?? 0) - (a.change ?? 0)
      );

    case 'name':
      return list.sort(
        (a, b) =>
          String(a.name).localeCompare(
            String(b.name)
          )
      );

    default:
      return list;
  }
}

module.exports = {
  matchesPlayer,
  sortPlayers
};