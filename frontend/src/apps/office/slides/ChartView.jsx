import { chartColors } from './model';

// Charts drawn as SVG in the item's own box (slide points). Colours come from
// the validated chart palette in fixed order; values are labelled directly
// (some palette steps are under 3:1 contrast on some backgrounds, so colour is
// never the only way to read a value), and each mark has a hover tooltip.

const fmt = (n) => (Math.abs(n) >= 1e6 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n));

// Round axis bounds and a step of 1, 2 or 5 × 10^n.
function niceScale(min, max, ticks = 5) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max) || 1;
  const raw = (hi - lo) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

function Legend({ items, x, y, w, size, color }) {
  // Laid out in one centred row; long legends wrap by shrinking spacing.
  const widths = items.map((it) => 14 + it.name.length * size * 0.55 + 16);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = x + Math.max(0, (w - total) / 2);
  return (
    <g>
      {items.map((it, i) => {
        const at = cx;
        cx += widths[i];
        return (
          <g key={i}>
            <rect x={at} y={y - size * 0.4} width={size * 0.8} height={size * 0.8} rx={2} fill={it.color} />
            <text x={at + size * 0.8 + 5} y={y} dominantBaseline="middle" fontSize={size} fill={color}>{it.name}</text>
          </g>
        );
      })}
    </g>
  );
}

