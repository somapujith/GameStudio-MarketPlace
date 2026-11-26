// GPU classification. Pure, table-driven, no dependencies: it turns the WebGL "unmasked renderer" string (plus a few caps and environment hints)
// into a small, stable description the rest of the engine (tier memory, calibration, governor) can reason about.
//
//   classifyRenderer('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)')
//     -> { class: 'integrated', vendor: 'AMD', model: 'Radeon Graphics', family: 'radeon-igpu', tflops: 1.2, ... }
//   classifyGpu({ gl, nav, win })   -> the full record: class, vendor, model, dpr, cores, memoryGB, refreshHz, caps, tierCap, key, reasons
//
// `class` is descriptive: 'software' (SwiftShader, llvmpipe, WARP, virtual GPUs), 'integrated' (shares memory with the CPU: Intel UHD / Iris / Xe, AMD
// "Radeon Graphics" / Vega N / 780M, Apple M-series), 'discrete' (NVIDIA GeForce / Quadro, AMD RX / Pro, Intel Arc A / B), 'mobile' (Adreno, Mali,
// PowerVR, Apple A-series, Xclipse) and 'unknown' (masked or empty string).
//
// `tflops` is an APPROXIMATE fp32 throughput (from public specs, rounded; only the ordering matters) and `tierCap` is the highest generic tier
// ('lite' < 'low' < 'medium' < 'high') the machine should START on before anything has been measured. An integrated GPU never starts on 'high'
// (Apple's M-series with 8+ TFLOPs (Pro / Max) are the exception that proves the table: it is throughput that decides, not the label).
// A wrong guess costs nothing for long: calibrate.js measures the real machine and governor.js corrects at run time.

export const TIER_ORDER = ['lite', 'low', 'medium', 'high'];
const tierIdx = (t) => TIER_ORDER.indexOf(t);
/** The lower of two tiers. */
export const minTier = (a, b) => (tierIdx(a) <= tierIdx(b) ? a : b);

/** Tiers a TFLOPs figure can START on (generic ladder; games map the names onto their own tier tables). */
export const TFLOPS_FOR_TIER = { low: 0.15, medium: 0.8, high: 8 };

// ---------------------------------------------------------------------------------------------------------------------------------
// string clean-up
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Splits Chrome's ANGLE wrapper ("ANGLE (vendor, renderer (0xdev) backend, driver)") and removes the noise that is not part of the model name.
 * Returns { renderer, vendor, raw }.
 */
export function cleanRenderer(raw, vendorHint = '') {
  const original = squash(raw);
  let vendor = squash(vendorHint);
  let s = original;
  const angle = /^ANGLE\s*\((.*)\)$/i.exec(s);
  if (angle) {
    const inner = angle[1];
    const parts = inner.split(/,\s+/);
    if (parts.length >= 2) {
      vendor = vendor || parts[0];
      // everything between the vendor and the trailing backend / driver field is the renderer (it may itself contain commas inside parentheses)
      s = parts.length >= 3 ? parts.slice(1, -1).join(', ') : parts[1];
    } else s = inner;
  }
  s = s
    .replace(/ANGLE Metal Renderer:\s*/i, '')
    .replace(/\(0x[0-9a-f]+\)/gi, '')
    .replace(/\bDirect3D\d*\b.*$/i, '')
    .replace(/\bD3D1[12]\b.*$/i, '')
    .replace(/\bVulkan [\d.]+\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/i, '$1')
    .replace(/\/PCIe\/SSE2/gi, '')
    .replace(/\bOpenGL( ES)?( Engine)?[\d. ]*$/i, '')
    .replace(/^Mesa\s+/i, '')
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\s*\((?:[A-Za-z0-9_ ]+,\s*)?(?:LLVM|DRM)[^)]*\)\s*$/i, '')
    .replace(/\s*\(\s*\)/g, '');
  return { renderer: squash(s), vendor, raw: original };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// throughput lookups: [model number, approximate fp32 TFLOPs], ascending. A model number takes the greatest entry <= it.
