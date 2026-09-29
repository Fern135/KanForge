import { mmToPx } from './fonts';

// A horizontal ruler over the page, like Word's: the margins are shaded and
// numbering starts at the left margin. Inches for US paper, centimetres otherwise.
export default function Ruler({ widthMm, margins, inches }) {
  const width = mmToPx(widthMm);
  const left = mmToPx(margins.left);
  const right = width - mmToPx(margins.right);
  const unit = inches ? 96 : 96 / 2.54; // px per inch or per cm
  const steps = inches ? 8 : 4; // ticks per unit
  const ticks = [];
  for (let i = -Math.floor((left / unit) * steps); left + (i * unit) / steps <= width; i += 1) {
    const x = left + (i * unit) / steps;
    if (x < 0) continue;
    const major = i % steps === 0;
    const half = !major && i % (steps / 2) === 0;
    ticks.push(
      <g key={i}>
        {major && i !== 0 ? (
          <text x={x} y={13} textAnchor="middle">{Math.abs(i / steps)}</text>
        ) : (
          <line x1={x} x2={x} y1={major ? 4 : half ? 7 : 9} y2={major ? 16 : half ? 13 : 11} />
        )}
      </g>,
    );
  }
  return (
    <div className="doc-ruler" style={{ width }} aria-hidden="true">
      <svg width={width} height={20}>
        <rect x={0} y={2} width={left} height={16} className="margin" />
        <rect x={right} y={2} width={width - right} height={16} className="margin" />
        {ticks}
        <path d={`M${left - 5},2 L${left + 5},2 L${left},8 Z`} className="marker" />
        <path d={`M${right - 5},2 L${right + 5},2 L${right},8 Z`} className="marker" />
      </svg>
    </div>
  );
}
