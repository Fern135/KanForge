import { memo, useEffect, useState } from 'react';
import { imageUrl as fetchImageUrl } from '../docs/images';
import {
  PLACEHOLDER, shapeColors, slideSize, textCss, themeOf,
} from './model';

// Image URLs already loaded, so thumbnails and printing draw them straight away.
const loaded = new Map();

export const loadImage = (imageId) => fetchImageUrl(imageId).then((url) => {
  loaded.set(imageId, url);
  return url;
});

function SlideImage({ imageId }) {
  const [src, setSrc] = useState(() => loaded.get(imageId) ?? null);
  useEffect(() => {
    let live = true;
    loadImage(imageId).then((url) => live && setSrc(url)).catch(() => {});
    return () => {
      live = false;
    };
  }, [imageId]);
  return src
    ? <img src={src} alt="" draggable={false} className="slide-img" />
    : <div className="slide-img slide-img-loading" />;
}

// The shape outline, stretched to the element's box.
function ShapeSvg({ el, accent }) {
  const { fill, stroke, strokeWidth: sw } = shapeColors(el, accent);
  const { w, h } = el;
  const half = sw / 2;
  const common = { fill, stroke, strokeWidth: sw };
  let shape;
  switch (el.shape) {
    case 'ellipse':
      shape = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - half)} ry={Math.max(0, h / 2 - half)} {...common} />;
      break;
    case 'roundRect':
      shape = <rect x={half} y={half} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={Math.min(w, h) * 0.15} {...common} />;
      break;
    case 'triangle':
      shape = <polygon points={`${w / 2},${half} ${w - half},${h - half} ${half},${h - half}`} {...common} />;
      break;
    case 'arrow': {
      const head = Math.min(w * 0.4, h);
      shape = <polygon points={`0,${h * 0.3} ${w - head},${h * 0.3} ${w - head},0 ${w},${h / 2} ${w - head},${h} ${w - head},${h * 0.7} 0,${h * 0.7}`} {...common} />;
      break;
    }
    case 'line':
      shape = <line x1={0} y1={h / 2} x2={w} y2={h / 2} {...common} />;
      break;
    default:
      shape = <rect x={half} y={half} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} {...common} />;
  }
  return <svg className="slide-shape-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">{shape}</svg>;
}

// Text as lines, or as a bulleted / numbered list. Always rendered as text, never markup.
export function SlideText({ el, theme, placeholders }) {
  const css = textCss(el, theme);
  const empty = !el.text;
  const hint = placeholders && empty && el.ph ? PLACEHOLDER[el.ph] : null;
  const list = el.style?.list;
  let body;
  if (hint) body = <div className="slide-placeholder">{hint}</div>;
  else if (list && el.text) {
    const Tag = list === 'number' ? 'ol' : 'ul';
    body = <Tag className="slide-list">{el.text.split('\n').map((line, i) => <li key={i}>{line || ' '}</li>)}</Tag>;
  } else body = <div className="slide-lines">{el.text}</div>;
  return (
    <div className="slide-text" style={css}>
      {body}
    </div>
  );
}

export function SlideElement({ el, theme, placeholders }) {
  if (el.type === 'image') return <SlideImage imageId={el.imageId} />;
  if (el.type === 'shape') {
    return (
      <>
        <ShapeSvg el={el} accent={theme.accent} />
        {el.text && el.shape !== 'line' && <SlideText el={el} theme={theme} />}
      </>
    );
  }
  return <SlideText el={el} theme={theme} placeholders={placeholders} />;
}

// One slide drawn at `width` CSS pixels wide. `renderElement` lets the editor
// wrap elements with selection and editing behaviour.
function SlideView({ deck, slide, width, placeholders = false, renderElement, className = '', children }) {
  const { w: W, h: H } = slideSize(deck);
  const theme = themeOf(deck);
  const scale = width / W;
  return (
    <div className={`slide-frame ${className}`} style={{ width, height: H * scale }}>
      <div className="slide-surface" style={{ width: W, height: H, transform: `scale(${scale})`, background: slide.background ?? theme.bg }}>
        {slide.elements.map((el) => (renderElement ? renderElement(el, theme) : (
          <div key={el.id} className="slide-el" style={{ left: el.x, top: el.y, width: el.w, height: el.h }}>
            <SlideElement el={el} theme={theme} placeholders={placeholders} />
          </div>
        )))}
        {children}
      </div>
    </div>
  );
}

export default memo(SlideView);