const NV_RTX = [[2060, 6.5], [2070, 7.5], [2080, 10], [3050, 9], [3060, 12.7], [3070, 20], [3080, 30], [3090, 35], [4050, 9], [4060, 15], [4070, 29], [4080, 48], [4090, 82], [5060, 19], [5070, 31], [5080, 56], [5090, 105]];
const NV_GTX = [[210, 0.1], [440, 0.3], [550, 0.7], [650, 0.8], [750, 1.3], [760, 2.3], [770, 3.2], [780, 4], [950, 1.8], [960, 2.3], [970, 3.5], [980, 5], [1030, 0.9], [1050, 1.9], [1060, 4], [1070, 6.5], [1080, 9], [1630, 2.3], [1650, 3], [1660, 5]];
const NV_MX = [[110, 0.4], [150, 1], [230, 0.6], [250, 1.3], [330, 1], [350, 1.9], [450, 2.5], [550, 3.2]];
const AMD_RX = [[460, 2.2], [470, 4.9], [480, 5.8], [550, 1.2], [560, 2.6], [570, 5.1], [580, 6.2], [590, 7.1], [5300, 3.5], [5500, 5.2], [5600, 7.2], [5700, 9.8], [6400, 3.6], [6500, 5.8], [6600, 8.9], [6700, 13], [6800, 16], [6900, 23], [6950, 23.6], [7600, 21], [7700, 35], [7800, 37], [7900, 52], [9060, 17], [9070, 28]];
const AMD_IGPU = [[610, 0.9], [660, 1.8], [680, 3.4], [740, 2.5], [760, 4.3], [780, 8.3], [840, 3.3], [860, 5.3], [880, 6], [890, 11]];
const ARC = [[310, 1.3], [380, 4], [580, 12], [750, 17], [770, 19.7]];
const ARC_B = [[570, 11.5], [580, 14]];
const MALI_G = [[31, 0.05], [51, 0.1], [52, 0.2], [57, 0.35], [68, 0.6], [71, 0.4], [72, 0.5], [76, 0.8], [77, 1.1], [78, 1.8], [310, 0.4], [510, 0.8], [610, 1.1], [710, 2.2], [715, 2.4], [720, 3], [725, 3.5], [925, 4.5]];
const MALI_T = [[604, 0.03], [720, 0.03], [760, 0.1], [820, 0.05], [830, 0.15], [860, 0.2], [880, 0.3]];
const APPLE_M = [2.6, 3.6, 4.1, 4.6, 5.4, 6.2]; // M1 .. M6 base chips (approximate)
const APPLE_SUFFIX = { '': 1, pro: 2, max: 4, ultra: 8 };

/** Greatest table entry with key <= n (clamped to the first entry). */
function lookup(table, n) {
  let v = table[0][1];
  for (const [k, t] of table) if (k <= n) v = t;
  return v;
}

const num = (m, i) => parseInt(m[i], 10);

