import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAlignLeft, faAlignCenter, faAlignRight, faImage } from '@fortawesome/free-solid-svg-icons';
import { imageUrl } from './images';

// An image in a document: loads through the signed-in session, and when
// selected shows alignment buttons and a corner handle to resize, like Word.
export default function DocImageView({ node, updateAttributes, selected, editor }) {
  const { imageId, width, alt, align } = node.attrs;
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);
  const editable = editor.isEditable;

  useEffect(() => {
    let alive = true;
    setFailed(false);
    imageUrl(imageId).then((u) => alive && setSrc(u)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [imageId]);

  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = imgRef.current?.getBoundingClientRect().width || width || 300;
    // The page may be zoomed, so convert screen pixels back to document pixels.
    const zoom = startWidth / (imgRef.current?.offsetWidth || startWidth);
    const max = imgRef.current?.closest('.ProseMirror')?.clientWidth || 2000;
    const onMove = (ev) => {
      const next = Math.round((startWidth + (ev.clientX - startX)) / zoom);
      updateAttributes({ width: Math.max(24, Math.min(max, next)) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <NodeViewWrapper className={`doc-image align-${align} ${selected ? 'is-selected' : ''}`} data-drag-handle>
      <span className="doc-image-frame" style={{ width: width ? `${width}px` : undefined }}>
        {failed ? (
          <span className="doc-image-missing"><FontAwesomeIcon icon={faImage} className="me-2" />Image unavailable</span>
        ) : src ? (
          <img ref={imgRef} src={src} alt={alt} draggable={false} style={{ width: width ? `${width}px` : undefined }} />
        ) : (
          <span className="doc-image-missing">Loading image…</span>
        )}
        {selected && editable && (
          <>
            <span className="doc-image-tools" contentEditable={false}>
              {[['left', faAlignLeft], ['center', faAlignCenter], ['right', faAlignRight]].map(([a, icon]) => (
                <button key={a} type="button" className={align === a ? 'active' : ''} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateAttributes({ align: a })} aria-label={`Align image ${a}`} title={`Align ${a}`}>
                  <FontAwesomeIcon icon={icon} />
                </button>
              ))}
            </span>
            <span className="doc-image-handle" onPointerDown={startResize} aria-hidden="true" />
          </>
        )}
      </span>
    </NodeViewWrapper>
  );
}
