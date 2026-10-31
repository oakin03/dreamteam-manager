// Player rating (S+ … D-, X) as a colored badge, the same everywhere: S purple, A blue,
// B green, C gray, D dark, X orange.
export const gradeToneClass = grade => {
  const first = String(grade || '').trim().toUpperCase().charAt(0);
  if (first === 'X') return 'grade-x';
  return ['S', 'A', 'B', 'C', 'D'].includes(first) ? `grade-${first.toLowerCase()}` : 'grade-neutral';
};

export default function RatingBadge({ grade, mini = false, title }) {
  return <span className={`grade-badge ${mini ? 'mini ' : ''}${gradeToneClass(grade)}`} title={title}>{grade || '—'}</span>;
}
