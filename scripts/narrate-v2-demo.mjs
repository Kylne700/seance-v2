#!/usr/bin/env node
// Narrated cut of the Seance v2 demo: the silent screen recording (scripts/make-v2-demo.mjs) + one WAV per caption -> one mp4
// with the voice. Pure node + ffmpeg: no network, no model. The WAVs are made elsewhere (tools/cloud-voice) and are not in the repo.
//   build:   node scripts/narrate-v2-demo.mjs --silent SILENT.mp4 --wav-dir DIR --out OUT.mp4 [--narration FILE] [--report FILE]
//   windows: node scripts/narrate-v2-demo.mjs --silent SILENT.mp4 --windows          (the caption windows found in the silent cut)
//   verify:  node scripts/narrate-v2-demo.mjs --verify OUT.mp4 [--sheet SHEET.png] [--lufs-target=-16] [--card-s N]   (re-measures the finished mp4, not the build notes)
// OUT must not be SILENT. Options: --lead 0.25 --tail 0.45 (seconds of quiet before and after each line; the rules are 0.2 and 0.4),
// --card-s 5 (end card hold), --max-s 125 (the longest video it builds or accepts, in seconds; it was a fixed 95 for the 15-line cut, which the 19-line cut cannot meet),
// CRF=22 (env), FONT and CARD_FONT (env; the caption font and the end card font).
// How: no times were kept when the silent cut was filmed, so the caption windows (one per line of the narration file) are found again from the frames: the band under
// the page changes when a caption changes. A window shorter than its spoken line gets its last frame held (the footage is never sped
// up). Each WAV is placed sample-exact LEAD s after its caption appears and ends TAIL s before the next one (the last one: before the
// cross-fade to the end card). A caption whose narration text differs from the burned one (text != burned in the narration file) is
// redrawn with the same font and layout as make-v2-demo.mjs, so caption = narration. The end card is repainted: the old small line
// is overpainted and the two lines of "card" in the narration file are drawn in its place.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))
const { values: o } = parseArgs({
  options: {
    silent: { type: 'string' }, 'wav-dir': { type: 'string' }, out: { type: 'string' }, verify: { type: 'string' }, windows: { type: 'boolean', default: false },
    narration: { type: 'string', default: join(HERE, 'seance-v2-narration.json') }, report: { type: 'string' }, sheet: { type: 'string' }, 'lufs-target': { type: 'string' },
    lead: { type: 'string', default: '0.25' }, tail: { type: 'string', default: '0.45' }, 'card-s': { type: 'string', default: '5' }, 'max-s': { type: 'string', default: '125' },
  },
})
const must = (ok, msg) => { if (!ok) { console.error(`narrate-v2-demo: ${msg}`); process.exit(1) } }

