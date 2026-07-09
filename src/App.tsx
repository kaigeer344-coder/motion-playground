import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignHorizontalJustifyCenter,
  BadgeCheck,
  BarChart3,
  Check,
  ClipboardCheck,
  Columns2,
  CreditCard,
  FileCheck2,
  Film,
  Gauge,
  Magnet,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Quote,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Truck,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import './App.css'

type MotionKey = 'metric' | 'compare' | 'quote' | 'flow' | 'bars'

type MotionPreset = {
  id: MotionKey
  title: string
  eyebrow: string
  description: string
  duration: string
}

type Controls = {
  intensity: number
  contrast: number
  pace: number
  lineWeight: number
}

type VideoAsset = {
  duration: number | null
  name: string
  size: number
  url: string
}

type OverlayPosition = {
  x: number
  y: number
}

type DragState = {
  id?: string
  key?: MotionKey
  mode: 'json' | 'json-resize' | 'manual'
  origin: OverlayPosition
  originScale?: number
  pointerId: number
  scaleX?: number
  scaleY?: number
  startX: number
  startY: number
}

type TimelineDragState = {
  contentWidth: number
  id: string
  mode: 'move' | 'trim-end' | 'trim-start'
  moved: boolean
  originEnd: number
  originStart: number
  pointerId: number
  startX: number
}

type ExportState = {
  current: number
  directory?: string
  file?: string
  format: 'video'
  phase?: string
  total: number
}

type ProgressState = {
  current: number
  phase: string
  total: number
}

type OverlayText = Record<string, unknown>

type OverlayItem = {
  end: string
  endSeconds: number
  fontSize: number
  id: string
  kind: MotionKey
  scale: number
  start: string
  startSeconds: number
  text: OverlayText
  w: number
  x: number
  y: number
}

type OverlayProject = {
  duration: number
  name: string
  overlays: OverlayItem[]
}

type AiConfig = {
  apiKey: string
  baseUrl: string
  model: string
}

type GeneratedMotionKey = Exclude<MotionKey, 'flow'>
type NumericMotionKey = 'metric' | 'bars'

type SrtCue = {
  endSeconds: number
  index: number
  startSeconds: number
  text: string
}

const EXPORT_WIDTH = 1920
const EXPORT_HEIGHT = 1080
const EXPORT_FPS = 30
const SAFE_AREA_RATIO = 0.6
const SIDE_EFFECT_WIDTH = EXPORT_WIDTH * ((1 - SAFE_AREA_RATIO) / 2)
const RIGHT_EFFECT_MIN_X = EXPORT_WIDTH - SIDE_EFFECT_WIDTH
const EXPORT_ROOT_LABEL = '~/Desktop/剪辑素材'
const GENERATED_OVERLAY_MIN_SECONDS = 2.5
const GENERATED_OVERLAY_FADE_SECONDS = 1.2
const GENERATED_OVERLAY_MAX_COUNT = 14
const AI_CONFIG_STORAGE_KEY = 'overlay-studio-ai-config'
const TIMELINE_MIN_ZOOM = 1
const TIMELINE_MAX_ZOOM = 16
const TIMELINE_ZOOM_STEP = 0.5

const defaultAiConfig: AiConfig = {
  apiKey: '',
  baseUrl: '',
  model: '',
}

const presets: MotionPreset[] = [
  {
    id: 'metric',
    title: 'MetricFocus',
    eyebrow: '核心数字动效',
    description: '数字聚焦、基准线推进、单位信息延迟出现。',
    duration: '04s',
  },
  {
    id: 'compare',
    title: 'CompareSplit',
    eyebrow: '左右对比卡',
    description: '左右信息分屏进入，中线切割，对比结论锁定。',
    duration: '05s',
  },
  {
    id: 'quote',
    title: 'QuoteLockup',
    eyebrow: '金句定格卡',
    description: '一句话定格、署名压入、细线框完成封版。',
    duration: '06s',
  },
  {
    id: 'bars',
    title: 'BarInsight',
    eyebrow: '柱形图模块',
    description: '双柱对比数据卡，蓝青渐变发光，透明背景。',
    duration: '05s',
  },
]

const defaultControls: Controls = {
  intensity: 64,
  contrast: 72,
  pace: 58,
  lineWeight: 42,
}

const componentIcon = {
  metric: Gauge,
  compare: Columns2,
  quote: Quote,
  flow: ClipboardCheck,
  bars: BarChart3,
}

const defaultOverlayPositions: Record<MotionKey, OverlayPosition> = {
  metric: { x: 0, y: 0 },
  compare: { x: 0, y: 0 },
  quote: { x: 0, y: 0 },
  flow: { x: 0, y: 0 },
  bars: { x: 0, y: 0 },
}

function parseDurationSeconds(duration: string) {
  const seconds = Number(duration.replace(/[^0-9.]/g, ''))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 5
}

function parseTimestampSeconds(timestamp: string) {
  const match = timestamp.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/)

  if (!match) {
    return Number.NaN
  }

  const [, hours, minutes, seconds, milliseconds] = match
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  )
}

function isMotionKey(value: unknown): value is MotionKey {
  return value === 'metric' || value === 'compare' || value === 'quote' || value === 'bars'
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeNumericGlyphs(value: string) {
  const map: Record<string, string> = {
    '０': '0',
    '１': '1',
    '２': '2',
    '３': '3',
    '４': '4',
    '５': '5',
    '６': '6',
    '７': '7',
    '８': '8',
    '９': '9',
    '．': '.',
    '％': '%',
  }

  return value.replace(/[０-９．％]/g, (char) => map[char] ?? char)
}

function extractNumericDisplayValue(value: unknown, fallback = '40%') {
  const normalized = normalizeNumericGlyphs(readText(value, ''))
    .replace(/百分之/g, '')
    .trim()
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?\s*(?:%|百分|万|亿|元|块|人|倍|秒|分钟|小时|天|个)?/)

  if (!match) {
    return fallback
  }

  return match[0].replace(/\s+/g, '').replace(/百分$/, '%')
}

function splitNumericDisplay(value: string, fallbackValue = '73', fallbackUnit = '%') {
  const match = normalizeNumericGlyphs(value).match(/^([-+]?\d+(?:\.\d+)?)(.*)$/)

  if (!match) {
    return {
      unit: fallbackUnit,
      value: fallbackValue,
    }
  }

  const unit = match[2].trim().replace(/^百分$/, '%')

  return {
    unit: unit || fallbackUnit,
    value: match[1],
  }
}

function sanitizeOverlayText(kind: MotionKey, text: OverlayText) {
  if (kind === 'metric') {
    const display = extractNumericDisplayValue(text.value, '73%')
    const numeric = splitNumericDisplay(display)
    const explicitUnit = readText(text.unit, '').trim()

    return {
      ...text,
      unit: explicitUnit || numeric.unit,
      value: numeric.value,
    }
  }

  if (kind === 'bars') {
    const firstItem = Array.isArray(text.items) && text.items[0] && typeof text.items[0] === 'object'
      ? text.items[0] as Record<string, unknown>
      : {}
    const value = extractNumericDisplayValue(firstItem.value, extractNumericDisplayValue(text.value, '40%'))

    return {
      ...text,
      items: [{ ...firstItem, value }],
    }
  }

  return text
}

function getMetricTextFromOverlayText(text: OverlayText) {
  const firstItem = Array.isArray(text.items) && text.items[0] && typeof text.items[0] === 'object'
    ? text.items[0] as Record<string, unknown>
    : {}
  const display = extractNumericDisplayValue(text.value, extractNumericDisplayValue(firstItem.value, '73%'))
  const numeric = splitNumericDisplay(display)
  const explicitUnit = readText(text.unit, '').trim()

  return {
    unit: explicitUnit || numeric.unit,
    value: numeric.value,
  }
}

function getBarsTextFromOverlayText(text: OverlayText) {
  const firstItem = Array.isArray(text.items) && text.items[0] && typeof text.items[0] === 'object'
    ? text.items[0] as Record<string, unknown>
    : {}
  const metricValue = `${readText(text.value, '')}${readText(text.unit, '')}`
  const value = extractNumericDisplayValue(firstItem.value, extractNumericDisplayValue(metricValue, '40%'))

  return {
    items: [{ ...firstItem, value }],
  }
}

function convertNumericOverlayKind(item: OverlayItem, kind: NumericMotionKey): OverlayItem {
  const placement = getOverlayPlacement(item)
  const w = getDefaultOverlayWidth(kind)
  const scale = kind === 'bars' ? 0.86 : 0.9

  return {
    ...item,
    fontSize: getDefaultFontSize(kind),
    kind,
    scale,
    text: kind === 'metric' ? getMetricTextFromOverlayText(item.text) : getBarsTextFromOverlayText(item.text),
    w,
    x: Math.round(getCenteredSideX(placement, w, scale)),
    y: kind === 'bars' ? 246 : 180,
  }
}

function enforceNumericKindAlternation(overlays: OverlayItem[]) {
  let nextNumericKind: NumericMotionKey = 'metric'

  return overlays.map((item) => {
    if (item.kind !== 'metric' && item.kind !== 'bars') {
      return item
    }

    const nextItem = convertNumericOverlayKind(item, nextNumericKind)
    nextNumericKind = nextNumericKind === 'metric' ? 'bars' : 'metric'

    return nextItem
  })
}

function getCenteredSideX(placement: 'left' | 'right', width: number, scale = 1) {
  const visualWidth = Math.min(width * scale, SIDE_EFFECT_WIDTH)
  const inset = (SIDE_EFFECT_WIDTH - visualWidth) / 2

  return placement === 'right' ? RIGHT_EFFECT_MIN_X + inset : inset
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function getProgressPercent(current: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((current / total) * 100)))
}

function loadAiConfig() {
  if (typeof window === 'undefined') {
    return defaultAiConfig
  }

  try {
    const stored = window.localStorage.getItem(AI_CONFIG_STORAGE_KEY)

    if (!stored) {
      return defaultAiConfig
    }

    const parsed = JSON.parse(stored) as Partial<AiConfig>

    return {
      apiKey: readText(parsed.apiKey, ''),
      baseUrl: readText(parsed.baseUrl, ''),
      model: readText(parsed.model, ''),
    }
  } catch {
    return defaultAiConfig
  }
}

function hasCompleteAiConfig(config: AiConfig) {
  return Boolean(config.apiKey.trim() && config.baseUrl.trim() && config.model.trim())
}

function getCanvasFontScale(text: OverlayText) {
  return readNumber(text.__fontScale, 1)
}

function normalizeOverlayProject(payload: unknown, name: string): OverlayProject {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { overlays?: unknown }).overlays)) {
    throw new Error('JSON 结构需要包含 overlays 数组')
  }

  const overlays = (payload as { overlays: unknown[] }).overlays.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`overlay_${String(index + 1).padStart(4, '0')} 不是有效对象`)
    }

    const source = item as Record<string, unknown>
    const kind = source.kind
    const start = source.start
    const end = source.end

    if (!isMotionKey(kind)) {
      throw new Error(`第 ${index + 1} 个卡片 kind 不在现有卡片库内`)
    }

    if (typeof start !== 'string' || typeof end !== 'string') {
      throw new Error(`第 ${index + 1} 个卡片缺少 start/end`)
    }

    const startSeconds = parseTimestampSeconds(start)
    const endSeconds = parseTimestampSeconds(end)

    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
      throw new Error(`第 ${index + 1} 个卡片时间区间无效`)
    }

    const defaultWidth = getDefaultOverlayWidth(kind)
    const w = Math.min(defaultWidth, Math.max(120, readNumber(source.w, defaultWidth)))
    const y = readNumber(source.y, kind === 'flow' || kind === 'compare' ? 280 : 220)
    const scale = Math.min(2, SIDE_EFFECT_WIDTH / w, Math.max(0.4, readNumber(source.scale, 1)))
    const requestedX = readNumber(source.x, index % 2 === 0 ? 0 : EXPORT_WIDTH)
    const placement = requestedX >= EXPORT_WIDTH / 2 ? 'right' : 'left'
    const x = Math.round(getCenteredSideX(placement, w, scale))
    const text = sanitizeOverlayText(kind, source.text && typeof source.text === 'object' ? source.text as OverlayText : {})

    return {
      end,
      endSeconds,
      fontSize: readNumber(source.fontSize, 72),
      id: readText(source.id, `overlay_${String(index + 1).padStart(4, '0')}`),
      kind,
      scale,
      start,
      startSeconds,
      text,
      w,
      x,
      y,
    }
  })

  const alternatedOverlays = enforceNumericKindAlternation(overlays)

  return {
    duration: alternatedOverlays.reduce((max, item) => Math.max(max, item.endSeconds), 0),
    name,
    overlays: alternatedOverlays,
  }
}

