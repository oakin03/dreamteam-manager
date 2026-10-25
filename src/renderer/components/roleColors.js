// A role badge's colors: its own color as the fill and black or white text, whichever
// reads better on it (white on orange or light green was hard to read).
export function roleColors(color) {
  const c = /^#([0-9a-f]{6})$/i.test(color || '') ? color : '#64748b';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { backgroundColor: c, borderColor: c, color: lum > 0.32 ? '#151a24' : '#ffffff' };
}