// ---------------------------------------------------------------------------------------------------------------------------------
// The rule table. First match wins, so the order is the specificity order. `test` runs on the lower-cased cleaned renderer + vendor text.
// `model(m, s)` returns the display model; `tflops` a number or (m, s) => number.
const RULES = [
  // ---- software and virtual ------------------------------------------------------------------------------------------------
  { id: 'swiftshader', test: /swiftshader|subzero/, cls: 'software', vendor: 'Google', family: 'swiftshader', tflops: 0.02, model: () => 'SwiftShader' },
  { id: 'llvmpipe', test: /llvmpipe|softpipe|lavapipe/, cls: 'software', vendor: 'Mesa', family: 'llvmpipe', tflops: 0.03, model: (m) => m[0] },
  { id: 'warp', test: /microsoft basic render|basic render driver|\bwarp\b/, cls: 'software', vendor: 'Microsoft', family: 'warp', tflops: 0.05, model: () => 'Basic Render Driver' },
  { id: 'virtual', test: /vmware|svga3d|virtualbox|parallels|virgl|qxl|bochs|android emulator|^chromium\b|gdi generic/, cls: 'software', vendor: 'Virtual', family: 'virtual', tflops: 0.1, model: (m, s, r) => r },
  { id: 'software-generic', test: /software rasteri|apple software renderer|mesa offscreen|\bcpu\b|\bsoftware\b/, cls: 'software', vendor: 'Software', family: 'software', tflops: 0.02, model: (m, s, r) => r },

  // ---- Windows on ARM: Adreno X is a laptop-class integrated GPU ------------------------------------------------------------
  { id: 'adreno-x', test: /adreno\W*(?:tm\W*)?x\d/, cls: 'integrated', vendor: 'Qualcomm', family: 'adreno-x', tflops: 4.6, model: (m, s, r) => (/adreno\W*(?:\(?tm\)?\W*)?(x[\w-]+)/i.exec(r)?.[1] ? `Adreno ${/adreno\W*(?:\(?tm\)?\W*)?(x[\w-]+)/i.exec(r)[1].toUpperCase()}` : 'Adreno X') },

  // ---- Apple ---------------------------------------------------------------------------------------------------------------
  {
    id: 'apple-m', test: /apple m(\d)(?: (pro|max|ultra))?\b/, cls: 'integrated', vendor: 'Apple', family: 'apple-silicon',
    tflops: (m) => (APPLE_M[Math.min(num(m, 1), APPLE_M.length) - 1] ?? APPLE_M[APPLE_M.length - 1]) * (APPLE_SUFFIX[m[2] || ''] ?? 1),
    model: (m) => `M${m[1]}${m[2] ? ` ${m[2][0].toUpperCase()}${m[2].slice(1)}` : ''}`,
  },
  { id: 'apple-a', test: /apple a(\d{1,2})[xz]?\b/, cls: 'mobile', vendor: 'Apple', family: 'apple-a', tflops: (m) => Math.max(0.3, 0.5 + (num(m, 1) - 12) * 0.4), model: (m) => `A${m[1]}` },
  { id: 'apple-masked', test: /apple gpu|apple\b.*\bgpu/, cls: 'integrated', vendor: 'Apple', family: 'apple-masked', tflops: 2.6, masked: true, model: () => 'Apple GPU' },

  // ---- mobile --------------------------------------------------------------------------------------------------------------
  {
    id: 'adreno', test: /adreno\W*(?:tm\W*)?(\d{3})/, cls: 'mobile', vendor: 'Qualcomm', family: 'adreno',
    tflops: (m) => { const n = num(m, 1); return n < 400 ? 0.15 : n < 500 ? 0.3 : n < 600 ? 0.6 : n < 700 ? 0.2 + (n - 600) * 0.015 : n < 800 ? 1.8 + (n - 700) * 0.04 : 5; },
    model: (m) => `Adreno ${m[1]}`,
  },
  {
    id: 'mali-g', test: /(?:mali[- ]?g|immortalis[- ]?g?)(\d{2,3})\b/, cls: 'mobile', vendor: 'ARM', family: 'mali',
    tflops: (m) => lookup(MALI_G, num(m, 1)),
    model: (m, s) => (/immortalis/.test(s) ? `Immortalis-G${m[1]}` : `Mali-G${m[1]}`),
  },
  { id: 'mali-t', test: /mali-?\s?t(\d{3})/, cls: 'mobile', vendor: 'ARM', family: 'mali-t', tflops: (m) => lookup(MALI_T, num(m, 1)), model: (m) => `Mali-T${m[1]}` },
  { id: 'mali-4xx', test: /mali-?\s?(4\d\d)/, cls: 'mobile', vendor: 'ARM', family: 'mali-4xx', tflops: 0.02, model: (m) => `Mali-${m[1]}` },
  { id: 'mali-generic', test: /\bmali\b/, cls: 'mobile', vendor: 'ARM', family: 'mali', tflops: 0.3, model: () => 'Mali' },
  { id: 'xclipse', test: /xclipse\s*(\d{3})/, cls: 'mobile', vendor: 'Samsung', family: 'xclipse', tflops: (m) => 2.8 + (num(m, 1) - 920) * 0.035, model: (m) => `Xclipse ${m[1]}` },
  { id: 'powervr', test: /powervr|imagination/, cls: 'mobile', vendor: 'Imagination', family: 'powervr', tflops: (m, s) => (/ge8|sgx/.test(s) ? 0.04 : /gx6|g6/.test(s) ? 0.15 : 0.2), model: (m, s, r) => r },
  { id: 'videocore', test: /videocore/, cls: 'mobile', vendor: 'Broadcom', family: 'videocore', tflops: 0.03, model: (m, s, r) => r },
  { id: 'vivante', test: /vivante/, cls: 'mobile', vendor: 'Vivante', family: 'vivante', tflops: 0.03, model: (m, s, r) => r },
  { id: 'tegra', test: /tegra/, cls: 'mobile', vendor: 'NVIDIA', family: 'tegra', tflops: 0.5, model: (m, s, r) => r },

  // ---- NVIDIA --------------------------------------------------------------------------------------------------------------
  {
    id: 'nv-rtx', test: /(?:geforce |nvidia )?\brtx\s*(\d{4})\s*(ti|super)?(?:\s*(laptop|max-q|mobile))?/, cls: 'discrete', vendor: 'NVIDIA', family: 'geforce-rtx',
    tflops: (m) => lookup(NV_RTX, num(m, 1)) * (m[2] === 'ti' ? 1.2 : m[2] === 'super' ? 1.15 : 1) * (m[3] ? 0.75 : 1),
    model: (m) => `GeForce RTX ${m[1]}${m[2] ? ` ${m[2] === 'ti' ? 'Ti' : 'Super'}` : ''}${m[3] ? ' Laptop GPU' : ''}`,
  },
  { id: 'nv-rtx-pro', test: /\b(?:nvidia )?rtx\s*([a-z]?\d{3,4}0?)\b|\bnvidia (?:a|l|h)\d{2,4}\b/, cls: 'discrete', vendor: 'NVIDIA', family: 'nvidia-pro', tflops: 15, model: (m, s, r) => r },
  {
    id: 'nv-gtx', test: /\bgtx\s*(\d{3,4})\s*(ti|super)?(?:\s*(laptop|max-q|mobile))?/, cls: 'discrete', vendor: 'NVIDIA', family: 'geforce-gtx',
    tflops: (m) => lookup(NV_GTX, num(m, 1)) * (m[2] === 'ti' ? 1.2 : m[2] === 'super' ? 1.15 : 1) * (m[3] ? 0.75 : 1),
    model: (m) => `GeForce GTX ${m[1]}${m[2] ? ` ${m[2] === 'ti' ? 'Ti' : 'Super'}` : ''}`,
  },
  { id: 'nv-mx', test: /geforce\s*mx\s*(\d{3})/, cls: 'discrete', vendor: 'NVIDIA', family: 'geforce-mx', tflops: (m) => lookup(NV_MX, num(m, 1)), model: (m) => `GeForce MX${m[1]}` },
  { id: 'nv-gt', test: /geforce\s*(?:gt|gts)\s*(\d{3,4})/, cls: 'discrete', vendor: 'NVIDIA', family: 'geforce-gt', tflops: (m) => (num(m, 1) >= 1000 ? 0.9 : 0.3), model: (m) => `GeForce GT ${m[1]}` },
  { id: 'nv-quadro', test: /quadro|\btitan\b|tesla|nvidia (?:t|p|v)\d{3,4}\b|\bp\d{3,4}\b.*pcie/, cls: 'discrete', vendor: 'NVIDIA', family: 'quadro', tflops: (m, s) => (/\b(t4|p4|v100|titan)/.test(s) ? 8 : /\bt1000|p1000|t600|t400|p620|p600|p400/.test(s) ? 2.5 : 4), model: (m, s, r) => r.replace(/^NVIDIA\s+/i, '').replace(/\s+with max-q design/i, '') },
  { id: 'nv-old', test: /geforce\s*(\d{3,4})\s*(?:gt|gs|gtx|m)?/, cls: 'discrete', vendor: 'NVIDIA', family: 'geforce-legacy', tflops: (m) => (num(m, 1) >= 900 && num(m, 1) < 1000 ? 0.9 : 0.15), model: (m, s, r) => r.replace(/^NVIDIA\s+/i, '') },
  { id: 'nvidia-generic', test: /nvidia|geforce/, cls: 'discrete', vendor: 'NVIDIA', family: 'nvidia', tflops: 2, model: (m, s, r) => r.replace(/^NVIDIA\s+/i, '') },

  // ---- Intel (Arc before the generic "Intel Graphics" rules) -----------------------------------------------------------------
  { id: 'intel-arc-b', test: /arc\W*(?:tm\W*)?b(\d{3})/, cls: 'discrete', vendor: 'Intel', family: 'arc', tflops: (m) => lookup(ARC_B, num(m, 1)), model: (m) => `Arc B${m[1]}` },
  { id: 'intel-arc-a', test: /arc\W*(?:tm\W*)?a(\d{3})/, cls: 'discrete', vendor: 'Intel', family: 'arc', tflops: (m) => lookup(ARC, num(m, 1)), model: (m) => `Arc A${m[1]}` },
  { id: 'intel-arc-igpu', test: /intel.*\barc\b.*graphics|\barc\b\s*\d{3}v/, cls: 'integrated', vendor: 'Intel', family: 'arc-igpu', tflops: 4.5, model: () => 'Arc Graphics' },
  { id: 'intel-xe-max', test: /iris.*xe\s*max/, cls: 'discrete', vendor: 'Intel', family: 'xe-max', tflops: 2.5, model: () => 'Iris Xe MAX' },
  { id: 'intel-iris-xe', test: /iris.*\bxe\b|\bxe graphics\b/, cls: 'integrated', vendor: 'Intel', family: 'iris-xe', tflops: 2, model: () => 'Iris Xe Graphics' },
  { id: 'intel-iris-plus', test: /iris.*plus/, cls: 'integrated', vendor: 'Intel', family: 'iris-plus', tflops: 1, model: (m, s) => `Iris Plus Graphics${/(\d{3})/.exec(s)?.[1] ? ` ${/(\d{3})/.exec(s)[1]}` : ''}` },
  { id: 'intel-iris', test: /iris/, cls: 'integrated', vendor: 'Intel', family: 'iris', tflops: 0.6, model: (m, s, r) => r.replace(/^Intel\s+/i, '') },
  { id: 'intel-uhd', test: /intel.*uhd graphics\s*(\d{3})?/, cls: 'integrated', vendor: 'Intel', family: 'uhd', tflops: (m) => (m[1] ? (num(m, 1) >= 700 ? 0.7 : 0.4) : 0.6), model: (m) => `UHD Graphics${m[1] ? ` ${m[1]}` : ''}` },
  { id: 'intel-hd-new', test: /intel.*hd graphics\s*([5-6]\d\d)\b/, cls: 'integrated', vendor: 'Intel', family: 'hd-gen9', tflops: 0.4, model: (m) => `HD Graphics ${m[1]}` },
  { id: 'intel-hd-old', test: /intel.*hd graphics\s*(\d{4})?/, cls: 'integrated', vendor: 'Intel', family: 'hd-legacy', tflops: (m) => (m[1] && num(m, 1) >= 4000 ? 0.2 : 0.07), model: (m) => `HD Graphics${m[1] ? ` ${m[1]}` : ''}` },
  { id: 'intel-gma', test: /intel.*(gma|graphics media|bay ?trail|ironlake|sandybridge|ivybridge|haswell)/, cls: 'integrated', vendor: 'Intel', family: 'gma', tflops: 0.03, model: (m, s, r) => r },
  { id: 'intel-generic', test: /intel/, cls: 'integrated', vendor: 'Intel', family: 'intel', tflops: 1, model: (m, s, r) => r.replace(/^Intel\s+/i, '') },

  // ---- AMD: integrated first ("... Graphics" without a discrete series word), then discrete -----------------------------------
  { id: 'amd-igpu-m', test: /radeon\W*(?:tm\W*)?(\d{3})m\s*graphics|radeon\W*(?:tm\W*)?(\d{3})m\b(?!\s*(?:xt|pro))/, cls: 'integrated', vendor: 'AMD', family: 'radeon-igpu', tflops: (m) => lookup(AMD_IGPU, num(m, 1) || num(m, 2)), model: (m) => `Radeon ${m[1] || m[2]}M Graphics` },
  { id: 'amd-vega-igpu', test: /(?:rx )?vega\s*(\d{1,2})\s*graphics/, cls: 'integrated', vendor: 'AMD', family: 'vega-igpu', tflops: (m) => num(m, 1) * 0.14, model: (m, s) => `${/rx vega/.test(s) ? 'RX ' : ''}Vega ${m[1]} Graphics` },
  { id: 'amd-r-igpu', test: /radeon\W*(?:tm\W*)?r[2-7]\s*(?:series )?graphics/, cls: 'integrated', vendor: 'AMD', family: 'radeon-r', tflops: 0.5, model: (m, s) => /r[2-7]/.exec(s)[0].toUpperCase() + ' Graphics' },
  { id: 'amd-hd-g', test: /radeon\W*(?:tm\W*)?hd\s*\d{4}g\b/, cls: 'integrated', vendor: 'AMD', family: 'radeon-hd-apu', tflops: 0.3, model: (m, s, r) => r },
  { id: 'amd-radeon-graphics', test: /(?:amd )?radeon\W*(?:tm\W*)?\s*graphics\s*$/, cls: 'integrated', vendor: 'AMD', family: 'radeon-igpu', tflops: 1.2, model: () => 'Radeon Graphics' },
  { id: 'amd-vega-frontier', test: /vega frontier|radeon vii|radeon\W*(?:tm\W*)?\s*vii\b/, cls: 'discrete', vendor: 'AMD', family: 'vega', tflops: 13, model: (m, s, r) => r.replace(/^AMD\s+/i, '') },
  { id: 'amd-rx-vega', test: /rx vega\s*(56|64)/, cls: 'discrete', vendor: 'AMD', family: 'vega', tflops: (m) => (num(m, 1) === 56 ? 10.5 : 12.7), model: (m) => `RX Vega ${m[1]}` },
  { id: 'amd-pro-vega', test: /radeon\W*(?:tm\W*)?pro vega\s*(\d{2})/, cls: 'discrete', vendor: 'AMD', family: 'radeon-pro', tflops: (m) => (num(m, 1) <= 20 ? 3.2 : 5.5), model: (m) => `Radeon Pro Vega ${m[1]}` },
  { id: 'amd-pro', test: /radeon\W*(?:tm\W*)?\s*pro\s*(?:w[xs]?\s*)?(\d{3,4})\w*/, cls: 'discrete', vendor: 'AMD', family: 'radeon-pro', tflops: (m) => (num(m, 1) >= 6000 ? 10 : num(m, 1) >= 5000 ? 4.5 : 1.5), model: (m, s, r) => r.replace(/^AMD\s+/i, '') },
  {
    id: 'amd-rx', test: /\brx\s*(\d{3,4})\s*(xtx|xt|gre|m|s)?\b/, cls: 'discrete', vendor: 'AMD', family: 'radeon-rx',
    tflops: (m) => lookup(AMD_RX, num(m, 1)) * (m[2] === 'xtx' ? 1.18 : m[2] === 'xt' ? 1.1 : 1) * (m[2] === 'm' || m[2] === 's' ? 0.7 : 1),
    model: (m) => `Radeon RX ${m[1]}${m[2] ? ` ${m[2].toUpperCase()}` : ''}`,
  },
  { id: 'amd-firepro', test: /firepro|radeon\W*(?:tm\W*)?\s*r9|radeon\W*(?:tm\W*)?\s*hd\s*\d{4}|ati |radeon\W*(?:tm\W*)?\s*hd/, cls: 'discrete', vendor: 'AMD', family: 'radeon-legacy', tflops: 1, model: (m, s, r) => r.replace(/^(AMD|ATI)\s+/i, '').replace(/\s+OpenGL Engine$/i, '') },
  { id: 'amd-generic', test: /\bamd\b|radeon|\bati\b/, cls: 'discrete', vendor: 'AMD', family: 'radeon', tflops: 2, model: (m, s, r) => r.replace(/^(AMD|ATI)\s+/i, '') },
];