function parseFlexibleSrtTimestamp(timestamp: string) {
  const match = timestamp
    .trim()
    .match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/)

  if (!match) {
    return Number.NaN
  }

  const [, hours, minutes, seconds, milliseconds] = match
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds.padEnd(3, '0')) / 1000
  )
}

function cleanSrtCueText(text: string) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\[[^\]]*(音乐|掌声|笑声|music|applause)[^\]]*\]/gi, ' ')
    .replace(/^\s*[-–—]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSrtText(text: string): SrtCue[] {
  return text
    .replace(/\r/g, '')
    .trim()
    .split(/\n{2,}/)
    .map((block, blockIndex) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
      const timeLineIndex = lines.findIndex((line) => line.includes('-->'))

      if (timeLineIndex < 0) {
        return null
      }

      const [startRaw, endRaw] = lines[timeLineIndex].split('-->').map((part) => part.trim())
      const startSeconds = parseFlexibleSrtTimestamp(startRaw)
      const endSeconds = parseFlexibleSrtTimestamp(endRaw)
      const cueText = cleanSrtCueText(lines.slice(timeLineIndex + 1).join(' '))

      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || !cueText) {
        return null
      }

      return {
        endSeconds,
        index: blockIndex + 1,
        startSeconds,
        text: cueText,
      }
    })
    .filter((cue): cue is SrtCue => Boolean(cue))
}

function limitDisplayText(text: string, maxLength: number) {
  const normalized = cleanSrtCueText(text).replace(/[“”"']/g, '')
  const chars = Array.from(normalized)
  return chars.length > maxLength ? chars.slice(0, maxLength).join('') : normalized
}

function hasAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()))
}

function scoreSrtCue(cue: SrtCue) {
  const text = cue.text
  let score = Math.min(3, Array.from(text).length / 18)

  if (/[0-9０-９]+/.test(text)) score += 4
  if (/%|％|百分|倍|万|亿|元|块|人|秒|分钟|小时/.test(text)) score += 2.5
  if (/[?？]|为什么|怎么|如何|到底/.test(text)) score += 2
  if (hasAnyKeyword(text, ['核心', '关键', '本质', '重点', '问题', '发现', '记住', '结论', '原因'])) score += 3
  if (hasAnyKeyword(text, ['AI', '人工智能', '工具', '模型', '自动', '效率', '智能手机', '互联网'])) score += 2.5
  if (hasAnyKeyword(text, ['不是', '而是', '但是', '相比', '对比', '过去', '现在', '传统', '未来'])) score += 2
  if (hasAnyKeyword(text, ['然后', '就是', '这个', '那个', '其实就是说']) && Array.from(text).length < 12) score -= 3

  return score
}

function classifySrtCue(text: string): GeneratedMotionKey {
  if (/[0-9０-９]+/.test(text) && /%|％|百分|提升|增长|降低|减少|省|节省|转化|留存|复购/.test(text)) {
    return 'bars'
  }

  if (/[0-9０-９]+/.test(text) && /万|亿|元|块|人|倍|秒|分钟|小时|天/.test(text)) {
    return 'metric'
  }

  if (hasAnyKeyword(text, ['不是', '而是', '但是', '相比', '对比', '过去', '现在', '传统', '智能手机', '互联网'])) {
    return 'compare'
  }

  if (/[0-9０-９]+/.test(text)) {
    return 'metric'
  }

  return 'quote'
}

function summarizeSrtCue(text: string, maxLength = 14) {
  const normalized = cleanSrtCueText(text)
  const rules: Array<[RegExp, string]> = [
    [/学习类?APP|学习.*软件|背单词|刷题|题库/, '学习工具的核心问题'],
    [/AI|人工智能|大模型|智能体/, 'AI 工具正在改写效率'],
    [/智能手机|手机|移动互联网/, 'AI 会像手机一样普及'],
    [/流量|变现|商业|赚钱|收入/, '流量变现的关键'],
    [/留存|复购|增长|转化|用户/, '增长靠留存和转化'],
    [/效率|自动|批量|节省|省下/, '效率提升才是关键'],
    [/焦虑|坚持|放弃|习惯/, '真正难的是持续'],
    [/为什么|原因|问题|本质/, '问题背后的本质'],
  ]
  const hit = rules.find(([pattern]) => pattern.test(normalized))

  if (hit) {
    return hit[1]
  }

  const clauses = normalized
    .split(/[，。！？；：,.!?;:\s]+/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(然后|就是|所以|那么|这个|那个|其实)$/.test(part))
    .sort((a, b) => b.length - a.length)

  return limitDisplayText(clauses[0] ?? normalized, maxLength)
}

function extractPrimaryNumber(text: string) {
  const percentMatch = text.match(/([0-9０-９]+(?:[.．][0-9０-９]+)?)\s*(%|％)/)

  if (percentMatch) {
    return {
      unit: '%',
      value: percentMatch[1].replace(/[０-９．]/g, (char) => {
        const map: Record<string, string> = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9', '．': '.' }
        return map[char] ?? char
      }),
    }
  }

  const numberMatch = text.match(/([0-9０-９]+(?:[.．][0-9０-９]+)?)(\s*)(万|亿|元|块|人|倍|秒|分钟|小时|天|个)?/)

  if (!numberMatch) {
    return { unit: '%', value: '73' }
  }

  const value = numberMatch[1].replace(/[０-９．]/g, (char) => {
    const map: Record<string, string> = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9', '．': '.' }
    return map[char] ?? char
  })

  return {
    unit: numberMatch[3] ?? '',
    value,
  }
}

function splitQuoteLines(summary: string) {
  const chars = Array.from(summary)

  if (chars.length <= 7) {
    return { line1: summary, line2: '' }
  }

  const splitAt = Math.min(8, Math.max(5, Math.ceil(chars.length / 2)))
  return {
    line1: chars.slice(0, splitAt).join(''),
    line2: chars.slice(splitAt, 16).join(''),
  }
}

function getQuoteHighlights(text: string) {
  const blue = ['AI', '效率', '流量', '增长', '工具', '手机', '关键'].filter((word) => text.includes(word))
  const green = ['变现', '留存', '转化', '持续', '复购'].filter((word) => text.includes(word))

  return {
    blue: blue.slice(0, 2),
    green: green.slice(0, 1),
  }
}

function selectSrtKeyCues(cues: SrtCue[]) {
  const duration = cues.reduce((max, cue) => Math.max(max, cue.endSeconds), 0)
  const desiredCount = Math.min(GENERATED_OVERLAY_MAX_COUNT, Math.max(6, Math.ceil(duration / 8)))
  const candidates = cues
    .map((cue) => ({ cue, score: scoreSrtCue(cue) }))
    .filter((item) => item.score > 1)

  if (!candidates.length) {
    return cues.slice(0, Math.min(6, cues.length))
  }

  const selected: SrtCue[] = []
  const segmentLength = duration / desiredCount || 8

  for (let index = 0; index < desiredCount; index += 1) {
    const segmentStart = index * segmentLength
    const segmentEnd = index === desiredCount - 1 ? duration + 1 : (index + 1) * segmentLength
    const best = candidates
      .filter((item) => item.cue.startSeconds >= segmentStart && item.cue.startSeconds < segmentEnd)
      .sort((a, b) => b.score - a.score || a.cue.startSeconds - b.cue.startSeconds)[0]

    if (best && selected.every((cue) => Math.abs(cue.startSeconds - best.cue.startSeconds) >= GENERATED_OVERLAY_MIN_SECONDS)) {
      selected.push(best.cue)
    }
  }

  const byScore = [...candidates].sort((a, b) => b.score - a.score || a.cue.startSeconds - b.cue.startSeconds)
  byScore.forEach(({ cue }) => {
    if (
      selected.length < Math.min(desiredCount, candidates.length) &&
      selected.every((item) => item.index !== cue.index) &&
      selected.every((item) => Math.abs(item.startSeconds - cue.startSeconds) >= GENERATED_OVERLAY_MIN_SECONDS)
    ) {
      selected.push(cue)
    }
  })

  return selected.sort((a, b) => a.startSeconds - b.startSeconds)
}

function getGeneratedOverlayLayout(kind: GeneratedMotionKey, index: number) {
  const placement: 'left' | 'right' = index % 2 === 0 ? 'left' : 'right'

  if (kind === 'compare') {
    return {
      placement,
      scale: 0.72,
      w: 220,
      x: Math.round(getCenteredSideX(placement, 220, 0.72)),
      y: 286,
    }
  }

  if (kind === 'bars') {
    return {
      placement,
      scale: 0.86,
      w: 180,
      x: Math.round(getCenteredSideX(placement, 180, 0.86)),
      y: 246,
    }
  }

  return {
    placement,
    scale: kind === 'quote' ? 0.94 : 0.9,
    w: 300,
    x: Math.round(getCenteredSideX(placement, 300, kind === 'quote' ? 0.94 : 0.9)),
    y: kind === 'metric' ? 180 : 214,
  }
}

function getCompareText(text: string) {
  if (/智能手机|手机/.test(text)) {
    return {
      leftCaption: '移动互联网',
      leftLabel: 'Before',
      leftValue: '手机',
      rightCaption: '新效率入口',
      rightLabel: 'After',
      rightValue: 'AI',
    }
  }

  if (/传统|过去|以前/.test(text)) {
    return {
      leftCaption: '原来的方式',
      leftLabel: 'Before',
      leftValue: '过去',
      rightCaption: '新的方式',
      rightLabel: 'After',
      rightValue: '现在',
    }
  }

  const summary = summarizeSrtCue(text, 12)
  return {
    leftCaption: '旧路径',
    leftLabel: 'Before',
    leftValue: limitDisplayText(summary, 4),
    rightCaption: '新机会',
    rightLabel: 'After',
    rightValue: /AI|人工智能/.test(text) ? 'AI' : '升级',
  }
}

function makeSrtOverlay(cue: SrtCue, index: number, nextCue: SrtCue | undefined, finalEndSeconds: number): OverlayItem {
  const kind = classifySrtCue(cue.text)
  const layout = getGeneratedOverlayLayout(kind, index)
  const summary = summarizeSrtCue(cue.text)
  const endSeconds = nextCue
    ? Math.max(cue.startSeconds + GENERATED_OVERLAY_MIN_SECONDS, nextCue.startSeconds + GENERATED_OVERLAY_FADE_SECONDS)
    : Math.max(cue.startSeconds + 4, cue.endSeconds + GENERATED_OVERLAY_FADE_SECONDS, finalEndSeconds)
  const number = extractPrimaryNumber(cue.text)
  let text: OverlayText

  if (kind === 'metric') {
    text = {
      unit: number.unit,
      value: number.value,
    }
  } else if (kind === 'bars') {
    text = {
      items: [{ value: `${number.value}${number.unit}` }],
    }
  } else if (kind === 'compare') {
    text = getCompareText(cue.text)
  } else {
    const lines = splitQuoteLines(summary)
    text = {
      ...lines,
      ...getQuoteHighlights(summary),
      eyebrow: 'INSIGHT',
    }
  }

  return {
    end: formatSrtTimestamp(endSeconds),
    endSeconds,
    fontSize: getDefaultFontSize(kind),
    id: `srt_overlay_${String(index + 1).padStart(4, '0')}`,
    kind,
    scale: layout.scale,
    start: formatSrtTimestamp(cue.startSeconds),
    startSeconds: cue.startSeconds,
    text,
    w: layout.w,
    x: clampSideX(layout.x, layout.w * layout.scale),
    y: layout.y,
  }
}