// same numbers as make-v2-demo.mjs
const W = 1280, H = 720, BAND = 80, PAGE_H = H - BAND, FPS = 30, BG = '0d0b13'
const FONT = process.env.FONT ?? '/usr/share/fonts/opentype/inter/Inter-Medium.otf'
const CARD_FONT = process.env.CARD_FONT ?? '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf' // what system-ui is on the machine that filmed it
const SR = 48000, FADE_F = 18, SILENT_CARD_F = 150 // the cross-fade is 0.6 s; the silent cut holds its end card 5 s (END_S in make-v2-demo.mjs)
const LEAD = Number(o.lead), TAIL = Number(o.tail), CARD_F = Math.round(Number(o['card-s']) * FPS), MAX_S = Number(o['max-s'])
const MIN_LEAD = 0.2, MIN_TAIL = 0.4 // the rules
must(LEAD >= MIN_LEAD && TAIL >= MIN_TAIL && CARD_F >= FADE_F + 1 && MAX_S > 0, '--lead must be >= 0.2, --tail >= 0.4, --card-s >= 1, --max-s > 0')
const BANNED = /\b(never|always|guarantees?|life-saving|untraceable|unbreakable|anonymous)\b/i // as make-v2-demo.mjs
const wrap = (s) => { // as make-v2-demo.mjs
  if (s.length <= 66) return s
  const mid = s.length / 2
  const at = [...s.matchAll(/ /g)].map((m) => m.index).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid))[0]
  return `${s.slice(0, at)}\n${s.slice(at + 1)}`
}
const q = (s) => String(s).replace(/[\\:']/g, (c) => '\\' + c) // a path inside a filter option

function ff(args, { loglevel = 'error', raw = false } = {}) {
  const r = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-nostats', '-loglevel', loglevel, '-y', ...args], { encoding: raw ? 'buffer' : 'utf8', maxBuffer: 1 << 30 })
  must(r.status === 0, `ffmpeg failed: ${String(r.stderr).split('\n').filter(Boolean).slice(-14).join(' | ').slice(0, 1800)}`)
  return r
}
const probe = (f) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_frames,duration:format=duration', '-of', 'json', f], { encoding: 'utf8' }).stdout || '{}')
const pcm = (f) => ff(['-i', f, '-vn', '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { raw: true }).stdout // raw s16le mono 48 kHz

// ---- 1. find the caption windows in a video from frame differences (gray, full size) ----
function analyse(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '19', 'ffmpeg', '-v', 'error', '-i', file, '-vf', 'format=gray', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'inherit'] })
    const FS = W * H, B0 = (PAGE_H + 2) * W // the band under the amber line
    let buf = Buffer.alloc(0), prev = null
    const full = [], band = []
    p.stdout.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d
      while (buf.length >= FS) {
        const f = buf.subarray(0, FS)
        let a = 0, b = 0
        if (prev) for (let i = 0; i < FS; i++) { const x = f[i] > prev[i] ? f[i] - prev[i] : prev[i] - f[i]; a += x; if (i >= B0) b += x }
        full.push(a); band.push(b)
        prev = Buffer.from(f)
        buf = buf.subarray(FS)
      }
    })
    p.on('close', (code) => (code === 0 && buf.length === 0 ? resolve({ full, band }) : reject(new Error('ffmpeg could not decode the video'))))
  })
}
// A caption change moves the band by >= 5e5 (noise: <= 1.3e5, cross-fade: <= 2e5, measured on the Oct 30 recording). A caption that
// changes on an exact frame time shows both captions on that frame: two spikes in a row, one boundary.
function windowsOf({ full, band }, nLines, cardF) {
  const N = full.length
  const C = N - cardF, F = C - (FADE_F - 1) // C: first plain card frame, F: first blended frame (F-1 is the last plain page frame)
  must(F > 1, 'video too short')
  for (let k = F; k <= C; k++) must(full[k] > 5e5, `frame ${k} should be part of the cross-fade (diff ${full[k]}); is the card hold right?`)
  must(full[F - 1] < 5e5, `frame ${F - 1} should be the last plain page frame (diff ${full[F - 1]})`)
  const starts = [0], overlap = [false]
  let last = -9
  for (let k = 1; k < F; k++) {
    if (band[k] <= 3e5) continue
    if (k === last + 1) overlap[overlap.length - 1] = true; else { starts.push(k); overlap.push(false) }
    last = k
  }
  must(starts.length === nLines, `found ${starts.length} caption windows, expected ${nLines}`)
  return { N, F, C, starts, overlap }
}

// ---- 2. the narration file ----
const nar = JSON.parse(readFileSync(o.narration, 'utf8'))
const L = nar.lines
must(Array.isArray(L) && L.length > 0 && Array.isArray(nar.card) && nar.card.length === 2, 'narration file: need "lines" and "card" (two strings)')
for (const l of L) must(/^[A-Za-z0-9_-]{1,64}$/.test(l.id) && typeof l.text === 'string' && l.text.trim() && typeof l.burned === 'string', `narration file: bad line ${l.id}`)
for (const t of [...L.map((l) => l.text), ...nar.card]) must(!BANNED.test(t), `banned word in: ${t}`)
// 86 = the longest wrapped line the band holds: an 86-character line measured about 90 px free on each side of the 1280 px frame (the burned l09 has 85)
for (const l of L) if (l.text !== l.burned) must(wrap(l.text).split('\n').every((x) => x.length <= 86), `${l.id}: the new caption is too long for the band (two lines of at most 86 characters)`)

if (o.windows) {
  must(o.silent, '--windows needs --silent')
  const wi = windowsOf(await analyse(o.silent), L.length, SILENT_CARD_F)
  console.log(JSON.stringify({ frames: wi.N, fps: FPS, window_starts: wi.starts, overlay_frame_at_start: wi.overlap, fade_first_frame: wi.F, card_first_frame: wi.C, seconds: { starts: wi.starts.map((k) => +(k / FPS).toFixed(3)), fade: +(wi.F / FPS).toFixed(3), total: +(wi.N / FPS).toFixed(3) } }, null, 1))
  process.exit(0)
}