/** Reduces a raw string to its display model + the rule that matched, or a blank record. */
export function classifyRenderer(raw, vendorHint = '') {
  const cleaned = cleanRenderer(raw, vendorHint);
  const out = { class: 'unknown', vendor: cleaned.vendor || '', model: cleaned.renderer, family: 'unknown', tflops: null, masked: false, rule: null, renderer: cleaned.renderer, raw: cleaned.raw };
  if (!cleaned.renderer || /^(webkit webgl|mozilla|webkit|google inc\.?|none)$/i.test(cleaned.renderer)) {
    out.masked = true; // the browser hid the real renderer (Firefox resist-fingerprinting, Safari, privacy modes)
    return out;
  }
  // the renderer alone first (so `$` anchors work), then renderer + vendor for strings whose model is only in the vendor field
  for (const text of [cleaned.renderer.toLowerCase(), `${cleaned.renderer} ${cleaned.vendor}`.toLowerCase()]) {
    for (const r of RULES) {
      const m = r.test.exec(text);
      if (!m) continue;
      out.class = r.cls;
      out.vendor = r.vendor || out.vendor;
      out.family = r.family;
      out.rule = r.id;
      out.masked = !!r.masked;
      out.tflops = typeof r.tflops === 'function' ? r.tflops(m, text) : r.tflops;
      out.tflops = Math.round(out.tflops * 100) / 100;
      out.model = squash(r.model ? r.model(m, text, cleaned.renderer) : cleaned.renderer);
      return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// tier cap
/**
 * The highest generic tier the machine should START on, from its throughput class and hard limits. Never above 'high', never 'high' for mobile
 * or for anything under TFLOPS_FOR_TIER.high; the caps and environment can only lower it.
 */
export function tierCapFor({ cls, tflops, family = '', caps = {}, memoryGB = 0, cores = 0, mobileHint = false } = {}) {
  const reasons = [];
  let tier;
  if (cls === 'software') tier = 'lite';
  else if (tflops == null) tier = cls === 'mobile' || mobileHint ? 'low' : 'medium'; // unknown machine: the middle, calibration decides
  else if (cls === 'mobile') tier = tflops >= 1.8 ? 'medium' : tflops >= TFLOPS_FOR_TIER.low ? 'low' : 'lite';
  else tier = tflops >= TFLOPS_FOR_TIER.high ? 'high' : tflops >= TFLOPS_FOR_TIER.medium ? 'medium' : tflops >= TFLOPS_FOR_TIER.low ? 'low' : 'lite';
  if (cls === 'unknown' && mobileHint) tier = minTier(tier, 'low');
  const cap = (to, why) => {
    if (tierIdx(to) < tierIdx(tier)) {
      tier = to;
      reasons.push(`${to}: ${why}`);
    }
  };
  // shared-memory GPUs deliver far less than their TFLOPs suggest; only Apple Silicon's wide unified memory (Max / Ultra class) may start on high
  if (cls === 'integrated' && family !== 'apple-silicon') cap('medium', 'integrated GPU never starts on high');
  if (caps.maxTexture && caps.maxTexture < 2048) cap('lite', `max texture size ${caps.maxTexture}`);
  else if (caps.maxTexture && caps.maxTexture < 4096) cap('low', `max texture size ${caps.maxTexture}`);
  if (caps.halfFloatRT === false) cap('low', 'no half-float render targets (no HDR post pipeline)');
  if (memoryGB && memoryGB <= 1) cap('lite', `${memoryGB} GB device memory`);
  else if (memoryGB && memoryGB <= 2) cap(cls === 'mobile' || mobileHint ? 'lite' : 'low', `${memoryGB} GB device memory`);
  else if (memoryGB && memoryGB <= 4 && (cls === 'mobile' || mobileHint)) cap('low', `${memoryGB} GB device memory on a phone`);
  if (cores && cores <= 2) cap(cls === 'mobile' || mobileHint ? 'lite' : 'low', `${cores} CPU cores`);
  return { tier, reasons };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GL string / caps readers (a WebGL context or a fake with the same getParameter / getExtension surface)
/** { renderer, vendor, masked } from a WebGL context, preferring the unmasked strings. */
export function readGpuStrings(gl) {
  const out = { renderer: '', vendor: '', masked: true };
  if (!gl || typeof gl.getParameter !== 'function') return out;
  try {
    const dbg = gl.getExtension?.('WEBGL_debug_renderer_info');
    if (dbg) {
      out.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      out.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '');
      out.masked = !out.renderer;
    }
  } catch { /* fall through to the masked strings */ }
  if (!out.renderer) {
    try {
      out.renderer = String(gl.getParameter(gl.RENDERER) || '');
      out.vendor = out.vendor || String(gl.getParameter(gl.VENDOR) || '');
    } catch { /* nothing readable */ }
  }
  return out;
}

/** The handful of caps the engine cares about. */
export function readGlCaps(gl) {
  const caps = { webgl: 0, maxTexture: 0, maxSamples: 0, maxAniso: 0, halfFloatRT: false, floatRT: false, parallelCompile: false, timerQuery: false, maxTextureUnits: 0 };
  if (!gl || typeof gl.getParameter !== 'function') return caps;
  const isGl2 = typeof WebGL2RenderingContext !== 'undefined' ? gl instanceof WebGL2RenderingContext : typeof gl.texStorage2D === 'function' && typeof gl.drawArraysInstanced === 'function';
  caps.webgl = isGl2 ? 2 : 1;
  const ext = (n) => {
    try {
      return gl.getExtension(n) || null;
    } catch {
      return null;
    }
  };
  const param = (p) => {
    try {
      const v = gl.getParameter(p);
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  };
  caps.maxTexture = param(gl.MAX_TEXTURE_SIZE);
  caps.maxTextureUnits = param(gl.MAX_TEXTURE_IMAGE_UNITS);
  if (isGl2) caps.maxSamples = param(gl.MAX_SAMPLES);
  const an = ext('EXT_texture_filter_anisotropic');
  if (an) caps.maxAniso = param(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
  caps.floatRT = isGl2 ? !!ext('EXT_color_buffer_float') : !!ext('WEBGL_color_buffer_float');
  caps.halfFloatRT = caps.floatRT || !!ext('EXT_color_buffer_half_float');
  caps.parallelCompile = !!ext('KHR_parallel_shader_compile');
  caps.timerQuery = !!(ext('EXT_disjoint_timer_query_webgl2') || ext('EXT_disjoint_timer_query'));
  return caps;
}

/** cores / memory / dpr / touch hints from navigator + window (injectable for tests). */
export function readEnv({ nav, win, mm } = {}) {
  nav = nav ?? (typeof navigator !== 'undefined' ? navigator : {});
  win = win ?? (typeof window !== 'undefined' ? window : {});
  const media = mm ?? ((q) => {
    try {
      return typeof win.matchMedia === 'function' && !!win.matchMedia(q)?.matches;
    } catch {
      return false;
    }
  });
  const ua = String(nav.userAgent || '');
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1);
  const android = /Android/i.test(ua);
  return {
    dpr: Number(win.devicePixelRatio) || 1,
    cores: Number(nav.hardwareConcurrency) || 0,
    memoryGB: Number(nav.deviceMemory) || 0,
    coarse: media('(pointer: coarse)') || (Number(nav.maxTouchPoints) > 1 && media('(hover: none)')),
    ios,
    android,
    mobile: ios || android || media('(pointer: coarse)'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
/** A stable lower-case key for one GPU (vendor + model, no driver / device ids), used by tier memory. */
export function gpuKey(gpu) {
  if (!gpu.vendor && !gpu.model && !gpu.renderer) return 'unknown';
  const base = `${gpu.vendor || ''}|${gpu.model || gpu.renderer || ''}`.toLowerCase().replace(/[^a-z0-9|.+-]+/g, ' ').trim();
  return (base || 'unknown').slice(0, 96);
}

/**
 * The full record. Give it a WebGL context (`gl`) or strings (`renderer`, `vendor`); `caps` and `env` default to reading `gl`, `navigator` and `window`.
 * Never throws. `refreshHz` starts null: the governor / calibration fill it with `withRefresh(gpu, hz)`.
 */
export function classifyGpu({ gl = null, renderer = '', vendor = '', caps = null, env = null, nav, win, mm } = {}) {
  const strings = gl ? readGpuStrings(gl) : { renderer, vendor, masked: !renderer };
  const c = caps ?? (gl ? readGlCaps(gl) : {});
  const e = env ?? readEnv({ nav, win, mm });
  const base = classifyRenderer(strings.renderer, strings.vendor);
  let cls = base.class;
  let tflops = base.tflops;
  const reasons = [];
  if (cls === 'unknown' && e.mobile) {
    cls = 'mobile';
    reasons.push('renderer string hidden; touch / mobile user agent: assumed a phone-class GPU');
  } else if (base.rule === 'apple-masked' && e.mobile) {
    cls = 'mobile'; // Safari on iPhone / iPad reports just "Apple GPU": unmeasured, starts low
    tflops = 1;
  }
  const cap = tierCapFor({ cls, tflops, family: base.family, caps: c, memoryGB: e.memoryGB, cores: e.cores, mobileHint: !!e.mobile });
  const gpu = {
    class: cls,
    vendor: base.vendor,
    model: base.model,
    family: base.family,
    tflops,
    renderer: base.renderer,
    raw: base.raw,
    masked: base.masked || strings.masked,
    rule: base.rule,
    dpr: e.dpr,
    cores: e.cores,
    memoryGB: e.memoryGB,
    mobile: !!e.mobile,
    refreshHz: null,
    caps: c,
    tierCap: cap.tier,
    reasons: [...reasons, ...cap.reasons],
  };
  gpu.key = gpuKey(gpu);
  return gpu;
}

/** A copy of `gpu` with the measured refresh rate attached. */
export const withRefresh = (gpu, hz) => ({ ...gpu, refreshHz: hz > 0 ? hz : null });

let cachedProbe = null;
/** Browser convenience: classifies this machine through a throw-away WebGL context (cached; the context is released). Returns null with no DOM. */
export function probeGpu({ force = false, doc = typeof document !== 'undefined' ? document : null } = {}) {
  if (cachedProbe && !force) return cachedProbe;
  if (!doc?.createElement) return null;
  let canvas;
  let gl = null;
  try {
    canvas = doc.createElement('canvas');
    for (const kind of ['webgl2', 'webgl']) {
      gl = canvas.getContext(kind, { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false });
      if (gl) break;
    }
  } catch { /* no context */ }
  const gpu = classifyGpu({ gl });
  try {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* ignore */ }
  cachedProbe = gpu;
  return gpu;
}

/** One line for logs and bug reports. */
export const describeGpu = (g) => `${g.class} ${g.vendor} ${g.model} (~${g.tflops ?? '?'} TFLOPs) cap:${g.tierCap} cores:${g.cores || '?'} mem:${g.memoryGB || '?'}GB dpr:${g.dpr}${g.refreshHz ? ` ${g.refreshHz}Hz` : ''}${g.masked ? ' [masked]' : ''}`;
