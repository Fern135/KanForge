import { generateJSON } from '@tiptap/core';
import { docExtensions } from './extensions';
import { uploadBase64 } from './images';

// Opens a .docx: mammoth turns it into clean HTML (headings, lists, tables,
// bold/italic/underline, links, images), images are uploaded, and the HTML is
// read through the Docs schema. Fonts, colours, page breaks and exact layout are not kept.
// Loaded only when someone imports.
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  'u => u',
  'strike => s',
  "r[style-name='Strong'] => strong",
];

export async function importDocx(file) {
  const mammoth = await import('mammoth');
  const convert = mammoth.default?.convertToHtml ?? mammoth.convertToHtml;
  const images = mammoth.default?.images ?? mammoth.images;
  const failed = [];
  const { value: html, messages } = await convert(
    { arrayBuffer: await file.arrayBuffer() },
    {
      styleMap: STYLE_MAP,
      convertImage: images.imgElement(async (image) => {
        try {
          const { imageId } = await uploadBase64(await image.read('base64'), image.contentType);
          return { src: `kf-image:${imageId}` };
        } catch (err) {
          failed.push(err.message);
          return { src: '' };
        }
      }),
    },
  );
  const content = generateJSON(html || '<p></p>', docExtensions);
  return {
    title: file.name.replace(/\.docx$/i, '').slice(0, 200),
    content,
    warnings: failed.length ? `${failed.length} image${failed.length === 1 ? '' : 's'} could not be imported.` : null,
    unsupported: messages.filter((m) => m.type === 'warning').length,
  };
}
