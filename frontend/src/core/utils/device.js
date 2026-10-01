// A readable name for the device behind a browser's User-Agent, e.g. "Chrome on
// macOS". Good enough to recognise your own devices; not a full parser.
const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS = [
  [/iPhone/, 'iPhone', 'phone'],
  [/iPad/, 'iPad', 'tablet'],
  [/Android/, 'Android', 'phone'],
  [/CrOS/, 'ChromeOS', 'computer'],
  [/Windows/, 'Windows', 'computer'],
  [/Mac OS X|Macintosh/, 'macOS', 'computer'],
  [/Linux/, 'Linux', 'computer'],
];

export function describeDevice(userAgent = '') {
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const [, system, kind] = SYSTEMS.find(([re]) => re.test(userAgent)) ?? [null, null, 'computer'];
  const name = browser && system ? `${browser} on ${system}` : browser || system || 'Unknown device';
  return { name, kind };
}