function generateOverlayProjectFromSrt(text: string, fileName: string): OverlayProject {
  const cues = parseSrtText(text)

  if (!cues.length) {
    throw new Error('没有识别到有效 SRT 字幕时间轴')
  }

  const selectedCues = selectSrtKeyCues(cues)
  const finalEndSeconds = cues.reduce((max, cue) => Math.max(max, cue.endSeconds), 0)
  const overlays = enforceNumericKindAlternation(
    selectedCues.map((cue, index) => makeSrtOverlay(cue, index, selectedCues[index + 1], finalEndSeconds)),
  )
  const stem = fileName.replace(/\.[^.]+$/, '')

  return {
    duration: Math.max(finalEndSeconds, ...overlays.map((item) => item.endSeconds)),
    name: `${stem}_overlay_auto.json`,
    overlays,
  }
}

function getOverlayPlacement(item: OverlayItem) {
  return item.x >= EXPORT_WIDTH / 2 ? 'right' : 'left'
}

function getDefaultAnchor(kind: MotionKey, placement: 'left' | 'right') {
  if (kind === 'flow') {
    return { x: Math.round(getCenteredSideX(placement, getDefaultOverlayWidth(kind))), y: 280 }
  }

  if (kind === 'compare') {
    return { x: Math.round(getCenteredSideX(placement, getDefaultOverlayWidth(kind))), y: 280 }
  }

  if (kind === 'bars') {
    return { x: Math.round(getCenteredSideX(placement, getDefaultOverlayWidth(kind))), y: 246 }
  }

  return { x: Math.round(getCenteredSideX(placement, getDefaultOverlayWidth(kind))), y: 220 }
}

function getOverlayAnchor(item: OverlayItem) {
  const placement = getOverlayPlacement(item)
  const defaultAnchor = getDefaultAnchor(item.kind, placement)

  return {
    x: Math.round(getCenteredSideX(placement, item.w, item.scale)),
    y: defaultAnchor.y,
  }
}

function getJsonOverlayStyle(item: OverlayItem) {
  const anchor = getOverlayAnchor(item)
  const fontScale = Math.max(0.55, Math.min(1.65, item.fontSize / getDefaultFontSize(item.kind)))

  return {
    '--json-bar-value-size': `${40 * fontScale}px`,
    '--json-compare-caption-size': `${10 * fontScale}px`,
    '--json-compare-label-size': `${9 * fontScale}px`,
    '--json-compare-value-size': `${34 * fontScale}px`,
    '--json-flow-node-size': `${13 * fontScale}px`,
    '--json-flow-text-size': `${10 * fontScale}px`,
    '--json-metric-number-size': `${66 * fontScale}px`,
    '--json-metric-unit-size': `${23 * fontScale}px`,
    '--json-offset-x': `${((item.x - anchor.x) / EXPORT_WIDTH) * 100}%`,
    '--json-offset-y': `${((item.y - anchor.y) / EXPORT_HEIGHT) * 100}%`,
    '--json-quote-eyebrow-size': `${20 * fontScale}px`,
    '--json-quote-size': `${26 * fontScale}px`,
    '--json-scale': item.scale,
  } as React.CSSProperties
}

function getDefaultFontSize(kind: MotionKey) {
  if (kind === 'metric') return 132
  if (kind === 'compare') return 74
  if (kind === 'flow') return 20
  if (kind === 'bars') return 58
  return 72
}

function clampSideX(x: number, w: number) {
  const clampedWidth = Math.min(w, SIDE_EFFECT_WIDTH)
  const leftMax = SIDE_EFFECT_WIDTH - clampedWidth

  if (x < 960) {
    return Math.min(Math.max(0, x), leftMax)
  }

  return Math.min(Math.max(RIGHT_EFFECT_MIN_X, x), EXPORT_WIDTH - clampedWidth)
}

function getOverlayLabel(item: OverlayItem) {
  if (item.kind === 'metric') return `${readText(item.text.value, item.kind)}${readText(item.text.unit, '')}`
  if (item.kind === 'quote') return readText(item.text.line1, item.kind)
  if (item.kind === 'compare') return `${readText(item.text.leftValue, 'Before')} / ${readText(item.text.rightValue, 'After')}`
  if (item.kind === 'flow') {
    const steps = Array.isArray(item.text.steps) ? item.text.steps.filter((step) => typeof step === 'string') : []
    return steps[0] ? String(steps[0]) : item.kind
  }
  if (item.kind === 'bars') {
    const firstItem = Array.isArray(item.text.items) && item.text.items[0] && typeof item.text.items[0] === 'object' ? item.text.items[0] as Record<string, unknown> : {}
    return extractNumericDisplayValue(firstItem.value, item.kind)
  }
  return item.kind
}

function getOverlayBoxHeight(kind: MotionKey) {
  if (kind === 'flow') return 340
  if (kind === 'compare') return 210
  if (kind === 'bars') return 260
  if (kind === 'quote') return 310
  return 260
}

function getDefaultOverlayWidth(kind: MotionKey) {
  if (kind === 'compare') return 220
  if (kind === 'bars') return 180
  if (kind === 'flow') return 260
  return 300
}

function getDefaultOverlayText(kind: MotionKey): OverlayText {
  if (kind === 'metric') {
    return { unit: '%', value: '73' }
  }

  if (kind === 'compare') {
    return {
      leftCaption: '剪辑前',
      leftLabel: 'Before',
      leftValue: '03:42',
      rightCaption: '优化后',
      rightLabel: 'After',
      rightValue: '00:58',
    }
  }

  if (kind === 'quote') {
    return {
      line1: '只要有流量',
      line2: '变现不愁',
    }
  }

  if (kind === 'flow') {
    return {
      activeStep: 3,
      steps: ['Cart Review', 'Shipping Info', 'Payment Method', 'Billing Address', 'Confirmation'],
    }
  }

  return { items: [{ value: '40%' }] }
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - Math.min(Math.max(value, 0), 1), 3)
}

function setupExportContext(context: CanvasRenderingContext2D) {
  context.clearRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT)
  context.textBaseline = 'alphabetic'
  context.lineJoin = 'round'
  context.lineCap = 'round'
}

function drawRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function drawTextShadow(context: CanvasRenderingContext2D) {
  context.shadowColor = 'rgba(0, 0, 0, 0.62)'
  context.shadowBlur = 12
  context.shadowOffsetY = 4
}

function clearTextShadow(context: CanvasRenderingContext2D) {
  context.shadowColor = 'transparent'
  context.shadowBlur = 0
  context.shadowOffsetY = 0
}

function getCanvasPlacement(text: OverlayText): 'left' | 'right' {
  return text.__placement === 'right' ? 'right' : 'left'
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const units = text.includes(' ') ? text.split(/(\s+)/).filter(Boolean) : Array.from(text)
  const lines: string[] = []
  let line = ''

  units.forEach((unit) => {
    const nextLine = line ? `${line}${unit}` : unit
    if (line && context.measureText(nextLine).width > maxWidth) {
      lines.push(line.trimEnd())
      line = unit.trimStart()
      return
    }

    line = nextLine
  })

  if (line) {
    lines.push(line.trimEnd())
  }

  return lines
}

function drawWrappedCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const lines = wrapCanvasText(context, text, maxWidth)
  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight)
  })

  return y + Math.max(lines.length, 1) * lineHeight
}

function drawMetricOverlay(
  context: CanvasRenderingContext2D,
  time: number,
  duration: number,
  offset: OverlayPosition,
  text: OverlayText = {},
) {
  const progress = easeOutCubic(time / Math.min(duration, 1.2))
  const x = (getCanvasPlacement(text) === 'right' ? 1603 : 67) + offset.x
  const y = 320 + offset.y
  const width = 250
  const value = readText(text.value, '73')
  const unit = readText(text.unit, '%')
  const fontScale = getCanvasFontScale(text)

  context.globalAlpha = progress
  drawTextShadow(context)
  context.fillStyle = 'rgba(255, 255, 255, 0.22)'
  drawRoundRect(context, x, y, width, 6, 6)
  context.fill()

  const gradient = context.createLinearGradient(x, y, x + width, y)
  gradient.addColorStop(0, '#1d7cff')
  gradient.addColorStop(0.72, '#58c7ff')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.82)')
  context.fillStyle = gradient
  drawRoundRect(context, x, y, width * (0.34 + 0.42 * progress), 6, 6)
  context.fill()

  context.fillStyle = 'rgba(255, 255, 255, 0.95)'
  context.font = `900 ${132 * fontScale}px Arial Black, Arial, sans-serif`
  context.fillText(value, x, y + 140)
  if (unit) {
    context.font = `900 ${42 * fontScale}px Arial Black, Arial, sans-serif`
    context.fillText(unit, x + Math.max(96, value.length * 72 * fontScale), y + 76)
  }
  clearTextShadow(context)
  context.globalAlpha = 1
}

function drawCompareOverlay(
  context: CanvasRenderingContext2D,
  time: number,
  duration: number,
  offset: OverlayPosition,
  text: OverlayText = {},
) {
  const progress = easeOutCubic(time / Math.min(duration, 1.1))
  const color = '#58c7ff'
  const leftX = 62 + offset.x - (1 - progress) * 42
  const rightX = 1598 + offset.x + (1 - progress) * 42
  const y = 468 + offset.y
  const fontScale = getCanvasFontScale(text)

  context.globalAlpha = progress
  drawTextShadow(context)
  context.fillStyle = color
  context.font = `800 ${28 * fontScale}px Arial, sans-serif`
  context.fillText(readText(text.leftLabel, 'Before'), leftX, y)
  context.font = `900 ${92 * fontScale}px Arial Black, Arial, sans-serif`
  context.fillText(readText(text.leftValue, '03:42'), leftX, y + 106)
  context.font = `700 ${27 * fontScale}px Arial, sans-serif`
  context.fillText(readText(text.leftCaption, '剪辑定位耗时'), leftX, y + 154)

  context.font = `800 ${28 * fontScale}px Arial, sans-serif`
  context.fillText(readText(text.rightLabel, 'After'), rightX, y)
  context.font = `900 ${92 * fontScale}px Arial Black, Arial, sans-serif`
  context.fillText(readText(text.rightValue, '00:58'), rightX, y + 106)
  context.font = `700 ${27 * fontScale}px Arial, sans-serif`
  context.fillText(readText(text.rightCaption, '同样片段复盘'), rightX, y + 154)
  clearTextShadow(context)
  context.globalAlpha = 1
}

function drawQuoteOverlay(
  context: CanvasRenderingContext2D,
  time: number,
  duration: number,
  offset: OverlayPosition,
  text: OverlayText = {},
) {
  const progress = easeOutCubic(time / Math.min(duration, 1.25))
  const x = (getCanvasPlacement(text) === 'right' ? 1578 : 42) + offset.x
  const y = 245 + offset.y
  const line1 = readText(text.line1, '只要有流量')
  const line2 = readText(text.line2, '变现不愁')
  const fontScale = getCanvasFontScale(text)
  const maxWidth = Math.max(120, readNumber(text.__boxWidth, 420))
  const headlineSize = 48 * fontScale
  const headlineLineHeight = headlineSize * 1.02

  context.globalAlpha = progress
  drawTextShadow(context)
  context.fillStyle = '#1d7cff'
  context.font = `900 ${36 * fontScale}px Arial Black, Arial, sans-serif`
  context.fillText(readText(text.eyebrow, 'INSIGHT'), x, y)

  context.font = `900 ${headlineSize}px Arial Black, Arial, sans-serif`
  context.fillStyle = 'rgba(255, 255, 255, 0.96)'
  const nextY = drawWrappedCanvasText(context, line1, x, y + 86, maxWidth, headlineLineHeight)
  context.fillStyle = 'rgba(255, 255, 255, 0.96)'
  drawWrappedCanvasText(context, line2, x, nextY, maxWidth, headlineLineHeight)
  clearTextShadow(context)
  context.globalAlpha = 1
}