// ---- 3. verify a finished mp4 on its own numbers ----
if (o.verify) {
  const file = o.verify
  const pr = probe(file)
  const v = pr.streams?.find((s) => s.codec_type === 'video'), au = pr.streams?.find((s) => s.codec_type === 'audio')
  const an = await analyse(file)
  const wi = windowsOf(an, L.length, CARD_F)
  const out = { file: 'OUT', video: v && `${v.codec_name} ${v.width}x${v.height} ${v.pix_fmt} ${v.r_frame_rate}`, audio: au?.codec_name, frames: wi.N, window_starts_s: wi.starts.map((k) => +(k / FPS).toFixed(3)), fade_start_s: +(wi.F / FPS).toFixed(3) }
  const vs = wi.N / FPS, vd = Number(v?.duration), ad = Number(au?.duration)
  const fails = []
  if (!(v?.codec_name === 'h264' && v.width === W && v.height === H && v.r_frame_rate === `${FPS}/1` && v.pix_fmt === 'yuv420p')) fails.push('video is not 1280x720 30 fps h264 yuv420p')
  if (au?.codec_name !== 'aac') fails.push('no aac audio track')
  if (!(Math.abs(vd - ad) <= 0.2)) fails.push(`audio ${ad}s vs video ${vd}s differ by more than 0.2 s`)
  if (!(vs <= MAX_S)) fails.push(`video is ${vs.toFixed(2)} s, more than ${MAX_S} s`)
  Object.assign(out, { video_s: +vd.toFixed(3), audio_s: +ad.toFixed(3), diff_s: +Math.abs(vd - ad).toFixed(3), total_ok: vs <= MAX_S })
  // audio activity per 10 ms (rms > -50 dBFS) against the windows measured above
  const s16 = pcm(file), step = SR / 100, act = []
  for (let i = 0; i + step <= s16.length / 2; i += step) { let e = 0; for (let j = 0; j < step; j++) { const x = s16.readInt16LE((i + j) * 2) / 32768; e += x * x } act.push(10 * Math.log10(e / step + 1e-12) > -50) }
  const ends = [...wi.starts.slice(1), wi.F]
  out.lines = L.map((l, i) => {
    const a0 = Math.round(wi.starts[i] * 100 / FPS), a1 = Math.round(ends[i] * 100 / FPS) // window in 10 ms slots
    let first = -1, lastA = -1, n = 0
    for (let k = a0; k < Math.min(a1, act.length); k++) if (act[k]) { if (first < 0) first = k; lastA = k; n++ }
    const lead = first < 0 ? null : +((first - a0) / 100).toFixed(2), tail = first < 0 ? null : +((a1 - lastA - 1) / 100).toFixed(2)
    const ok = first >= 0 && lead >= MIN_LEAD - 1e-9 && tail >= MIN_TAIL - 1e-9
    if (!ok) fails.push(`${l.id}: lead ${lead} tail ${tail}`)
    return { id: l.id, window_s: [+(wi.starts[i] / FPS).toFixed(3), +(ends[i] / FPS).toFixed(3)], speech_s: +(n / 100).toFixed(2), lead_s: lead, tail_s: tail, ok }
  })
  const after = act.slice(Math.round(wi.F * 100 / FPS)).filter(Boolean).length // nothing is said over the cross-fade or the end card
  if (after) fails.push(`${after * 10} ms of sound after the cross-fade starts`)
  out.sound_after_fade_ms = after * 10
  const loud = ff(['-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { loglevel: 'info' }).stderr.split('Summary:')[1] ?? ''
  out.lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(loud)?.[1]); out.true_peak_dbfs = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(loud)?.[1])
  if (o['lufs-target'] !== undefined) { // loudness is only judged when asked for (placeholder tones are not speech)
    if (!(Math.abs(out.lufs - Number(o['lufs-target'])) <= 1.5)) fails.push(`${out.lufs} LUFS is not within 1.5 of ${o['lufs-target']}`)
    if (!(out.true_peak_dbfs <= -0.1)) fails.push(`true peak ${out.true_peak_dbfs} dBFS clips`)
  }
  out.blackdetect = (ff(['-i', file, '-an', '-vf', 'blackdetect=d=0.04:pix_th=0.10', '-f', 'null', '-'], { loglevel: 'info' }).stderr.match(/black_start/g) ?? []).length
  if (o.sheet) { // one thumbnail per caption (0.5 s in), one mid-cross-fade, the last frame
    const pick = [...wi.starts.map((k) => k + 15), wi.F + 9, wi.N - 1]
    const cols = 4, rows = Math.ceil(pick.length / cols)
    ff(['-i', file, '-an', '-vf', `select='${pick.map((k) => `eq(n\\,${k})`).join('+')}',scale=320:-2,tile=${cols}x${rows}:padding=4:margin=4:color=0x1a1626`, '-frames:v', '1', '-fps_mode', 'passthrough', o.sheet])
    out.sheet_frames = pick
  }
  out.fails = fails
  console.log(JSON.stringify(out, null, 1))
  process.exit(fails.length ? 1 : 0)
}

