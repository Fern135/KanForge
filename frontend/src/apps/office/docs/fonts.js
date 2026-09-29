// Fonts and sizes for the Docs toolbar. The stacks must match the server's
// allow-list (backend apps/office/docContent.js) exactly.
export const FONTS = [
  { label: 'Calibri', value: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, "Liberation Sans", Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", "Liberation Serif", Times, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Cambria', value: 'Cambria, Caladea, Georgia, serif' },
  { label: 'Garamond', value: 'Garamond, "EB Garamond", Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Arial, sans-serif' },
  { label: 'Courier New', value: '"Courier New", "Liberation Mono", Courier, monospace' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", "Comic Neue", cursive' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
];

// Word's defaults: Calibri 11pt.
export const DEFAULT_FONT = FONTS[0];
export const DEFAULT_SIZE = 11;
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const LINE_SPACINGS = ['1', '1.15', '1.5', '2', '2.5', '3'];

export const fontLabel = (value) => FONTS.find((f) => f.value === value)?.label ?? DEFAULT_FONT.label;

// Page sizes in millimetres.
export const PAGE_SIZES = {
  letter: { label: 'Letter (8.5" × 11")', width: 215.9, height: 279.4 },
  legal: { label: 'Legal (8.5" × 14")', width: 215.9, height: 355.6 },
  a4: { label: 'A4 (210 × 297 mm)', width: 210, height: 297 },
  a5: { label: 'A5 (148 × 210 mm)', width: 148, height: 210 },
};

export const mmToPx = (mm) => (mm * 96) / 25.4;

export function pageBox(settings) {
  const size = PAGE_SIZES[settings.pageSize] ?? PAGE_SIZES.letter;
  const landscape = settings.orientation === 'landscape';
  return { width: landscape ? size.height : size.width, height: landscape ? size.width : size.height };
}
