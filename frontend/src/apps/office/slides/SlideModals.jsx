import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import Modal from '../../../core/components/Modal';
import { ColorGrid } from '../docs/ui';
import ChartView from './ChartView';
import { ICONS, ICON_NAMES } from './icons';
import { CHARTS, LIMITS } from './model';

const Footer = ({ onClose, onSave, disabled, label = 'Save' }) => (
  <>
    <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
    <button type="button" className="btn btn-primary" onClick={onSave} disabled={disabled}>{label}</button>
  </>
);

// Edit a chart's type, title and data, with a live preview.
export function ChartDataModal({ el, theme, onSave, onClose }) {
  const [chart, setChart] = useState({ chart: el.chart, title: el.title, legend: el.legend, labels: [...el.labels], series: el.series.map((s) => ({ name: s.name, values: [...s.values] })) });
  // Numbers are edited as text so "-" and "1." can be typed.
  const [raw, setRaw] = useState(() => el.series.map((s) => s.values.map(String)));
  const pie = chart.chart === 'pie' || chart.chart === 'donut';

  const update = (fn) => setChart((c) => fn({ ...c, labels: [...c.labels], series: c.series.map((s) => ({ ...s, values: [...s.values] })) }));
  const setValue = (si, i, text) => {
    setRaw((r) => r.map((row, a) => (a === si ? row.map((v, b) => (b === i ? text : v)) : row)));
    const n = parseFloat(text.replace(/,/g, ''));
    update((c) => {
      c.series[si].values[i] = Number.isFinite(n) ? n : 0;
      return c;
    });
  };
  const addRow = () => {
    update((c) => {
      c.labels.push(`Item ${c.labels.length + 1}`);
      c.series.forEach((s) => s.values.push(0));
      return c;
    });
    setRaw((r) => r.map((row) => [...row, '0']));
  };
  const removeRow = (i) => {
    update((c) => {
      c.labels.splice(i, 1);
      c.series.forEach((s) => s.values.splice(i, 1));
      return c;
    });
    setRaw((r) => r.map((row) => row.filter((_, b) => b !== i)));
  };
  const addSeries = () => {
    update((c) => {
      c.series.push({ name: `Series ${c.series.length + 1}`, values: c.labels.map(() => 0) });
      return c;
    });
    setRaw((r) => [...r, chart.labels.map(() => '0')]);
  };
  const removeSeries = (si) => {
    update((c) => {
      c.series.splice(si, 1);
      return c;
    });
    setRaw((r) => r.filter((_, a) => a !== si));
  };

  const preview = { ...el, ...chart, w: 420, h: 240 };
  return (
    <Modal title="Chart data" size="lg" onClose={onClose}
      footer={<Footer onClose={onClose} onSave={() => { onSave(chart); onClose(); }} disabled={!chart.labels.length} />}>
      <div className="row g-3">
        <div className="col-md-5">
          <label className="form-label small fw-semibold" htmlFor="chart-type">Type</label>
          <select id="chart-type" className="form-select form-select-sm mb-2" value={chart.chart} onChange={(e) => update((c) => ({ ...c, chart: e.target.value }))}>
            {CHARTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <label className="form-label small fw-semibold" htmlFor="chart-title">Title</label>
          <input id="chart-title" className="form-control form-control-sm mb-2" maxLength={120} value={chart.title} onChange={(e) => update((c) => ({ ...c, title: e.target.value }))} />
          <div className="form-check form-switch mb-3">
            <input id="chart-legend" className="form-check-input" type="checkbox" checked={chart.legend} onChange={(e) => update((c) => ({ ...c, legend: e.target.checked }))} />
            <label className="form-check-label small" htmlFor="chart-legend">Show legend</label>
          </div>
          <div className="slide-chart-preview" style={{ background: theme.bg }}>
            <ChartView el={preview} theme={theme} surface={theme.bg} />
          </div>
          {pie && chart.series.length > 1 && <p className="small text-muted mt-2 mb-0">Pie and donut charts show the first series only.</p>}
        </div>
        <div className="col-md-7">
          <div className="table-responsive slide-data-grid">
            <table className="table table-sm align-middle mb-2">
              <thead>
                <tr>
                  <th>Label</th>
                  {chart.series.map((s, si) => (
                    <th key={si}>
                      <div className="d-flex gap-1">
                        <input className="form-control form-control-sm" value={s.name} maxLength={60} aria-label={`Series ${si + 1} name`}
                          onChange={(e) => update((c) => { c.series[si].name = e.target.value; return c; })} />
                        {chart.series.length > 1 && (
                          <button type="button" className="btn btn-sm btn-light" aria-label="Remove series" onClick={() => removeSeries(si)}><FontAwesomeIcon icon={faTrashCan} /></button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {chart.labels.map((label, i) => (
                  <tr key={i}>
                    <td><input className="form-control form-control-sm" value={label} maxLength={60} aria-label={`Label ${i + 1}`}
                      onChange={(e) => update((c) => { c.labels[i] = e.target.value; return c; })} /></td>
                    {chart.series.map((s, si) => (
                      <td key={si}><input className="form-control form-control-sm text-end" inputMode="decimal" value={raw[si]?.[i] ?? '0'}
                        aria-label={`${s.name} ${label}`} onChange={(e) => setValue(si, i, e.target.value)} /></td>
                    ))}
                    <td><button type="button" className="btn btn-sm btn-light" aria-label="Remove row" disabled={chart.labels.length < 2} onClick={() => removeRow(i)}><FontAwesomeIcon icon={faTrashCan} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-outline-primary" disabled={chart.labels.length >= LIMITS.chartLabels} onClick={addRow}><FontAwesomeIcon icon={faPlus} className="me-1" />Row</button>
            <button type="button" className="btn btn-sm btn-outline-primary" disabled={chart.series.length >= LIMITS.chartSeries} onClick={addSeries}><FontAwesomeIcon icon={faPlus} className="me-1" />Series</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function IconPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const names = useMemo(() => ICON_NAMES.filter((n) => n.includes(q.trim().toLowerCase().replace(/\s+/g, '-'))), [q]);
  return (
    <Modal title="Insert icon" onClose={onClose}>
      <input className="form-control mb-3" placeholder="Search icons" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search icons" />
      <div className="slide-icon-grid">
        {names.map((n) => (
          <button key={n} type="button" className="slide-icon-btn" title={n.replace(/-/g, ' ')} aria-label={n.replace(/-/g, ' ')}
            onClick={() => { onPick(n); onClose(); }}>
            <FontAwesomeIcon icon={ICONS.get(n)} />
          </button>
        ))}
        {!names.length && <p className="text-muted small mb-0">No icons match.</p>}
      </div>
    </Modal>
  );
}

const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s<>"]+$/i;

export function LinkModal({ current, onSave, onClose }) {
  const [url, setUrl] = useState(current ?? '');
  const fixed = /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
  const ok = SAFE_LINK.test(fixed) && fixed.length <= 2048;
  return (
    <Modal title="Link" onClose={onClose}
      footer={(
        <>
          {current && <button type="button" className="btn btn-outline-danger me-auto" onClick={() => { onSave(null); onClose(); }}>Remove link</button>}
          <Footer onClose={onClose} onSave={() => { onSave(fixed); onClose(); }} disabled={!ok} />
        </>
      )}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) { onSave(fixed); onClose(); } }}>
        <label className="form-label fw-semibold" htmlFor="slide-link">Web address or email</label>
        <input id="slide-link" className="form-control" placeholder="https://example.com or mailto:name@example.com" value={url}
          onChange={(e) => setUrl(e.target.value)} autoFocus />
        <div className="form-text">Links open in a new tab when you click the item during a slide show.</div>
      </form>
    </Modal>
  );
}

export function FooterModal({ footer, onSave, onClose }) {
  const [f, setF] = useState(footer);
  return (
    <Modal title="Header and footer" onClose={onClose} footer={<Footer onClose={onClose} onSave={() => { onSave(f); onClose(); }} label="Apply to all" />}>
      <div className="form-check mb-2">
        <input id="ft-number" className="form-check-input" type="checkbox" checked={f.number} onChange={(e) => setF({ ...f, number: e.target.checked })} />
        <label className="form-check-label" htmlFor="ft-number">Slide number</label>
      </div>
      <label className="form-label fw-semibold" htmlFor="ft-text">Footer</label>
      <input id="ft-text" className="form-control mb-2" maxLength={200} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
      <div className="form-check">
        <input id="ft-skip" className="form-check-input" type="checkbox" checked={f.skipFirst} onChange={(e) => setF({ ...f, skipFirst: e.target.checked })} />
        <label className="form-check-label" htmlFor="ft-skip">Don&apos;t show on the first slide</label>
      </div>
    </Modal>
  );
}

const ANGLES = [[0, 'Bottom to top'], [90, 'Left to right'], [135, 'Diagonal'], [180, 'Top to bottom'], [225, 'Diagonal, reversed']];

// A solid colour or a two-colour gradient.
export function BackgroundModal({ slide, onSave, onApplyAll, onClose }) {
  const [bg, setBg] = useState({ background: slide.background, background2: slide.background2, bgAngle: slide.bgAngle ?? 135 });
  const preview = bg.background
    ? bg.background2 ? `linear-gradient(${bg.bgAngle}deg, ${bg.background}, ${bg.background2})` : bg.background
    : undefined;
  return (
    <Modal title="Slide background" onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary me-auto" onClick={() => { onApplyAll(bg); onClose(); }}>Apply to all</button>
          <Footer onClose={onClose} onSave={() => { onSave(bg); onClose(); }} />
        </>
      )}>
      <div className="slide-bg-preview mb-3" style={{ background: preview }}>{!bg.background && 'Theme background'}</div>
      <div className="row g-3">
        <div className="col-sm-6">
          <div className="small fw-semibold mb-1">Color</div>
          <ColorGrid close={() => {}} resetLabel="Theme background" onPick={(c) => setBg((b) => ({ ...b, background: c, background2: c ? b.background2 : null }))} />
        </div>
        <div className="col-sm-6">
          <div className="small fw-semibold mb-1">Gradient to</div>
          <ColorGrid close={() => {}} resetLabel="No gradient" onPick={(c) => setBg((b) => ({ ...b, background2: c, background: b.background ?? '#ffffff' }))} />
          <label className="form-label small fw-semibold mt-2" htmlFor="bg-angle">Direction</label>
          <select id="bg-angle" className="form-select form-select-sm" value={bg.bgAngle} disabled={!bg.background2}
            onChange={(e) => setBg((b) => ({ ...b, bgAngle: Number(e.target.value) }))}>
            {ANGLES.map(([a, label]) => <option key={a} value={a}>{label}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}
