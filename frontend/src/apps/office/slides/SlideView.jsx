import { memo, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage } from '@fortawesome/free-solid-svg-icons';
import { imageUrl as fetchImageUrl } from '../docs/images';
import ChartView from './ChartView';
import { iconShape } from './icons';
import {
  PLACEHOLDER, backgroundCss, shapeColors, shapePath, showsFooter, slideSize, textCss, themeOf,
} from './model';

// Image URLs already loaded, so thumbnails and printing draw them straight away.
const loaded = new Map();

export const loadImage = (imageId) => fetchImageUrl(imageId).then((url) => {
  loaded.set(imageId, url);
  return url;
});

function SlideImage({ el }) {
  const [src, setSrc] = useState(() => loaded.get(el.imageId) ?? null);
  useEffect(() => {
    let live = true;
    loadImage(el.imageId).then((url) => live && setSrc(url)).catch(() => {});
    return () => {
      live = false;
    };
  }, [el.imageId]);
  const radius = el.radius ? `${el.radius}%` : undefined;
  return src
    ? <img src={src} alt="" draggable={false} className="slide-img" style={{ borderRadius: radius }} />
    : <div className="slide-img slide-img-loading" style={{ borderRadius: radius }} />;
}

// The shape outline, stretched to the element's box.
function ShapeSvg({ el, accent }) {
  const { fill, stroke, strokeWidth } = shapeColors(el, accent);
  const { w, h } = el;
  if (el.shape === 'line') {
    return (
      <svg className="slide-shape-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    );
  }
  // Inset by half the outline so thick outlines stay inside the box.
  const inset = strokeWidth / 2;
  return (
    <svg className="slide-shape-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={shapePath(el.shape, Math.max(1, w - strokeWidth), Math.max(1, h - strokeWidth))} transform={`translate(${inset} ${inset})`}
        fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}

// Text as lines, or as a bulleted / numbered list. Always rendered as text, never markup.
export function SlideText({ el, theme, placeholders }) {
  const css = textCss(el, theme);
  const empty = !el.text;
  const hint = placeholders && empty && el.ph ? PLACEHOLDER[el.ph] : null;
  const list = el.style?.list;
  const mark = el.style?.highlight ? { backgroundColor: el.style.highlight } : null;
  const line = (t) => (mark ? <span className="slide-mark" style={mark}>{t}</span> : t);
  let body;
  if (hint) body = <div className="slide-placeholder">{hint}</div>;
  else if (list && el.text) {
    const Tag = list === 'number' ? 'ol' : 'ul';
    body = <Tag className="slide-list">{el.text.split('\n').map((t, i) => <li key={i}>{t ? line(t) : ' '}</li>)}</Tag>;
  } else body = <div className="slide-lines">{line(el.text)}</div>;
  return (
    <div className="slide-text" style={css}>
      {body}
    </div>
  );
}

function SlideTable({ el, theme }) {
  const css = textCss({ ...el, type: 'text' }, theme);
  const border = el.border === 'none' ? 'transparent' : el.border ?? (theme.dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.22)');
  const headerFill = el.headerFill === 'none' ? 'transparent' : el.headerFill ?? theme.accent;
  const fill = el.fill === 'none' || !el.fill ? 'transparent' : el.fill;
  return (
    <table className="slide-table" style={{ fontFamily: css.fontFamily, fontSize: css.fontSize, color: css.color, fontWeight: css.fontWeight, fontStyle: css.fontStyle }}>
      <tbody>
        {el.cells.map((row, r) => {
          const head = el.header && r === 0;
          return (
            <tr key={r} style={{ height: `${100 / el.rows}%` }}>
              {row.map((cell, c) => (
                <td key={c} style={{
                  borderColor: border,
                  background: head ? headerFill : fill,
                  color: head && !el.style?.color && el.headerFill !== 'none' ? '#ffffff' : undefined,
                  fontWeight: head ? 700 : undefined,
                  textAlign: el.style?.align ?? 'left',
                }}>{cell}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SlideIcon({ el, theme }) {
  const { width, height, path } = iconShape(el.icon);
  return (
    <svg className="slide-shape-svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} fill={el.color ?? theme.accent} />
    </svg>
  );
}

function PicturePlaceholder() {
  return (
    <div className="slide-picture-ph">
      <FontAwesomeIcon icon={faImage} />
      <span>{PLACEHOLDER.picture}</span>
    </div>
  );
}

// Mirrors the item's drawing (not its text) when it's flipped.
const flip = (el) => (el.flipH || el.flipV ? { transform: `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` } : undefined);

// What an item draws inside its box.
export function SlideElement({ el, theme, placeholders, surface }) {
  switch (el.type) {
    case 'image':
      return <div className="slide-fill" style={flip(el)}><SlideImage el={el} /></div>;
    case 'shape':
      return (
        <>
          <div className="slide-fill" style={flip(el)}><ShapeSvg el={el} accent={theme.accent} /></div>
          {el.text && el.shape !== 'line' && <SlideText el={el} theme={theme} />}
        </>
      );
    case 'table':
      return <SlideTable el={el} theme={theme} />;
    case 'chart':
      return <ChartView el={el} theme={theme} surface={surface} />;
    case 'icon':
      return <div className="slide-fill" style={flip(el)}><SlideIcon el={el} theme={theme} /></div>;
    default:
      if (el.ph === 'picture') return placeholders ? <PicturePlaceholder /> : null;
      return <SlideText el={el} theme={theme} placeholders={placeholders} />;
  }
}

// Position, size, rotation, opacity and shadow of an item's box.
export function boxStyle(el, box = el) {
  return {
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    opacity: el.opacity,
    filter: el.shadow ? 'drop-shadow(3px 5px 6px rgba(0, 0, 0, 0.35))' : undefined,
  };
}

function Decoration({ theme, W, H }) {
  const a = theme.accent;
  switch (theme.deco) {
    case 'bar': return <div className="slide-deco" style={{ left: 0, top: 0, width: 14, height: H, background: a }} />;
    case 'band': return <div className="slide-deco" style={{ left: 0, top: H - 16, width: W, height: 16, background: a }} />;
    case 'underline': return <div className="slide-deco" style={{ left: W / 12 + 7, top: 124, width: 110, height: 5, borderRadius: 3, background: a }} />;
    case 'corner':
      return (
        <>
          <div className="slide-deco" style={{ left: W - 170, top: -170, width: 340, height: 340, borderRadius: '50%', background: a, opacity: 0.18 }} />
          <div className="slide-deco" style={{ left: W - 70, top: -70, width: 140, height: 140, borderRadius: '50%', background: a, opacity: 0.3 }} />
        </>
      );
    default: return null;
  }
}

function Footer({ deck, index, theme, W, H }) {
  const style = { fontFamily: theme.font, color: theme.text };
  return (
    <>
      {deck.footer.text && <div className="slide-footer" style={{ ...style, left: W / 12, top: H - 40, width: W / 2 }}>{deck.footer.text}</div>}
      {deck.footer.number && <div className="slide-footer" style={{ ...style, left: W - W / 12 - 80, top: H - 40, width: 80, textAlign: 'right' }}>{index + 1}</div>}
    </>
  );
}

// One slide drawn at `width` CSS pixels wide.
//   index:        the slide's number (for the footer)
//   renderElement: lets the editor wrap items with selection and editing
//   hidden:       items not shown yet (slide show animations)
//   entering:     { id: animation } for items appearing right now
//   onLink:       makes linked items clickable (slide show)
function SlideView({
  deck, slide, index = 0, width, placeholders = false, renderElement, hidden, entering, onLink, className = '', children,
}) {
  const { w: W, h: H } = slideSize(deck);
  const theme = themeOf(deck);
  const scale = width / W;
  const surface = slide.background ?? theme.bg;
  return (
    <div className={`slide-frame ${className}`} style={{ width, height: H * scale }}>
      <div className="slide-surface" style={{ width: W, height: H, transform: `scale(${scale})`, background: backgroundCss(slide, theme) }}>
        <Decoration theme={theme} W={W} H={H} />
        {slide.elements.map((el) => {
          if (renderElement) return renderElement(el, theme, surface);
          if (hidden?.has(el.id)) return null;
          const anim = entering?.[el.id];
          const linked = onLink && el.link;
          return (
            <div key={el.id} className={`slide-el${anim ? ` anim-${anim}` : ''}${linked ? ' slide-link' : ''}`} style={boxStyle(el)}
              onClick={linked ? (e) => { e.stopPropagation(); onLink(el.link); } : undefined}
              title={linked ? el.link : undefined}>
              <SlideElement el={el} theme={theme} placeholders={placeholders} surface={surface} />
            </div>
          );
        })}
        {deck.footer && showsFooter(deck, index) && <Footer deck={deck} index={index} theme={theme} W={W} H={H} />}
        {children}
      </div>
    </div>
  );
}

export default memo(SlideView);