function drawFlowOverlay(
  context: CanvasRenderingContext2D,
  time: number,
  duration: number,
  offset: OverlayPosition,
  text: OverlayText = {},
) {
  const progress = easeOutCubic(time / Math.min(duration, 1.4))
  const x = (getCanvasPlacement(text) === 'right' ? 1598 : 62) + offset.x
  const y = 318 + offset.y
  const labels = Array.isArray(text.steps)
    ? text.steps.filter((step): step is string => typeof step === 'string').slice(0, 5).map((step, index) => `${index + 1} ${step}`)
    : ['1 Review', '2 Ship', '3 Pay', '4 Bill', '5 Done']
  const activeStep = readNumber(text.activeStep, 3)
  const fontScale = getCanvasFontScale(text)

  context.globalAlpha = progress
  drawTextShadow(context)
  labels.forEach((label, index) => {
    const rowY = y + index * 56
    const isActive = index + 1 === activeStep
    const isDone = index + 1 < activeStep

    if (index > 0) {
      context.strokeStyle = 'rgba(88, 199, 255, 0.42)'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(x + 24, rowY - 36)
      context.lineTo(x + 24, rowY - 12)
      context.stroke()
    }

    context.fillStyle = isDone ? 'rgba(88, 199, 255, 0.86)' : isActive ? 'rgba(29, 124, 255, 0.74)' : 'rgba(5, 7, 10, 0.42)'
    context.strokeStyle = isActive ? 'rgba(88, 199, 255, 0.74)' : 'rgba(255, 255, 255, 0.18)'
    context.lineWidth = 2
    context.beginPath()
    context.arc(x + 24, rowY, 22, 0, Math.PI * 2)
    context.fill()
    context.stroke()

    context.fillStyle = isDone ? '#07131b' : 'rgba(255, 255, 255, 0.92)'
    context.font = `800 ${20 * fontScale}px Arial, sans-serif`
    context.fillText(isDone ? '✓' : String(index + 1), x + 17, rowY + 7)

    context.fillStyle = isActive ? 'rgba(29, 124, 255, 0.18)' : 'rgba(5, 7, 10, 0.46)'
    drawRoundRect(context, x + 58, rowY - 19, 150, 38, 19)
    context.fill()
    context.strokeStyle = isActive ? 'rgba(88, 199, 255, 0.7)' : 'rgba(255, 255, 255, 0.18)'
    context.stroke()
    context.fillStyle = isActive ? 'rgba(255, 255, 255, 0.94)' : 'rgba(255, 255, 255, 0.58)'
    context.font = `700 ${18 * fontScale}px Arial, sans-serif`
    context.fillText(label, x + 76, rowY + 6)
  })
  clearTextShadow(context)
  context.globalAlpha = 1
}

function drawBarOverlay(
  context: CanvasRenderingContext2D,
  time: number,
  duration: number,
  offset: OverlayPosition,
  text: OverlayText = {},
) {
  const progress = easeOutCubic(time / Math.min(duration, 1.35))
  const x = (getCanvasPlacement(text) === 'right' ? 1690 : 154) + offset.x
  const y = 372 + offset.y
  const barHeight = 190 * progress
  const firstItem = Array.isArray(text.items) && text.items[0] && typeof text.items[0] === 'object' ? text.items[0] as Record<string, unknown> : {}
  const value = extractNumericDisplayValue(firstItem.value, '40%')
  const fontScale = getCanvasFontScale(text)

  context.globalAlpha = progress
  drawTextShadow(context)
  context.fillStyle = 'rgba(255, 255, 255, 0.95)'
  context.font = `900 ${58 * fontScale}px Arial Black, Arial, sans-serif`
  context.fillText(value, x - 20, y)

  const gradient = context.createLinearGradient(x, y + 36, x + 76, y + 36)
  gradient.addColorStop(0, 'rgba(112, 220, 255, 0.96)')
  gradient.addColorStop(0.4, '#58c7ff')
  gradient.addColorStop(1, '#1d7cff')
  context.fillStyle = gradient
  drawRoundRect(context, x, y + 42 + (190 - barHeight), 76, barHeight, 22)
  context.fill()
  clearTextShadow(context)
  context.globalAlpha = 1
}

function drawOverlayFrame(
  context: CanvasRenderingContext2D,
  key: MotionKey,
  time: number,
  duration: number,
  offset: OverlayPosition,
  text: OverlayText = {},
  shouldClear = true,
) {
  if (shouldClear) {
    setupExportContext(context)
  }

  if (key === 'metric') drawMetricOverlay(context, time, duration, offset, text)
  if (key === 'compare') drawCompareOverlay(context, time, duration, offset, text)
  if (key === 'quote') drawQuoteOverlay(context, time, duration, offset, text)
  if (key === 'flow') drawFlowOverlay(context, time, duration, offset, text)
  if (key === 'bars') drawBarOverlay(context, time, duration, offset, text)
}