function Pie({ el, colors, box, ink, surface }) {
  const values = (el.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.max(4, Math.min(box.w, box.h) / 2 - 4);
  const inner = el.chart === 'donut' ? r * 0.55 : 0;
  let a0 = -Math.PI / 2;
  const size = Math.max(9, Math.min(16, r / 7));
  return (
    <g>
      {values.map((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (a, rr) => `${cx + Math.cos(a) * rr} ${cy + Math.sin(a) * rr}`;
        const d = v >= total
          ? `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
          : inner
            ? `M${p(a0, r)} A${r} ${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, inner)} A${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z`
            : `M${cx} ${cy} L${p(a0, r)} A${r} ${r} 0 ${large} 1 ${p(a1, r)} Z`;
        const mid = (a0 + a1) / 2;
        const labelR = inner ? (r + inner) / 2 : r * 0.65;
        const share = v / total;
        a0 = a1;
        return v > 0 ? (
          <g key={i}>
            <path d={d} fill={colors[i % colors.length]} stroke={surface} strokeWidth={2}>
              <title>{`${el.labels[i] || `Item ${i + 1}`}: ${fmt(v)} (${Math.round(share * 100)}%)`}</title>
            </path>
            {share >= 0.05 && (
              <text x={cx + Math.cos(mid) * labelR} y={cy + Math.sin(mid) * labelR} textAnchor="middle" dominantBaseline="middle"
                fontSize={size} fontWeight={600} fill="#ffffff" stroke="rgba(0,0,0,0.35)" strokeWidth={2.5} paintOrder="stroke">
                {Math.round(share * 100)}%
              </text>
            )}
          </g>
        ) : null;
      })}
      {!values.some((v) => v > 0) && <circle cx={cx} cy={cy} r={r} fill="none" stroke={ink} strokeOpacity={0.3} strokeDasharray="4 4" />}
    </g>
  );
}

function Cartesian({ el, colors, box, ink, surface }) {
  const horizontal = el.chart === 'bar';
  const n = el.labels.length || 1;
  const all = el.series.flatMap((s) => s.values);
  const { lo, hi, step } = niceScale(Math.min(0, ...all), Math.max(0, ...all));
  const size = Math.max(9, Math.min(14, (horizontal ? box.h : box.w) / (n * 3.2)));
  const axisW = horizontal ? Math.min(box.w * 0.3, 8 + Math.max(...el.labels.map((l) => l.length), 1) * size * 0.55) : fmt(hi).length * size * 0.6 + 10;
  const plot = horizontal
    ? { x: box.x + axisW, y: box.y + 4, w: box.w - axisW - 30, h: box.h - size - 12 }
    : { x: box.x + axisW, y: box.y + size + 6, w: box.w - axisW - 8, h: box.h - size * 2 - 14 };
  const len = horizontal ? plot.w : plot.h;
  const pos = (v) => ((v - lo) / (hi - lo)) * len;
  const band = (horizontal ? plot.h : plot.w) / n;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1e9) / 1e9);
  const zero = pos(0);
  const labelEvery = Math.ceil((n * size * 3) / (horizontal ? plot.h : plot.w));
  const showValues = el.series.length * n <= 30;

  const grid = ticks.map((t) => (horizontal ? (
    <g key={t}>
      <line x1={plot.x + pos(t)} x2={plot.x + pos(t)} y1={plot.y} y2={plot.y + plot.h} stroke={ink} strokeOpacity={t === 0 ? 0.45 : 0.12} />
      <text x={plot.x + pos(t)} y={plot.y + plot.h + size + 2} textAnchor="middle" fontSize={size * 0.9} fill={ink} fillOpacity={0.7}>{fmt(t)}</text>
    </g>
  ) : (
    <g key={t}>
      <line x1={plot.x} x2={plot.x + plot.w} y1={plot.y + plot.h - pos(t)} y2={plot.y + plot.h - pos(t)} stroke={ink} strokeOpacity={t === 0 ? 0.45 : 0.12} />
      <text x={plot.x - 6} y={plot.y + plot.h - pos(t)} textAnchor="end" dominantBaseline="middle" fontSize={size * 0.9} fill={ink} fillOpacity={0.7}>{fmt(t)}</text>
    </g>
  )));

  const categoryLabels = el.labels.map((label, i) => (i % labelEvery ? null : horizontal ? (
    <text key={i} x={plot.x - 6} y={plot.y + band * (i + 0.5)} textAnchor="end" dominantBaseline="middle" fontSize={size} fill={ink}>{label}</text>
  ) : (
    <text key={i} x={plot.x + band * (i + 0.5)} y={plot.y + plot.h + size + 4} textAnchor="middle" fontSize={size} fill={ink}>{label}</text>
  )));

  let marks;
  if (el.chart === 'line' || el.chart === 'area') {
    marks = el.series.map((s, si) => {
      const pts = s.values.map((v, i) => [plot.x + band * (i + 0.5), plot.y + plot.h - pos(v)]);
      const color = colors[si % colors.length];
      const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
      return (
        <g key={si}>
          {el.chart === 'area' && pts.length > 1 && (
            <path d={`${line} L${pts[pts.length - 1][0]} ${plot.y + plot.h - zero} L${pts[0][0]} ${plot.y + plot.h - zero} Z`} fill={color} fillOpacity={0.22} />
          )}
          <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={4.5} fill={color} stroke={surface} strokeWidth={2}>
              <title>{`${s.name || `Series ${si + 1}`}, ${el.labels[i] || ''}: ${fmt(s.values[i])}`}</title>
            </circle>
          ))}
          {showValues && pts.map(([x, y], i) => (
            <text key={`v${i}`} x={x} y={y - 9} textAnchor="middle" fontSize={size * 0.85} fill={ink}>{fmt(s.values[i])}</text>
          ))}
        </g>
      );
    });
  } else {
    const count = el.series.length;
    const gap = 2;
    const inner = band * 0.72;
    const barW = Math.max(1, (inner - gap * (count - 1)) / count);
    marks = el.series.map((s, si) => s.values.map((v, i) => {
      const start = band * i + (band - inner) / 2 + si * (barW + gap);
      const a = Math.min(pos(v), zero);
      const b = Math.max(pos(v), zero);
      const color = colors[si % colors.length];
      const tip = <title>{`${s.name || `Series ${si + 1}`}, ${el.labels[i] || ''}: ${fmt(v)}`}</title>;
      const r = Math.min(4, barW / 2);
      return horizontal ? (
        <g key={`${si}-${i}`}>
          <rect x={plot.x + a} y={plot.y + start} width={Math.max(0.5, b - a)} height={barW} rx={r} fill={color}>{tip}</rect>
          {showValues && <text x={plot.x + (v >= 0 ? b + 4 : a - 4)} y={plot.y + start + barW / 2} textAnchor={v >= 0 ? 'start' : 'end'} dominantBaseline="middle" fontSize={size * 0.85} fill={ink}>{fmt(v)}</text>}
        </g>
      ) : (
        <g key={`${si}-${i}`}>
          <rect x={plot.x + start} y={plot.y + plot.h - b} width={barW} height={Math.max(0.5, b - a)} rx={r} fill={color}>{tip}</rect>
          {showValues && <text x={plot.x + start + barW / 2} y={v >= 0 ? plot.y + plot.h - b - 5 : plot.y + plot.h - a + size} textAnchor="middle" fontSize={size * 0.85} fill={ink}>{fmt(v)}</text>}
        </g>
      );
    }));
  }

  return <g>{grid}{categoryLabels}{marks}</g>;
}

export default function ChartView({ el, theme, surface }) {
  const colors = chartColors(theme);
  const ink = el.style?.color ?? theme.text;
  const fontFamily = el.style?.font ?? theme.font;
  const pie = el.chart === 'pie' || el.chart === 'donut';
  const titleSize = Math.max(12, Math.min(28, el.h / 12));
  const legendSize = Math.max(10, Math.min(15, el.h / 22));
  const items = pie
    ? el.labels.map((name, i) => ({ name: name || `Item ${i + 1}`, color: colors[i % colors.length] }))
    : el.series.map((s, i) => ({ name: s.name || `Series ${i + 1}`, color: colors[i % colors.length] }));
  // A single series needs no legend: the title names it.
  const legend = el.legend && (pie || el.series.length > 1);
  const top = el.title ? titleSize + 10 : 4;
  const bottom = legend ? legendSize + 14 : 4;
  const box = { x: 6, y: top, w: el.w - 12, h: Math.max(20, el.h - top - bottom) };
  return (
    <svg className="slide-chart" viewBox={`0 0 ${el.w} ${el.h}`} style={{ fontFamily }} role="img" aria-label={el.title || 'Chart'}>
      {el.title && <text x={el.w / 2} y={titleSize} textAnchor="middle" fontSize={titleSize} fontWeight={700} fill={ink}>{el.title}</text>}
      {pie ? <Pie el={el} colors={colors} box={box} ink={ink} surface={surface} /> : <Cartesian el={el} colors={colors} box={box} ink={ink} surface={surface} />}
      {legend && <Legend items={items} x={0} y={el.h - legendSize / 2 - 4} w={el.w} size={legendSize} color={ink} />}
    </svg>
  );
}