// ---- 4. build ----
must(o.silent && o['wav-dir'] && o.out, 'usage: --silent SILENT.mp4 --wav-dir DIR --out OUT.mp4 (or --windows / --verify)')
must(o.out !== o.silent, '--out must not be the silent cut')
const wi = windowsOf(await analyse(o.silent), L.length, SILENT_CARD_F)
const { F, starts, overlap } = wi
const tailF = FADE_F - 1 + CARD_F // frames after the last page frame: 17 blended + the card
const tmp = mkdtempSync(join(tmpdir(), 'narrate-v2-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true })) // must() ends with process.exit, which skips the finally below
try {
  // 4a. audio: one raw buffer as long as the video, each line at its place
  const wav = L.map((l) => { const b = pcm(join(o['wav-dir'], `${l.id}.wav`)); must(b.length > SR / 2, `${l.id}.wav is empty or shorter than 0.25 s`); return b })
  const dur = wav.map((b) => b.length / 2 / SR)
  const orig = L.map((_, i) => (i + 1 < L.length ? starts[i + 1] : F) - starts[i]) // frames of each window in the silent cut
  const hold = dur.map((d, i) => Math.max(0, Math.ceil((LEAD + d + TAIL) * FPS - 1e-9) - orig[i]))
  const g = [] // first frame of each window in the narrated video
  let cum = 0
  L.forEach((_, i) => { g.push(starts[i] + cum); cum += hold[i] })
  const nOut = F + cum + tailF, nWin = orig.map((x, i) => x + hold[i])
  must(nOut / FPS <= MAX_S + 1e-9, `result would be ${(nOut / FPS).toFixed(2)} s, more than ${MAX_S} s (try --lead 0.2 --tail 0.4, a shorter --card-s, or shorter lines)`)
  const audio = Buffer.alloc(nOut * (SR / FPS) * 2)
  const at = g.map((f) => Math.round((f / FPS + LEAD) * SR))
  wav.forEach((b, i) => { must(at[i] * 2 + b.length <= audio.length, `${L[i].id}: audio does not fit`); b.copy(audio, at[i] * 2) })
  writeFileSync(join(tmp, 'audio.raw'), audio)

  // 4b. video graph. loop: start=K repeats input frame K-1 (measured on ffmpeg 7.1, 1 + loop copies), so K = frame + 1 + holds already added.
  const capFile = (name, text, wrapIt = true) => { const f = join(tmp, `${name}.txt`); writeFileSync(f, wrapIt ? wrap(text) : text); return f }
  const en = (a, b) => (a === undefined ? '' : `:enable='between(n,${a},${b})'`)
  const cap = (file, a, b) => `drawbox=x=0:y=${PAGE_H + 2}:w=${W}:h=${BAND - 2}:color=0x${BG}:t=fill${en(a, b)},drawtext=fontfile=${q(FONT)}:textfile=${q(file)}:expansion=none:fontsize=27:line_spacing=7:fontcolor=0xefeaf8:text_align=center:x=(w-text_w)/2:y=${PAGE_H}+(${BAND}-text_h)/2${en(a, b)}`
  const redraw = L.map((l) => l.text !== l.burned)
  const parts = []
  let sofar = 0
  L.forEach((_, i) => { if (hold[i] > 0) { parts.push(`loop=loop=${hold[i]}:size=1:start=${(i + 1 < L.length ? starts[i + 1] : F) - 1 + 1 + sofar}`); sofar += hold[i] } })
  const draws = []
  L.forEach((l, i) => {
    if (!redraw[i]) return
    draws.push(cap(capFile(`cap${i}`, l.text), g[i], g[i] + nWin[i] - 1))
    // the frame that shows two captions (see windowsOf) belongs to the next window; if that one is not redrawn, paint its burned text there
    if (i + 1 < L.length && overlap[i + 1] && !redraw[i + 1]) draws.push(cap(capFile(`burned${i + 1}`, L[i + 1].burned), g[i + 1], g[i + 1]))
  })
  const end = L.length - 1
  const chain = (xs) => xs.filter(Boolean).join(',')
  const graph = [
    `[0:v]${chain([`trim=end_frame=${F}`, 'setpts=PTS-STARTPTS', ...parts, `setpts=N/(${FPS}*TB)`, ...draws])}[m]`,
    // cross-fade: the last plain page frame (with its caption, redrawn if needed) into the repainted card
    `[1:v]${chain([`trim=start_frame=${F - 1}:end_frame=${F}`, 'setpts=PTS-STARTPTS', redraw[end] ? cap(capFile(`cap${end}`, L[end].text)) : '', `tpad=stop=${FADE_F}:stop_mode=clone`, `setpts=N/(${FPS}*TB)`, `fps=${FPS}`])}[a]`,
    // the card: the old small line (x 110-787, y 578-601 on the lossless card) is covered with a patch of the card's own flat background
    // (a drawbox colour is one level off in Y and V), then the two lines are drawn where it was
    `[2:v]${chain([`trim=start_frame=${wi.N - 1}:end_frame=${wi.N}`, 'setpts=PTS-STARTPTS'])},split[c0][c1]`,
    `[c1]crop=4:4:1000:680,scale=840:56:flags=neighbor[p]`,
    `[c0][p]overlay=x=96:y=562,${chain([
      `drawtext=fontfile=${q(CARD_FONT)}:textfile=${q(capFile('card1', nar.card[0], false))}:expansion=none:fontsize=24:fontcolor=0xbdb6d3:x=110:y=578`,
      `drawtext=fontfile=${q(CARD_FONT)}:textfile=${q(capFile('card2', nar.card[1], false))}:expansion=none:fontsize=24:fontcolor=0xbdb6d3:x=110:y=612`,
      `tpad=stop=${FADE_F + CARD_F}:stop_mode=clone`, `setpts=N/(${FPS}*TB)`, `fps=${FPS}`])}[b]`,
    `[a][b]xfade=transition=fade:duration=${(FADE_F / FPS).toFixed(3)}:offset=0,trim=start_frame=1:end_frame=${tailF + 1},setpts=N/(${FPS}*TB)[t]`, // frame 0 is the plain page frame again: skipped
    `[m][t]concat=n=2:v=1:a=0,setsar=1,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[v]`,
  ].join(';')
  const part = `${o.out}.part`
  ff(['-i', o.silent, '-i', o.silent, '-i', o.silent, '-f', 's16le', '-ar', String(SR), '-ac', '1', '-i', join(tmp, 'audio.raw'),
    '-filter_complex', graph, '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(process.env.CRF ?? 22), '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(FPS), '-c:a', 'aac', '-b:a', '128k', '-ar', String(SR),
    '-movflags', '+faststart', '-f', 'mp4', part])
  renameSync(part, o.out)

  const rep = {
    out_frames: nOut, out_seconds: +(nOut / FPS).toFixed(3), silent_seconds: +(wi.N / FPS).toFixed(3), added_hold_seconds: +(cum / FPS).toFixed(3), under_cap: nOut / FPS <= MAX_S,
    lead: LEAD, tail: TAIL, fade_first_frame: F + cum, redrawn: L.filter((_, i) => redraw[i]).map((l) => l.id),
    lines: L.map((l, i) => ({ id: l.id, wav_s: +dur[i].toFixed(3), silent_window_frames: orig[i], hold_frames: hold[i], window_start_s: +(g[i] / FPS).toFixed(3), speech_from_s: +(at[i] / SR).toFixed(3), speech_to_s: +(at[i] / SR + dur[i]).toFixed(3), window_end_s: +((g[i] + nWin[i]) / FPS).toFixed(3) })),
  }
  if (o.report) writeFileSync(o.report, JSON.stringify(rep, null, 1) + '\n')
  console.log(JSON.stringify({ out_seconds: rep.out_seconds, added_hold_seconds: rep.added_hold_seconds, under_cap: rep.under_cap, redrawn: rep.redrawn }))
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
