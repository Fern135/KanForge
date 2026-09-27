export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export default function Avatar({ name, small = false, stacked = false }) {
  return (
    <span className={`avatar ${small ? 'avatar-sm' : ''} ${stacked ? 'stacked' : ''}`} title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}