async function saveExportFrame(exportId: string, frameName: string, dataUrl: string) {
  const response = await fetch('/api/export-frame', {
    body: JSON.stringify({ dataUrl, exportId, frameName }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }
}

async function encodeTransparentVideo(exportId: string) {
  const response = await fetch('/api/encode-transparent-video', {
    body: JSON.stringify({ exportId, fps: EXPORT_FPS }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return (await response.json()) as {
    codec: string
    directory: string
    file: string
    ok: boolean
  }
}

async function requestAiOverlayProject(config: AiConfig, srtText: string, fileName: string) {
  const response = await fetch('/api/generate-overlay', {
    body: JSON.stringify({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      fileName,
      model: config.model,
      srtText,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const payload = (await response.json()) as {
    ok: boolean
    project: unknown
  }

  return normalizeOverlayProject(payload.project, `${fileName.replace(/\.[^.]+$/, '')}_ai_overlay.json`)
}

function App() {
  const [selected, setSelected] = useState<MotionKey>('quote')
  const [isPlaying, setIsPlaying] = useState(true)
  const [controls, setControls] = useState<Controls>(defaultControls)
  const [replayKey, setReplayKey] = useState(0)
  const [videoAsset, setVideoAsset] = useState<VideoAsset | null>(null)
  const [videoTime, setVideoTime] = useState(0)
  const [timelineTime, setTimelineTime] = useState(0)
  const [overlayProject, setOverlayProject] = useState<OverlayProject | null>(null)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [jsonError, setJsonError] = useState('')
  const [srtStatus, setSrtStatus] = useState('')
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => loadAiConfig())
  const [isAiGenerating, setIsAiGenerating] = useState(false)
  const [aiProgress, setAiProgress] = useState<ProgressState | null>(null)
  const [overlayPositions, setOverlayPositions] = useState<Record<MotionKey, OverlayPosition>>(defaultOverlayPositions)
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false)
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false)
  const [isSnapEnabled, setIsSnapEnabled] = useState(true)
  const [timelineZoom, setTimelineZoom] = useState(1.15)
  const [exportState, setExportState] = useState<ExportState | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const srtInputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoUrlRef = useRef<string | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const timelineDragRef = useRef<TimelineDragState | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const suppressTimelineClickRef = useRef(false)

  const activePreset = presets.find((preset) => preset.id === selected) ?? presets[0]
  const isAiReady = hasCompleteAiConfig(aiConfig)
  const projectDuration = Math.max(overlayProject?.duration ?? 0, videoAsset?.duration ?? 0)
  const currentPlaybackTime = videoAsset ? videoTime : timelineTime
  const activeOverlayItems = useMemo(
    () =>
      overlayProject?.overlays.filter(
        (item) => currentPlaybackTime >= item.startSeconds && currentPlaybackTime <= item.endSeconds,
      ) ?? [],
    [currentPlaybackTime, overlayProject],
  )
  const selectedOverlay = useMemo(
    () => overlayProject?.overlays.find((item) => item.id === selectedOverlayId) ?? null,
    [overlayProject, selectedOverlayId],
  )
  const selectedOverlayIsVisible = Boolean(
    selectedOverlay &&
      currentPlaybackTime >= selectedOverlay.startSeconds &&
      currentPlaybackTime <= selectedOverlay.endSeconds,
  )
  const timelineTicks = useMemo(() => {
    if (!projectDuration) {
      return [0]
    }

    const tickCount = Math.min(120, Math.max(6, Math.round(8 * timelineZoom)))
    return Array.from({ length: tickCount + 1 }, (_, index) => (projectDuration / tickCount) * index)
  }, [projectDuration, timelineZoom])
  const timelineContentStyle = useMemo(
    () =>
      ({
        width: `${timelineZoom * 100}%`,
      }) as React.CSSProperties,
    [timelineZoom],
  )
  const timelineZoomPercent = Math.round(timelineZoom * 100)
  const clampTimelineZoom = (value: number) =>
    Math.min(TIMELINE_MAX_ZOOM, Math.max(TIMELINE_MIN_ZOOM, Number(value.toFixed(2))))
  const updateTimelineZoom = (value: number) => {
    setTimelineZoom(clampTimelineZoom(value))
  }

  const stageStyle = useMemo(
    () => ({
      '--intensity': controls.intensity,
      '--contrast': `${controls.contrast}%`,
      '--pace': `${1.8 - controls.pace / 100}s`,
      '--line-weight': `${1 + controls.lineWeight / 50}px`,
      '--motion-state': isPlaying ? 'running' : 'paused',
    }),
    [controls, isPlaying],
  )

  const overlayStyle = useMemo(
    () => ({
      '--overlay-x': `${overlayPositions[selected].x}px`,
      '--overlay-y': `${overlayPositions[selected].y}px`,
    }),
    [overlayPositions, selected],
  )

  const updateControl = (key: keyof Controls, value: number) => {
    setControls((current) => ({ ...current, [key]: value }))
  }

  const updateAiConfig = (key: keyof AiConfig, value: string) => {
    setAiConfig((current) => ({ ...current, [key]: value }))
  }

  const updateOverlayItem = (id: string, patch: Partial<OverlayItem>) => {
    setOverlayProject((current) =>
      current
        ? (() => {
            const overlays = current.overlays.map((item) => (item.id === id ? { ...item, ...patch } : item))
            return {
              ...current,
              duration: Math.max(videoAsset?.duration ?? 0, ...overlays.map((item) => item.endSeconds)),
              overlays,
            }
          })()
        : current,
    )
  }

  const updateOverlayText = (id: string, patch: OverlayText) => {
    setOverlayProject((current) =>
      current
        ? {
            ...current,
            overlays: current.overlays.map((item) =>
              item.id === id ? { ...item, text: { ...item.text, ...patch } } : item,
            ),
          }
        : current,
    )
  }

  const selectOverlay = (item: OverlayItem, shouldSeek = true) => {
    setSelectedOverlayId(item.id)
    setSelected(item.kind)

    if (!shouldSeek) {
      return
    }

    seekVideo(item.startSeconds)
  }

  const addOverlayEffect = () => {
    const duration = parseDurationSeconds(activePreset.duration)
    const startSeconds = Math.min(currentPlaybackTime, Math.max(0, projectDuration - 0.5))
    const endSeconds = Math.max(startSeconds + 0.5, startSeconds + duration)
    const placement = (overlayProject?.overlays.length ?? 0) % 2 === 0 ? 'left' : 'right'
    const anchor = getDefaultAnchor(selected, placement)
    const width = getDefaultOverlayWidth(selected)
    const scale = selected === 'flow' || selected === 'bars' ? 0.88 : 1
    const item: OverlayItem = {
      end: formatSrtTimestamp(endSeconds),
      endSeconds,
      fontSize: getDefaultFontSize(selected),
      id: `overlay_${Date.now().toString(36)}`,
      kind: selected,
      scale,
      start: formatSrtTimestamp(startSeconds),
      startSeconds,
      text: getDefaultOverlayText(selected),
      w: width,
      x: Math.round(getCenteredSideX(placement, width, scale)),
      y: anchor.y,
    }

    setOverlayProject((current) => {
      const overlays = [...(current?.overlays ?? []), item]
      return {
        duration: Math.max(videoAsset?.duration ?? 0, ...overlays.map((overlay) => overlay.endSeconds)),
        name: current?.name ?? 'manual_overlay.json',
        overlays,
      }
    })
    setJsonError('')
    setSelectedOverlayId(item.id)
    seekVideo(startSeconds)
  }

  const updateOverlayDuration = (id: string, duration: number) => {
    const item = overlayProject?.overlays.find((overlay) => overlay.id === id)

    if (!item) {
      return
    }

    const nextEnd = item.startSeconds + Math.max(0.5, duration)
    updateOverlayItem(id, {
      end: formatSrtTimestamp(nextEnd),
      endSeconds: nextEnd,
    })
  }

  const getTrackPercent = (seconds: number) => {
    if (!projectDuration) {
      return 0
    }

    return Math.min(100, Math.max(0, (seconds / projectDuration) * 100))
  }

  const getTimelineLaneBounds = (content: HTMLElement) => {
    const ruler = content.querySelector<HTMLElement>('.timeline-ruler')
    return (ruler ?? content).getBoundingClientRect()
  }

  const getSnappedTime = (seconds: number, ignoredOverlayId?: string) => {
    const clampedTime = Math.min(Math.max(0, seconds), projectDuration || 0)

    if (!isSnapEnabled || !projectDuration || !overlayProject) {
      return clampedTime
    }

    const snapPoints = overlayProject.overlays
      .filter((item) => item.id !== ignoredOverlayId)
      .flatMap((item) => [item.startSeconds, item.endSeconds])
    snapPoints.push(0, projectDuration)

    const threshold = Math.max(0.08, projectDuration * 0.005)
    const nearest = snapPoints.reduce(
      (current, point) => (Math.abs(point - clampedTime) < Math.abs(current - clampedTime) ? point : current),
      snapPoints[0],
    )

    return Math.abs(nearest - clampedTime) <= threshold ? nearest : clampedTime
  }

  const stepPlayback = (delta: number) => {
    seekVideo(currentPlaybackTime + delta)
  }

  const replay = () => {
    setReplayKey((key) => key + 1)
    setIsPlaying(true)
    setTimelineTime(0)
    setVideoTime(0)

    if (videoRef.current) {
      videoRef.current.currentTime = 0
    }
  }

  const openVideoPicker = () => {
    fileInputRef.current?.click()
  }

  const openJsonPicker = () => {
    jsonInputRef.current?.click()
  }

  const openSrtPicker = () => {
    srtInputRef.current?.click()
  }

  const importVideo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !file.type.startsWith('video/')) {
      return
    }

    const url = URL.createObjectURL(file)
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current)
    }
    videoUrlRef.current = url
    setVideoAsset({
      duration: null,
      name: file.name,
      size: file.size,
      url,
    })
    setVideoTime(0)
    setIsPlaying(true)
  }

  const importOverlayJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const project = normalizeOverlayProject(JSON.parse(text), file.name)
      setOverlayProject(project)
      setJsonError('')
      setSrtStatus('')
      setTimelineTime(0)
      setVideoTime(0)
      setSelected(project.overlays[0]?.kind ?? selected)
      setSelectedOverlayId(project.overlays[0]?.id ?? null)
      setIsPlaying(true)

      if (videoRef.current) {
        videoRef.current.currentTime = 0
      }
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'JSON 导入失败')
    }
  }

  const importSrt = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      setAiProgress({
        current: 8,
        phase: '读取 SRT 字幕',
        total: 100,
      })
      const text = await file.text()
      setIsAiGenerating(true)
      setJsonError('')
      setAiProgress({
        current: isAiReady ? 28 : 42,
        phase: isAiReady ? '提交给大模型' : '本地规则分析字幕',
        total: 100,
      })
      setSrtStatus(isAiReady ? '正在调用大模型提炼字幕并生成动效 JSON...' : '未配置 API，正在使用本地规则兜底...')
      const project = isAiReady
        ? await requestAiOverlayProject(aiConfig, text, file.name)
        : generateOverlayProjectFromSrt(text, file.name)
      setAiProgress({
        current: 92,
        phase: '校验动效 JSON',
        total: 100,
      })
      setOverlayProject(project)
      setJsonError('')
      setSrtStatus(
        `${file.name} · ${isAiReady ? 'AI 已生成' : '本地规则已生成'} ${project.overlays.length} 个动效卡片 · ${formatDuration(
          project.duration,
        )}`,
      )
      setAiProgress({
        current: 100,
        phase: '动效生成完成',
        total: 100,
      })
      setTimelineTime(0)
      setVideoTime(0)
      setSelected(project.overlays[0]?.kind ?? selected)
      setSelectedOverlayId(project.overlays[0]?.id ?? null)
      setIsPlaying(true)

      if (videoRef.current) {
        videoRef.current.currentTime = 0
      }
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'SRT 导入失败')
      setSrtStatus('')
      setAiProgress({
        current: 100,
        phase: '生成失败',
        total: 100,
      })
    } finally {
      setIsAiGenerating(false)
    }
  }

  const removeVideo = () => {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current)
      videoUrlRef.current = null
    }
    setVideoAsset(null)
    setVideoTime(0)
  }

  const removeOverlayJson = () => {
    setOverlayProject(null)
    setJsonError('')
    setSrtStatus('')
    setAiProgress(null)
    setSelectedOverlayId(null)
    setTimelineTime(0)
  }

  useEffect(() => {
    return () => {
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(aiConfig))
  }, [aiConfig])

  useEffect(() => {
    if (!isAiGenerating) {
      return
    }

    const timer = window.setInterval(() => {
      setAiProgress((current) => {
        if (!current || current.current >= 88) {
          return current
        }

        const step = current.current < 48 ? 5 : current.current < 72 ? 3 : 1
        return {
          ...current,
          current: Math.min(88, current.current + step),
        }
      })
    }, 700)

    return () => window.clearInterval(timer)
  }, [isAiGenerating])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    if (isPlaying) {
      video.muted = false
      video.volume = 1
      void video.play().catch(() => undefined)
      return
    }

    video.pause()
  }, [isPlaying, videoAsset?.url])

  useEffect(() => {
    if (!overlayProject || videoAsset || !isPlaying || overlayProject.duration <= 0) {
      return
    }

    const timer = window.setInterval(() => {
      setTimelineTime((time) => {
        const nextTime = time + 1 / EXPORT_FPS
        return nextTime > overlayProject.duration ? 0 : nextTime
      })
    }, 1000 / EXPORT_FPS)

    return () => window.clearInterval(timer)
  }, [isPlaying, overlayProject, videoAsset])

  useEffect(() => {
    const scrollElement = timelineScrollRef.current

    if (!scrollElement || !projectDuration) {
      return
    }

    const progress = Math.min(1, Math.max(0, currentPlaybackTime / projectDuration))
    const targetLeft = progress * scrollElement.scrollWidth - scrollElement.clientWidth / 2
    const maxLeft = scrollElement.scrollWidth - scrollElement.clientWidth
    scrollElement.scrollLeft = Math.min(Math.max(0, targetLeft), Math.max(0, maxLeft))
  }, [currentPlaybackTime, projectDuration, timelineZoom])

  const updateVideoDuration = (duration: number) => {
    if (!Number.isFinite(duration)) {
      return
    }

    setVideoAsset((current) => (current ? { ...current, duration } : current))
  }

  const seekVideo = useCallback((value: number) => {
    const nextTime = Math.min(Math.max(0, value), projectDuration || value)

    if (!videoAsset) {
      setTimelineTime(nextTime)
      return
    }

    const video = videoRef.current
    if (!video) {
      return
    }

    video.currentTime = nextTime
    setVideoTime(nextTime)
  }, [projectDuration, videoAsset])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        setIsPlaying((playing) => !playing)
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seekVideo(currentPlaybackTime - 1)
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        seekVideo(currentPlaybackTime + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPlaybackTime, seekVideo])

  const seekFromTimeline = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!projectDuration || (event.target as HTMLElement).closest('button, input')) {
      return
    }

    const bounds = getTimelineLaneBounds(event.currentTarget)
    const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
    const rawTime = progress * projectDuration
    seekVideo(getSnappedTime(rawTime))
  }

  const startTimelineClipDrag = (event: React.PointerEvent<HTMLButtonElement>, item: OverlayItem) => {
    if (!projectDuration) {
      return
    }

    const content = event.currentTarget.closest<HTMLElement>('.timeline-content')
    const lane = event.currentTarget.closest<HTMLElement>('.track-lane')
    const trimHandle = (event.target as HTMLElement).closest<HTMLElement>('.clip-trim-handle')

    if (!content || !lane) {
      return
    }

    event.stopPropagation()
    setSelectedOverlayId(item.id)
    setSelected(item.kind)
    timelineDragRef.current = {
      contentWidth: lane.getBoundingClientRect().width,
      id: item.id,
      mode: trimHandle?.dataset.trim === 'start' ? 'trim-start' : trimHandle?.dataset.trim === 'end' ? 'trim-end' : 'move',
      moved: false,
      originEnd: item.endSeconds,
      originStart: item.startSeconds,
      pointerId: event.pointerId,
      startX: event.clientX,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDraggingTimeline(true)
  }

  const dragTimelineClip = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = timelineDragRef.current

    if (!dragState || dragState.pointerId !== event.pointerId || !projectDuration) {
      return
    }

    const deltaSeconds = ((event.clientX - dragState.startX) / dragState.contentWidth) * projectDuration
    const clipDuration = dragState.originEnd - dragState.originStart
    const minDuration = 0.5

    if (Math.abs(deltaSeconds) > 0.03) {
      dragState.moved = true
    }

    if (dragState.mode === 'trim-start') {
      const nextStart = Math.min(
        Math.max(0, getSnappedTime(dragState.originStart + deltaSeconds, dragState.id)),
        dragState.originEnd - minDuration,
      )

      updateOverlayItem(dragState.id, {
        start: formatSrtTimestamp(nextStart),
        startSeconds: nextStart,
      })
      seekVideo(nextStart)
      return
    }

    if (dragState.mode === 'trim-end') {
      const nextEnd = Math.max(
        dragState.originStart + minDuration,
        Math.min(projectDuration, getSnappedTime(dragState.originEnd + deltaSeconds, dragState.id)),
      )

      updateOverlayItem(dragState.id, {
        end: formatSrtTimestamp(nextEnd),
        endSeconds: nextEnd,
      })
      seekVideo(Math.min(currentPlaybackTime, nextEnd))
      return
    }

    const nextStart = Math.min(
      Math.max(0, getSnappedTime(dragState.originStart + deltaSeconds, dragState.id)),
      Math.max(0, projectDuration - clipDuration),
    )
    const nextEnd = nextStart + clipDuration

    updateOverlayItem(dragState.id, {
      end: formatSrtTimestamp(nextEnd),
      endSeconds: nextEnd,
      start: formatSrtTimestamp(nextStart),
      startSeconds: nextStart,
    })
    seekVideo(nextStart)
  }

  const stopTimelineClipDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (timelineDragRef.current?.pointerId === event.pointerId) {
      if (timelineDragRef.current.moved) {
        suppressTimelineClickRef.current = true
        window.setTimeout(() => {
          suppressTimelineClickRef.current = false
        }, 0)
      }
      timelineDragRef.current = null
      setIsDraggingTimeline(false)
    }
  }

  const startOverlayDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, button')) {
      return
    }

    if (overlayProject) {
      const target = event.target as HTMLElement
      const overlayElement = target.closest<HTMLElement>('.json-motion-wrapper, .overlay-selection-box')
      const item = overlayProject.overlays.find((overlay) => overlay.id === overlayElement?.dataset.overlayId)
      const stageRect = stageRef.current?.getBoundingClientRect()

      if (!item || !stageRect) {
        return
      }

      setSelectedOverlayId(item.id)
      setSelected(item.kind)
      dragStateRef.current = {
        id: item.id,
        mode: target.closest('.overlay-resize-handle') ? 'json-resize' : 'json',
        origin: { x: item.x, y: item.y },
        originScale: item.scale,
        pointerId: event.pointerId,
        scaleX: EXPORT_WIDTH / stageRect.width,
        scaleY: EXPORT_HEIGHT / stageRect.height,
        startX: event.clientX,
        startY: event.clientY,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsDraggingOverlay(true)
      return
    }

    dragStateRef.current = {
      key: selected,
      mode: 'manual',
      origin: overlayPositions[selected],
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDraggingOverlay(true)
  }

  const dragOverlay = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    if ((dragState.mode === 'json' || dragState.mode === 'json-resize') && dragState.id) {
      const deltaX = (event.clientX - dragState.startX) * (dragState.scaleX ?? 1)
      const deltaY = (event.clientY - dragState.startY) * (dragState.scaleY ?? 1)
      const item = overlayProject?.overlays.find((overlay) => overlay.id === dragState.id)
      const width = item ? item.w * item.scale : 420

      if (dragState.mode === 'json-resize' && item) {
        const nextScale = Math.min(2.4, Math.max(0.35, (dragState.originScale ?? item.scale) + deltaX / item.w))
        const placement = dragState.origin.x >= EXPORT_WIDTH / 2 ? 'right' : 'left'
        updateOverlayItem(dragState.id, {
          scale: Number(nextScale.toFixed(2)),
          x: Math.round(getCenteredSideX(placement, item.w, nextScale)),
        })
        return
      }

      updateOverlayItem(dragState.id, {
        x: Math.round(clampSideX(dragState.origin.x + deltaX, width)),
        y: Math.round(Math.min(Math.max(0, dragState.origin.y + deltaY), EXPORT_HEIGHT - 80)),
      })
      return
    }

    if (dragState.key) {
      setOverlayPositions((current) => ({
        ...current,
        [dragState.key as MotionKey]: {
          x: dragState.origin.x + event.clientX - dragState.startX,
          y: dragState.origin.y + event.clientY - dragState.startY,
        },
      }))
    }
  }

  const stopOverlayDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null
      setIsDraggingOverlay(false)
    }
  }

  const renderTransparentExportFrame = (
    context: CanvasRenderingContext2D,
    currentTime: number,
    overlayDuration: number,
    exportOffset: OverlayPosition,
  ) => {
    if (overlayProject) {
      setupExportContext(context)
      overlayProject.overlays
        .filter((item) => currentTime >= item.startSeconds && currentTime <= item.endSeconds)
        .forEach((item) => {
          const placement = getOverlayPlacement(item)
          const anchor = getOverlayAnchor(item)
          context.save()
          context.translate(item.x - anchor.x, item.y - anchor.y)
          context.scale(item.scale, item.scale)
          drawOverlayFrame(
            context,
            item.kind,
            currentTime - item.startSeconds,
            item.endSeconds - item.startSeconds,
            { x: 0, y: 0 },
            {
              ...item.text,
              __boxWidth: item.w,
              __fontScale: item.fontSize / getDefaultFontSize(item.kind),
              __placement: placement,
            },
            false,
          )
          context.restore()
        })
      return
    }

    drawOverlayFrame(context, selected, currentTime, overlayDuration, exportOffset)
  }

  const exportTransparentOverlay = async () => {
    if (exportState && exportState.current < exportState.total) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = EXPORT_WIDTH
    canvas.height = EXPORT_HEIGHT
    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    const overlayDuration = parseDurationSeconds(activePreset.duration)
    const exportDuration =
      overlayProject?.duration ||
      (videoAsset?.duration && Number.isFinite(videoAsset.duration) ? videoAsset.duration : overlayDuration)
    const totalFrames = Math.max(1, Math.round(exportDuration * EXPORT_FPS))
    const totalExportSteps = totalFrames + 1
    const exportName = overlayProject ? 'json_overlay' : selected
    const exportId = `${exportName}_${new Date().toISOString().replace(/[:.]/g, '-').replace(/[^0-9TZ-]/g, '')}`
    const exportDirectory = `${EXPORT_ROOT_LABEL}/${exportId}`
    const stageRect = stageRef.current?.getBoundingClientRect()
    const exportOffset = stageRect
      ? {
          x: overlayPositions[selected].x * (EXPORT_WIDTH / stageRect.width),
          y: overlayPositions[selected].y * (EXPORT_HEIGHT / stageRect.height),
        }
      : overlayPositions[selected]

    setExportState({
      current: 0,
      format: 'video',
      phase: '正在渲染透明视频帧',
      total: totalExportSteps,
    })

    try {
      for (let index = 0; index < totalFrames; index += 1) {
        const currentTime = index / EXPORT_FPS
        const frameName = `frame_${String(index + 1).padStart(6, '0')}.png`

        renderTransparentExportFrame(context, currentTime, overlayDuration, exportOffset)
        await saveExportFrame(exportId, frameName, canvas.toDataURL('image/png'))
        setExportState({
          current: index + 1,
          directory: exportDirectory,
          format: 'video',
          phase: '正在渲染透明视频帧',
          total: totalExportSteps,
        })
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }

      setExportState({
        current: totalFrames,
        directory: exportDirectory,
        format: 'video',
        phase: '正在编码透明 MOV',
        total: totalExportSteps,
      })
      const encoded = await encodeTransparentVideo(exportId)
      setExportState({
        current: totalExportSteps,
        directory: encoded.directory,
        file: encoded.file,
        format: 'video',
        phase: `透明视频已生成 · ${encoded.codec}`,
        total: totalExportSteps,
      })
    } catch (error) {
      console.error(error)
      setExportState({
        current: 0,
        format: 'video',
        phase: error instanceof Error ? error.message : '导出失败',
        total: totalExportSteps,
      })
    }
  }

  return (
    <main className="app-shell">
      <aside className="panel left-panel" aria-label="动效组件列表">
        <div className="panel-header">
          <p className="kicker">Motion Playground</p>
          <h1>Overlay Studio</h1>
        </div>

        <nav className="preset-list" aria-label="选择动效组件">
          {presets.map((preset, index) => {
            const Icon = componentIcon[preset.id]
            return (
              <button
                className={`preset-button ${selected === preset.id ? 'is-active' : ''}`}
                key={preset.id}
                onClick={() => setSelected(preset.id)}
                type="button"
              >
                <span className="preset-index">{String(index + 1).padStart(2, '0')}</span>
                <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                <span>
                  <strong>{preset.title}</strong>
                  <small>{preset.eyebrow}</small>
                </span>
              </button>
            )
          })}
        </nav>

        <div className="component-notes">
          <span>阶段 01</span>
          <p>支持视频导入、SRT 自动生成、JSON 时间轴、卡片编辑与透明 MOV 动效层导出。</p>
        </div>
      </aside>

      <section className="preview-column" aria-label="1920x1080 动效预览画布">
        <header className="topbar">
          <div>
            <p className="kicker">1920 x 1080 Canvas</p>
            <h2>{activePreset.title}</h2>
          </div>
          <div className="toolbar" aria-label="播放控制">
            <input
              accept="video/*"
              className="file-input"
              onChange={importVideo}
              ref={fileInputRef}
              type="file"
            />
            <input
              accept="application/json,.json"
              className="file-input"
              onChange={importOverlayJson}
              ref={jsonInputRef}
              type="file"
            />
            <input
              accept=".srt,text/plain"
              className="file-input"
              onChange={importSrt}
              ref={srtInputRef}
              type="file"
            />
            <button className="import-button" onClick={openVideoPicker} type="button">
              <Upload size={17} aria-hidden="true" />
              导入视频
            </button>
            <button className="import-button" disabled={isAiGenerating} onClick={openSrtPicker} type="button">
              <Upload size={17} aria-hidden="true" />
              {isAiGenerating ? 'AI 生成中' : '导入 SRT'}
            </button>
            <button className="import-button" onClick={openJsonPicker} type="button">
              <Upload size={17} aria-hidden="true" />
              导入 JSON
            </button>
            {overlayProject && (
              <button aria-label="移除已导入 JSON" className="icon-button" onClick={removeOverlayJson} type="button">
                <X size={18} />
              </button>
            )}
            {videoAsset && (
              <button aria-label="移除已导入视频" className="icon-button" onClick={removeVideo} type="button">
                <X size={18} />
              </button>
            )}
            <button
              aria-label={isPlaying ? '暂停动效' : '播放动效'}
              className="icon-button"
              onClick={() => setIsPlaying((playing) => !playing)}
              type="button"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button aria-label="重新播放动效" className="icon-button" onClick={replay} type="button">
              <RotateCcw size={18} />
            </button>
            <button
              className="import-button"
              disabled={Boolean(exportState && exportState.current < exportState.total)}
              onClick={() => void exportTransparentOverlay()}
              type="button"
            >
              <Film size={17} aria-hidden="true" />
              {exportState && exportState.current < exportState.total ? '导出中' : '导出透明视频'}
            </button>
          </div>
        </header>

        <div className="canvas-frame">
          <div
            className={`stage stage-${selected} ${videoAsset ? 'has-video' : ''}`}
            key={replayKey}
            ref={stageRef}
            style={stageStyle as React.CSSProperties}
          >
            {videoAsset && (
              <div className="video-layer" aria-label="导入视频预览区">
                <video
                  autoPlay={isPlaying}
                  className="video-preview"
                  key={videoAsset.url}
                  loop
                  onLoadedMetadata={(event) => {
                    event.currentTarget.muted = false
                    event.currentTarget.volume = 1
                    updateVideoDuration(event.currentTarget.duration)
                  }}
                  onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
                  playsInline
                  ref={videoRef}
                  src={videoAsset.url}
                />
              </div>
            )}
            <div className="stage-grid" aria-hidden="true" />
            <div className="side-fx side-fx-left" aria-hidden="true">
              <span>文字 / 特效区</span>
            </div>
            <div className="side-fx side-fx-right" aria-hidden="true">
              <span>文字 / 特效区</span>
            </div>
            <div className="safe-zone" aria-hidden="true" />
            <div className="stage-meta stage-meta-left">
              <span>{activePreset.eyebrow}</span>
            </div>
            <div className="stage-meta stage-meta-right">
              <span>{activePreset.duration}</span>
            </div>
            <div
              className={`motion-drag-layer ${isDraggingOverlay ? 'is-dragging' : ''}`}
              onPointerCancel={stopOverlayDrag}
              onPointerDown={startOverlayDrag}
              onPointerMove={dragOverlay}
              onPointerUp={stopOverlayDrag}
              style={overlayStyle as React.CSSProperties}
            >
              {overlayProject ? (
                <>
                  {activeOverlayItems.map((item) => (
                    <JsonOverlayRenderer
                      isSelected={selectedOverlayId === item.id}
                      item={item}
                      key={`${item.id}-${replayKey}`}
                    />
                  ))}
                  {selectedOverlay && selectedOverlayIsVisible && (
                    <div
                      className="overlay-selection-box"
                      data-overlay-id={selectedOverlay.id}
                      style={
                        {
                          height: `${(getOverlayBoxHeight(selectedOverlay.kind) * selectedOverlay.scale / EXPORT_HEIGHT) * 100}%`,
                          left: `${(selectedOverlay.x / EXPORT_WIDTH) * 100}%`,
                          top: `${(selectedOverlay.y / EXPORT_HEIGHT) * 100}%`,
                          width: `${(selectedOverlay.w * selectedOverlay.scale / EXPORT_WIDTH) * 100}%`,
                        } as React.CSSProperties
                      }
                    >
                      <div className="overlay-selection-bar">
                        <span>{selectedOverlay.kind}</span>
                        <label>
                          时长
                          <input
                            aria-label="选中特效显示时长"
                            max={Math.max(0.5, projectDuration - selectedOverlay.startSeconds)}
                            min={0.5}
                            onChange={(event) => updateOverlayDuration(selectedOverlay.id, Number(event.target.value))}
                            onPointerDown={(event) => event.stopPropagation()}
                            step={0.1}
                            type="range"
                            value={Number((selectedOverlay.endSeconds - selectedOverlay.startSeconds).toFixed(2))}
                          />
                          <b>{(selectedOverlay.endSeconds - selectedOverlay.startSeconds).toFixed(1)}s</b>
                        </label>
                      </div>
                      <span className="overlay-resize-handle" aria-hidden="true" />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {selected === 'metric' && <MetricFocus />}
                  {selected === 'compare' && <CompareSplit />}
                  {selected === 'quote' && <QuoteLockup />}
                  {selected === 'flow' && <FlowSteps />}
                  {selected === 'bars' && <BarInsight />}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="viewer-controls" aria-label="视频播放控制">
          <div className="viewer-timecodes">
            <strong>{formatTimecode(currentPlaybackTime)}</strong>
            <span>{formatTimecode(projectDuration)}</span>
          </div>
          <div className="transport-controls">
            <button
              aria-label="后退 1 秒"
              className="transport-button"
              disabled={!projectDuration}
              onClick={() => stepPlayback(-1)}
              type="button"
            >
              <SkipBack size={17} />
            </button>
            <button
              aria-label={isPlaying ? '暂停播放' : '开始播放'}
              className="transport-button is-primary"
              onClick={() => setIsPlaying((playing) => !playing)}
              type="button"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              aria-label="前进 1 秒"
              className="transport-button"
              disabled={!projectDuration}
              onClick={() => stepPlayback(1)}
              type="button"
            >
              <SkipForward size={17} />
            </button>
          </div>
          <div className="viewer-actions">
            <span>原画</span>
            <span>16:9</span>
          </div>
          <input
            aria-label="视频播放进度"
            className="viewer-scrubber"
            disabled={!projectDuration}
            max={projectDuration || 1}
            min={0}
            onChange={(event) => seekVideo(Number(event.target.value))}
            step={0.01}
            type="range"
            value={Math.min(currentPlaybackTime, projectDuration || 0)}
          />
        </div>

        <section className="timeline-panel" aria-label="视频与动效轨道">
          <div className="timeline-toolbar">
            <div className="timeline-tool-group" aria-label="时间轴工具">
              <button className="timeline-tool add-effect-tool" onClick={addOverlayEffect} type="button">
                <Plus size={15} aria-hidden="true" />
                添加 {activePreset.title}
              </button>
              <button className="timeline-tool is-active" type="button">
                <MousePointer2 size={15} aria-hidden="true" />
                选择
              </button>
              <button
                className={`timeline-tool ${isSnapEnabled ? 'is-active' : ''}`}
                onClick={() => setIsSnapEnabled((enabled) => !enabled)}
                type="button"
              >
                <Magnet size={15} aria-hidden="true" />
                吸附
              </button>
            </div>
            <div className="timeline-summary">
              <span>播放头 {formatTimecode(currentPlaybackTime)}</span>
              <span>项目 {formatDuration(projectDuration)}</span>
            </div>
            <div className="timeline-zoom" aria-label="时间轴缩放">
              <button
                aria-label="缩小时间轴"
                className="timeline-tool icon-only"
                onClick={() => setTimelineZoom((zoom) => clampTimelineZoom(zoom - TIMELINE_ZOOM_STEP))}
                type="button"
              >
                <ZoomOut size={15} />
              </button>
              <input
                aria-label="时间轴缩放"
                max={TIMELINE_MAX_ZOOM}
                min={TIMELINE_MIN_ZOOM}
                onChange={(event) => updateTimelineZoom(Number(event.currentTarget.value))}
                onInput={(event) => updateTimelineZoom(Number(event.currentTarget.value))}
                step={0.05}
                type="range"
                value={timelineZoom}
              />
              <span className="timeline-zoom-value" aria-label={`时间轴缩放 ${timelineZoomPercent}%`}>
                {timelineZoomPercent}%
              </span>
              <button
                aria-label="放大时间轴"
                className="timeline-tool icon-only"
                onClick={() => setTimelineZoom((zoom) => clampTimelineZoom(zoom + TIMELINE_ZOOM_STEP))}
                type="button"
              >
                <ZoomIn size={15} />
              </button>
            </div>
          </div>

          <div className="timeline-scroll" aria-label="可滚动时间轴" ref={timelineScrollRef}>
            <div className="timeline-content" onClick={seekFromTimeline} style={timelineContentStyle}>
              <div className="timeline-ruler">
                {timelineTicks.map((tick) => (
                  <span
                    className="timeline-tick"
                    key={tick.toFixed(3)}
                    style={{ left: `${getTrackPercent(tick)}%` }}
                  >
                    {formatDuration(tick)}
                  </span>
                ))}
                <i className="timeline-playhead" style={{ left: `${getTrackPercent(currentPlaybackTime)}%` }} />
              </div>

              <div className="timeline-row">
                <span className="track-label">
                  <b>V1</b>
                  视频轨道
                </span>
                <div className="track-lane video-lane">
                  {videoAsset ? (
                    <button className="video-clip" onClick={() => seekVideo(0)} type="button">
                      <span className="clip-filmstrip" aria-hidden="true" />
                      <strong>{videoAsset.name}</strong>
                      <small>{formatDuration(videoAsset.duration)}</small>
                    </button>
                  ) : (
                    <span className="track-empty">导入视频后显示素材片段</span>
                  )}
                </div>
              </div>

              <div className="timeline-row">
                <span className="track-label">
                  <b>FX</b>
                  动效轨道
                </span>
                <div className={`track-lane effect-lane ${isDraggingTimeline ? 'is-dragging' : ''}`}>
                  {overlayProject?.overlays.length ? (
                    overlayProject.overlays.map((item) => (
                      <button
                        className={`effect-clip ${selectedOverlayId === item.id ? 'is-selected' : ''}`}
                        key={item.id}
                        onClick={() => {
                          if (suppressTimelineClickRef.current) {
                            return
                          }
                          selectOverlay(item)
                        }}
                        onPointerCancel={stopTimelineClipDrag}
                        onPointerDown={(event) => startTimelineClipDrag(event, item)}
                        onPointerMove={dragTimelineClip}
                        onPointerUp={stopTimelineClipDrag}
                        style={{
                          left: `${getTrackPercent(item.startSeconds)}%`,
                          width: `${Math.max(1.8, getTrackPercent(item.endSeconds) - getTrackPercent(item.startSeconds))}%`,
                        }}
                        title={`${item.id} · ${item.kind}`}
                        type="button"
                      >
                        <span className="clip-trim-handle trim-start" data-trim="start" aria-hidden="true" />
                        <span className="clip-kind">{item.kind}</span>
                        <strong>{getOverlayLabel(item)}</strong>
                        <small>
                          {formatDuration(item.startSeconds)} - {formatDuration(item.endSeconds)}
                        </small>
                        <span className="clip-trim-handle trim-end" data-trim="end" aria-hidden="true" />
                      </button>
                    ))
                  ) : (
                    <span className="track-empty">导入 SRT 或 JSON 后显示动效片段</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </section>

      <aside className="panel right-panel" aria-label="参数调整">
        <div className="panel-header compact">
          <SlidersHorizontal size={18} strokeWidth={1.6} aria-hidden="true" />
          <div>
            <p className="kicker">Controls</p>
            <h2>参数调整</h2>
          </div>
        </div>

        <div className="control-stack">
          <RangeControl
            label="动效强度"
            max={100}
            min={0}
            value={controls.intensity}
            onChange={(value) => updateControl('intensity', value)}
          />
          <RangeControl
            label="画面对比"
            max={100}
            min={20}
            value={controls.contrast}
            onChange={(value) => updateControl('contrast', value)}
          />
          <RangeControl
            label="节奏速度"
            max={100}
            min={20}
            value={controls.pace}
            onChange={(value) => updateControl('pace', value)}
          />
          <RangeControl
            label="线条重量"
            max={100}
            min={0}
            value={controls.lineWeight}
            onChange={(value) => updateControl('lineWeight', value)}
          />
        </div>

        <button className="reset-button" onClick={() => setControls(defaultControls)} type="button">
          <AlignHorizontalJustifyCenter size={17} aria-hidden="true" />
          恢复默认参数
        </button>

        <section className="ai-config-panel" aria-label="AI 生成配置">
          <div className="ai-config-heading">
            <span>AI 生成</span>
            <strong className={isAiReady ? 'is-ready' : ''}>{isAiReady ? '已启用' : '本地兜底'}</strong>
          </div>
          <label className="ai-field">
            <span>API Base URL</span>
            <input
              autoComplete="off"
              onChange={(event) => updateAiConfig('baseUrl', event.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              type="text"
              value={aiConfig.baseUrl}
            />
          </label>
          <label className="ai-field">
            <span>模型名</span>
            <input
              autoComplete="off"
              onChange={(event) => updateAiConfig('model', event.target.value)}
              placeholder="填写你的模型名称"
              spellCheck={false}
              type="text"
              value={aiConfig.model}
            />
          </label>
          <label className="ai-field">
            <span>API Key</span>
            <input
              autoComplete="off"
              onChange={(event) => updateAiConfig('apiKey', event.target.value)}
              placeholder="sk-..."
              spellCheck={false}
              type="password"
              value={aiConfig.apiKey}
            />
          </label>
          <p>{isAiReady ? 'SRT 导入将调用大模型生成 JSON。' : '未填完整时使用本地规则生成。'}</p>
        </section>

        {exportState && (
          <div className="export-status" aria-live="polite">
            <span>
              透明视频 {getProgressPercent(exportState.current, exportState.total)}%
            </span>
            {exportState.phase && <ProgressMeter current={exportState.current} phase={exportState.phase} total={exportState.total} />}
            {exportState.current >= exportState.total && exportState.file && <p>视频文件 {exportState.file}</p>}
            {exportState.current >= exportState.total && exportState.directory && (
              <p>素材目录 {exportState.directory}</p>
            )}
          </div>
        )}

        {(overlayProject || jsonError || srtStatus || aiProgress) && (
          <div className={`json-status ${jsonError ? 'is-error' : ''}`} aria-live="polite">
            <span>
              {jsonError ? '导入失败' : isAiGenerating ? 'AI 生成中' : srtStatus ? 'SRT 动效已生成' : 'JSON 时间轴已导入'}
            </span>
            <p>
              {jsonError ||
                srtStatus ||
                `${overlayProject?.name ?? ''} · ${overlayProject?.overlays.length ?? 0} 个卡片 · ${formatDuration(
                  overlayProject?.duration ?? 0,
                )}`}
            </p>
            {aiProgress && <ProgressMeter current={aiProgress.current} phase={aiProgress.phase} total={aiProgress.total} />}
          </div>
        )}

        {selectedOverlay && (
          <OverlayEditor
            item={selectedOverlay}
            onChange={(patch) => updateOverlayItem(selectedOverlay.id, patch)}
            onTextChange={(patch) => updateOverlayText(selectedOverlay.id, patch)}
          />
        )}

        <dl className="spec-list">
          <div>
            <dt>画布比例</dt>
            <dd>16:9</dd>
          </div>
          <div>
            <dt>输出阶段</dt>
            <dd>Preview only</dd>
          </div>
          <div>
            <dt>导入素材</dt>
            <dd>{videoAsset ? videoAsset.name : '未导入'}</dd>
          </div>
          <div>
            <dt>动效项目</dt>
            <dd>{overlayProject ? overlayProject.name : '未导入'}</dd>
          </div>
          {overlayProject && (
            <div>
              <dt>当前卡片</dt>
              <dd>{activeOverlayItems.length ? activeOverlayItems.map((item) => item.id).join(' / ') : '无'}</dd>
            </div>
          )}
          {videoAsset && (
            <>
              <div>
                <dt>素材时长</dt>
                <dd>{formatDuration(videoAsset.duration)}</dd>
              </div>
              <div>
                <dt>素材大小</dt>
                <dd>{formatFileSize(videoAsset.size)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>色彩策略</dt>
            <dd>黑白灰 + 单点冷白</dd>
          </div>
          <div>
            <dt>空安全区</dt>
            <dd>中心 44%</dd>
          </div>
          <div>
            <dt>文字/特效区</dt>
            <dd>左右各 28%</dd>
          </div>
        </dl>
      </aside>
    </main>
  )
}

function formatDuration(duration: number | null) {
  if (duration === null) {
    return '读取中'
  }

  const safeDuration = Math.max(0, duration)
  const minutes = Math.floor(safeDuration / 60)
  const seconds = Math.floor(safeDuration % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatTimecode(duration: number | null) {
  if (duration === null) {
    return '00:00:00:00'
  }

  const safeDuration = Math.max(0, duration)
  const hours = Math.floor(safeDuration / 3600)
  const minutes = Math.floor((safeDuration % 3600) / 60)
  const seconds = Math.floor(safeDuration % 60)
  const frames = Math.floor((safeDuration % 1) * EXPORT_FPS)

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )}:${String(frames).padStart(2, '0')}`
}

function formatSrtTimestamp(duration: number) {
  const totalMilliseconds = Math.max(0, Math.round(duration * 1000))
  const hours = Math.floor(totalMilliseconds / 3600000)
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000)
  const seconds = Math.floor((totalMilliseconds % 60000) / 1000)
  const milliseconds = totalMilliseconds % 1000

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )},${String(milliseconds).padStart(3, '0')}`
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function ProgressMeter({ current, phase, total }: ProgressState) {
  const percent = getProgressPercent(current, total)

  return (
    <div
      aria-label={phase}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="progress-meter"
      role="progressbar"
    >
      <span className="progress-meter-label">
        <b>{phase}</b>
        <em>{percent}%</em>
      </span>
      <span className="progress-meter-track" aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </span>
    </div>
  )
}

function RangeControl({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}) {
  return (
    <label className="range-control">
      <span>
        {label}
        <b>{value}</b>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        type="range"
        value={value}
      />
    </label>
  )
}

function EditorRange({
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  step?: number
  value: number
}) {
  return (
    <label className="editor-range">
      <span>
        {label}
        <b>{step < 1 ? value.toFixed(2) : Math.round(value)}</b>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  )
}

function TextInput({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="text-field">
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} type="text" value={value} />
    </label>
  )
}

function OverlayEditor({
  item,
  onChange,
  onTextChange,
}: {
  item: OverlayItem
  onChange: (patch: Partial<OverlayItem>) => void
  onTextChange: (patch: OverlayText) => void
}) {
  const scaledWidth = item.w * item.scale
  const isLeft = item.x < EXPORT_WIDTH / 2
  const minX = isLeft ? 0 : RIGHT_EFFECT_MIN_X
  const maxX = isLeft
    ? Math.max(0, SIDE_EFFECT_WIDTH - scaledWidth)
    : Math.max(RIGHT_EFFECT_MIN_X, EXPORT_WIDTH - scaledWidth)
  const updateX = (value: number) => onChange({ x: Math.round(clampSideX(value, scaledWidth)) })

  return (
    <section className="overlay-editor" aria-label="选中动效编辑">
      <div className="editor-heading">
        <span>{item.id}</span>
        <strong>{item.kind}</strong>
      </div>

      <div className="editor-grid">
        <EditorRange label="位置 X" max={maxX} min={minX} onChange={updateX} value={Math.min(maxX, Math.max(minX, item.x))} />
        <EditorRange
          label="位置 Y"
          max={1000}
          min={0}
          onChange={(value) => onChange({ y: Math.round(value) })}
          value={item.y}
        />
        <EditorRange
          label="整体大小"
          max={2}
          min={0.4}
          onChange={(value) =>
            onChange({
              scale: value,
              x: Math.round(getCenteredSideX(isLeft ? 'left' : 'right', item.w, value)),
            })
          }
          step={0.01}
          value={item.scale}
        />
        <EditorRange
          label="文字大小"
          max={180}
          min={12}
          onChange={(value) => onChange({ fontSize: Math.round(value) })}
          value={item.fontSize}
        />
      </div>

      <div className="text-editor">
        <span className="editor-subtitle">文字内容</span>
        <OverlayTextEditor item={item} onTextChange={onTextChange} />
      </div>
    </section>
  )
}

function OverlayTextEditor({
  item,
  onTextChange,
}: {
  item: OverlayItem
  onTextChange: (patch: OverlayText) => void
}) {
  if (item.kind === 'metric') {
    return (
      <>
        <TextInput label="数值" onChange={(value) => onTextChange({ value })} value={readText(item.text.value, '')} />
        <TextInput label="单位" onChange={(unit) => onTextChange({ unit })} value={readText(item.text.unit, '')} />
        <TextInput label="标签" onChange={(label) => onTextChange({ label })} value={readText(item.text.label, '')} />
      </>
    )
  }

  if (item.kind === 'compare') {
    return (
      <>
        <TextInput label="左标签" onChange={(leftLabel) => onTextChange({ leftLabel })} value={readText(item.text.leftLabel, '')} />
        <TextInput label="左数值" onChange={(leftValue) => onTextChange({ leftValue })} value={readText(item.text.leftValue, '')} />
        <TextInput label="左说明" onChange={(leftCaption) => onTextChange({ leftCaption })} value={readText(item.text.leftCaption, '')} />
        <TextInput label="右标签" onChange={(rightLabel) => onTextChange({ rightLabel })} value={readText(item.text.rightLabel, '')} />
        <TextInput label="右数值" onChange={(rightValue) => onTextChange({ rightValue })} value={readText(item.text.rightValue, '')} />
        <TextInput label="右说明" onChange={(rightCaption) => onTextChange({ rightCaption })} value={readText(item.text.rightCaption, '')} />
      </>
    )
  }

  if (item.kind === 'quote') {
    return (
      <>
        <TextInput label="上方小标题" onChange={(eyebrow) => onTextChange({ eyebrow })} value={readText(item.text.eyebrow, 'INSIGHT')} />
        <TextInput label="第一行" onChange={(line1) => onTextChange({ line1 })} value={readText(item.text.line1, '')} />
        <TextInput label="第二行" onChange={(line2) => onTextChange({ line2 })} value={readText(item.text.line2, '')} />
      </>
    )
  }

  if (item.kind === 'flow') {
    const steps = Array.isArray(item.text.steps) ? item.text.steps.filter((step): step is string => typeof step === 'string') : []

    return (
      <>
        <label className="text-field">
          <span>步骤文本</span>
          <textarea
            onChange={(event) =>
              onTextChange({
                steps: event.target.value
                  .split('\n')
                  .map((step) => step.trim())
                  .filter(Boolean)
                  .slice(0, 5),
              })
            }
            rows={4}
            value={steps.join('\n')}
          />
        </label>
        <EditorRange
          label="当前步骤"
          max={Math.max(1, steps.length)}
          min={1}
          onChange={(activeStep) => onTextChange({ activeStep: Math.round(activeStep) })}
          value={readNumber(item.text.activeStep, 1)}
        />
      </>
    )
  }

  const firstItem = Array.isArray(item.text.items) && item.text.items[0] && typeof item.text.items[0] === 'object' ? item.text.items[0] as Record<string, unknown> : {}

  return (
    <TextInput
      label="柱形图数值"
      onChange={(value) => onTextChange({ items: [{ ...firstItem, value }] })}
      value={readText(firstItem.value, '')}
    />
  )
}

function JsonOverlayRenderer({ isSelected, item }: { isSelected: boolean; item: OverlayItem }) {
  const placement = getOverlayPlacement(item)

  return (
    <div
      className={`json-motion-wrapper is-${placement} ${isSelected ? 'is-selected' : ''}`}
      data-overlay-id={item.id}
      style={getJsonOverlayStyle(item)}
    >
      {item.kind === 'metric' && <MetricFocus placement={placement} text={item.text} />}
      {item.kind === 'compare' && <CompareSplit text={item.text} />}
      {item.kind === 'quote' && <QuoteLockup placement={placement} text={item.text} />}
      {item.kind === 'flow' && <FlowSteps placement={placement} text={item.text} />}
      {item.kind === 'bars' && <BarInsight placement={placement} text={item.text} />}
    </div>
  )
}

function MetricFocus({
  placement = 'left',
  text = {},
}: {
  placement?: 'left' | 'right'
  text?: OverlayText
}) {
  const value = readText(text.value, '73')
  const unit = readText(text.unit, '%')

  return (
    <section className={`motion metric-focus is-${placement}`} aria-label="MetricFocus 核心数字动效">
      <div className="metric-card">
        <div className="metric-track">
          <i />
        </div>
        <div className="metric-number">
          <span>{value}</span>
          {unit && <sup>{unit}</sup>}
        </div>
      </div>
    </section>
  )
}

function CompareSplit({ text = {} }: { text?: OverlayText }) {
  return (
    <section className="motion compare-split" aria-label="CompareSplit 左右对比卡">
      <div className="split-card left">
        <span>{readText(text.leftLabel, 'Before')}</span>
        <strong>{readText(text.leftValue, '03:42')}</strong>
        <small>{readText(text.leftCaption, '剪辑定位耗时')}</small>
      </div>
      <div className="split-axis" />
      <div className="split-card right">
        <span>{readText(text.rightLabel, 'After')}</span>
        <strong>{readText(text.rightValue, '00:58')}</strong>
        <small>{readText(text.rightCaption, '同样片段复盘')}</small>
      </div>
      <p>对比不靠颜色取胜，而靠空间分割、时间数字和中线锁定。</p>
    </section>
  )
}

function renderHighlightedText(line: string, blue: string[], green: string[]) {
  const highlights = [...blue.map((word) => ({ color: 'blue', word })), ...green.map((word) => ({ color: 'green', word }))]
    .filter((item) => item.word)
    .sort((a, b) => b.word.length - a.word.length)

  if (!highlights.length) {
    return line
  }

  const parts: React.ReactNode[] = []
  let cursor = 0

  while (cursor < line.length) {
    const hit = highlights.find((item) => line.startsWith(item.word, cursor))

    if (!hit) {
      parts.push(line[cursor])
      cursor += 1
      continue
    }

    const key = `${hit.word}-${cursor}`
    parts.push(
      hit.color === 'blue' ? <mark key={key}>{hit.word}</mark> : <em key={key}>{hit.word}</em>,
    )
    cursor += hit.word.length
  }

  return parts
}

function QuoteLockup({
  placement = 'left',
  text = {},
}: {
  placement?: 'left' | 'right'
  text?: OverlayText
}) {
  const blue = readStringArray(text.blue)
  const green = readStringArray(text.green)
  const line1 = readText(text.line1, '只要有流量')
  const line2 = readText(text.line2, '变现不愁')

  return (
    <section className={`motion quote-lockup is-${placement}`} aria-label="QuoteLockup 金句定格卡">
      <div className="quote-frame">
        <h3>{readText(text.eyebrow, 'INSIGHT')}</h3>
        <p>
          <strong>{renderHighlightedText(line1, blue, green)}</strong>
          {line2 && <strong>{renderHighlightedText(line2, blue, green)}</strong>}
        </p>
      </div>
      <div className="quote-note">
        <span>QuoteLockup</span>
        <strong>信息金句定格</strong>
        <p>大标题先锁定，关键词用蓝色强调，正文保持高对比留白。</p>
      </div>
    </section>
  )
}

const flowSteps = [
  { icon: ClipboardCheck, label: '1 Review', state: 'done' },
  { icon: Truck, label: '2 Ship', state: 'done' },
  { icon: CreditCard, label: '3 Pay', state: 'active' },
  { icon: FileCheck2, label: '4 Bill', state: 'idle' },
  { icon: BadgeCheck, label: '5 Done', state: 'idle' },
] as const

function FlowSteps({
  placement = 'left',
  text = {},
}: {
  placement?: 'left' | 'right'
  text?: OverlayText
}) {
  const customSteps = Array.isArray(text.steps)
    ? text.steps.filter((step): step is string => typeof step === 'string').slice(0, 5)
    : []
  const activeStep = Math.max(1, Math.min(customSteps.length || 3, readNumber(text.activeStep, 3)))
  const steps = customSteps.length
    ? customSteps.map((label, index) => ({
        icon: flowSteps[index % flowSteps.length].icon,
        label: `${index + 1} ${label}`,
        state: index + 1 < activeStep ? 'done' : index + 1 === activeStep ? 'active' : 'idle',
      }))
    : flowSteps

  return (
    <section className={`motion flow-steps is-${placement}`} aria-label="FlowSteps 透明流程图卡片">
      <div className="flow-card">
        {steps.map((step) => {
          const StepIcon = step.icon
          return (
            <div className={`flow-step is-${step.state}`} key={step.label}>
              <span className="flow-node">
                {step.state === 'done' ? <Check size={18} /> : step.label.slice(0, 1)}
              </span>
              <div className="flow-pill">
                <StepIcon size={15} strokeWidth={1.8} aria-hidden="true" />
                <strong>{step.label}</strong>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flow-note">
        <span>FlowSteps</span>
        <strong>透明流程节点</strong>
        <p>当前步骤用冷蓝线框锁定，背景保持透明，适合叠在视频或暗色画面上。</p>
      </div>
    </section>
  )
}

const barData = [
  {
    height: '86%',
    value: '40%',
  },
] as const

function BarInsight({
  placement = 'left',
  text = {},
}: {
  placement?: 'left' | 'right'
  text?: OverlayText
}) {
  const items = Array.isArray(text.items)
    ? text.items
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .slice(0, 1)
        .map((item) => ({ height: '86%', value: extractNumericDisplayValue(item.value, '40%') }))
    : barData

  return (
    <section className={`motion bar-insight is-${placement}`} aria-label="BarInsight 柱形图模块">
      <div className="bar-card">
        {items.map((item) => (
          <div className="bar-item" key={item.value}>
            <div className="bar-label">
              <strong>{item.value}</strong>
            </div>
            <div className="bar-shell">
              <i style={{ '--bar-height': item.height } as React.CSSProperties} />
            </div>
          </div>
        ))}
      </div>

      <div className="bar-note">
        <span>BarInsight</span>
        <strong>双柱数据强调</strong>
        <p>透明底叠加蓝青柔光，百分比先出现，柱体随后从底部抬升。</p>
      </div>
    </section>
  )
}

export default App
