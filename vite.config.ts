import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exportRoot = path.join(os.homedir(), 'Desktop', '剪辑素材')
const execFileAsync = promisify(execFile)

function readRequestBody(request: import('node:http').IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

async function encodeTransparentMov(exportDir: string, exportId: string, fps: number) {
  const outputFile = `${exportId}.mov`
  const outputPath = path.join(exportDir, outputFile)
  const frameInput = 'frame_%06d.png'
  const safeFps = Number.isFinite(fps) && fps > 0 ? String(fps) : '30'

  const proresArgs = [
    '-y',
    '-framerate',
    safeFps,
    '-start_number',
    '1',
    '-i',
    frameInput,
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4',
    '-pix_fmt',
    'yuva444p10le',
    '-vendor',
    'apl0',
    outputFile,
  ]

  try {
    await execFileAsync('ffmpeg', proresArgs, { cwd: exportDir, maxBuffer: 1024 * 1024 * 8 })
    return { codec: 'prores_4444', outputFile, outputPath }
  } catch {
    const qtrleArgs = [
      '-y',
      '-framerate',
      safeFps,
      '-start_number',
      '1',
      '-i',
      frameInput,
      '-c:v',
      'qtrle',
      '-pix_fmt',
      'argb',
      outputFile,
    ]

    await execFileAsync('ffmpeg', qtrleArgs, { cwd: exportDir, maxBuffer: 1024 * 1024 * 8 })
    return { codec: 'qtrle_argb', outputFile, outputPath }
  }
}

function removeExportFrames(exportDir: string) {
  fs.readdirSync(exportDir)
    .filter((file) => /^frame_\d{6}\.png$/.test(file))
    .forEach((file) => {
      fs.rmSync(path.join(exportDir, file), { force: true })
    })
}

function getChatCompletionsUrl(baseUrl: string) {
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')

  if (!cleanBase) {
    throw new Error('请先填写 API Base URL')
  }

  let parsed: URL
  try {
    parsed = new URL(cleanBase)
  } catch {
    throw new Error('API Base URL 格式不正确，应以 http:// 或 https:// 开头')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('API Base URL 只支持 http:// 或 https://')
  }

  const normalizedBase = parsed.toString().replace(/\/+$/, '')
  return normalizedBase.endsWith('/chat/completions')
    ? normalizedBase
    : `${normalizedBase}/chat/completions`
}

function describeRequestError(error: unknown) {
  if (!(error instanceof Error)) {
    return '未知网络错误'
  }

  const cause = error.cause && typeof error.cause === 'object' ? error.cause as { code?: string; message?: string } : null
  const causeText = cause?.code || cause?.message

  return causeText ? `${error.message}（${causeText}）` : error.message
}

type ChatMessage = {
  content: string
  role: 'system' | 'user'
}

async function requestChatCompletion(
  chatCompletionsUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
) {
  const requestBody = JSON.stringify({
    max_tokens: maxTokens,
    messages,
    model,
    stream: false,
    temperature: 1,
  })
  let upstreamResponse: Response | null = null
  let upstreamText = ''
  let lastError: unknown

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      upstreamResponse = await fetch(chatCompletionsUrl, {
        body: requestBody,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          Connection: 'close',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
      upstreamText = await upstreamResponse.text()
      break
    } catch (error) {
      lastError = error
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
      }
    }
  }

  if (!upstreamResponse) {
    throw new Error(`无法连接模型接口 ${chatCompletionsUrl}：${describeRequestError(lastError)}`)
  }

  if (!upstreamResponse.ok) {
    throw new Error(upstreamText || '模型接口请求失败')
  }

  return upstreamText
}

function getJsonCandidate(content: string) {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)

  if (fenced) {
    return fenced[1].trim()
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }

  return trimmed
}

function normalizeJsonCandidate(candidate: string) {
  return candidate
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
}

function extractJsonPayload(content: string) {
  const candidate = getJsonCandidate(content)

  if (!candidate.startsWith('{')) {
    throw new Error('模型没有返回 JSON 对象')
  }

  try {
    return JSON.parse(candidate)
  } catch {
    return JSON.parse(normalizeJsonCandidate(candidate))
  }
}

function buildJsonRepairPrompt(rawContent: string, parseError: unknown) {
  const errorMessage = parseError instanceof Error ? parseError.message : 'JSON parse failed'

  return `下面是一段模型生成的 Overlay Studio JSON，但它不是合法 JSON。
请修复语法错误，只返回一个完整、可 JSON.parse 的 JSON 对象。
不要解释，不要 Markdown，不要新增卡片类型，不要改变字段含义。

解析错误：
${errorMessage}

原始内容：
${rawContent.slice(0, 18000)}`
}

function buildOverlayPrompt(fileName: string, srtText: string) {
  return `你是 Overlay Studio 的短视频动效策划器。请根据 SRT 字幕内容提炼重点，生成可直接导入 Overlay Studio 的 overlay JSON。

硬性规则：
1. 只能使用现有卡片库，kind 必须是 "metric"、"compare"、"quote"、"bars" 四种之一。
2. 禁止生成 flow，禁止生成自定义组件，禁止输出 Markdown，禁止解释。
3. 不要把所有字幕逐条生成卡片，只提炼重点，通常生成 8-14 个卡片。
4. 每个卡片必须绑定 SRT 的真实 start 时间；end 必须至少 start 后 2.5 秒。
5. 卡片出现后尽量持续到下一个卡片出现后 1.2 秒再结束；最后一张持续到项目结尾或至少 4 秒。
6. 卡片必须左右交替。第 1 张左边，第 2 张右边，第 3 张左边，以此类推。
7. 中心主体安全区必须完全空出，画面左右两侧各 20% 是特效区，中间 60% 是主体安全区。所有卡片必须在各自特效区水平居中：
   - MetricFocus：左 x=57, y=180, w=300, scale=0.9；右 x=1593, y=180, w=300, scale=0.9
   - QuoteLockup：左 x=51, y=214, w=300, scale=0.94；右 x=1587, y=214, w=300, scale=0.94
   - CompareSplit：左 x=113, y=286, w=220, scale=0.72；右 x=1649, y=286, w=220, scale=0.72
   - BarInsight：左 x=115, y=246, w=180, scale=0.86；右 x=1651, y=246, w=180, scale=0.86
8. 文字要短，必须总结重点，不要照搬长字幕。所有字都必须能完整显示。
9. 视觉风格遵守现有 Overlay Studio：黑白灰为主，少量蓝色强调，高级科技感，少阴影，不要彩虹渐变。
10. bars 只用于明确数字、百分比、金额、人数、倍数等数据；bars 的 value 必须是数字型，例如 "40%"、"3倍"、"12人"。禁止把 "AI代码"、"学习APP" 这类文字放进 bars。
11. 数字/数据类动效必须在 metric 和 bars 之间交叉展示。不要连续输出一串 metric，也不要连续输出一串 bars。第 1 个数字类卡片用 metric，第 2 个数字类卡片用 bars，第 3 个再用 metric，以此类推。compare 和 quote 不参与这个数字交替计数。

字段结构：
{
  "name": "${fileName.replace(/\.[^.]+$/, '')}_ai_overlay.json",
  "overlays": [
    {
      "id": "overlay_0001",
      "kind": "quote",
      "start": "00:00:01,000",
      "end": "00:00:06,000",
      "x": 42,
      "y": 220,
      "w": 300,
      "fontSize": 72,
      "scale": 0.94,
      "text": {}
    }
  ]
}

text 字段规则：
- metric: {"value":"73","unit":"%"}，fontSize 132，scale 0.9，坐标使用 MetricFocus 居中位置：左 x=57, y=180, w=300；右 x=1593, y=180, w=300。
- compare: {"leftLabel":"Before","leftValue":"过去","leftCaption":"旧路径","rightLabel":"After","rightValue":"AI","rightCaption":"新机会"}，fontSize 74，scale 0.72，坐标使用 CompareSplit 居中位置：左 x=113, y=286, w=220；右 x=1649, y=286, w=220。
- quote: {"eyebrow":"INSIGHT","line1":"第一行短句","line2":"第二行短句","blue":["AI"],"green":["增长"]}，fontSize 72，scale 0.94，坐标使用 QuoteLockup 居中位置：左 x=51, y=214, w=300；右 x=1587, y=214, w=300。
- bars: {"items":[{"value":"40%"}]}，fontSize 58，scale 0.86，坐标使用 BarInsight 居中位置：左 x=115, y=246, w=180；右 x=1651, y=246, w=180。只有没有明确数字时不要选 bars。

JSON 格式要求：
- 必须使用英文双引号。
- 数组元素之间必须有英文逗号。
- 对象字段之间必须有英文逗号。
- 不允许尾随逗号。
- 不允许注释。

请只返回一个完整 JSON 对象。

SRT 文件名：${fileName}

SRT 内容：
${srtText}`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'overlay-studio-export-api',
      configureServer(server) {
        server.middlewares.use('/api/export-frame', async (request, response) => {
          if (request.method !== 'POST') {
            response.statusCode = 405
            response.end('Method Not Allowed')
            return
          }

          try {
            const body = await readRequestBody(request)
            const payload = JSON.parse(body) as {
              dataUrl: string
              exportId: string
              frameName: string
            }

            const exportId = payload.exportId.replace(/[^a-zA-Z0-9_-]/g, '')
            const frameName = payload.frameName.replace(/[^a-zA-Z0-9_.-]/g, '')
            const match = payload.dataUrl.match(/^data:image\/png;base64,(.+)$/)

            if (!exportId || !frameName || !match) {
              response.statusCode = 400
              response.end('Invalid export payload')
              return
            }

            const exportDir = path.join(exportRoot, exportId)
            fs.mkdirSync(exportDir, { recursive: true })
            fs.writeFileSync(path.join(exportDir, frameName), Buffer.from(match[1], 'base64'))

            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ ok: true, path: path.join(exportDir, frameName) }))
          } catch (error) {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'Export failed')
          }
        })

        server.middlewares.use('/api/encode-transparent-video', async (request, response) => {
          if (request.method !== 'POST') {
            response.statusCode = 405
            response.end('Method Not Allowed')
            return
          }

          try {
            const body = await readRequestBody(request)
            const payload = JSON.parse(body) as {
              exportId: string
              fps?: number
            }
            const exportId = payload.exportId.replace(/[^a-zA-Z0-9_-]/g, '')

            if (!exportId) {
              response.statusCode = 400
              response.end('Invalid export id')
              return
            }

            const exportDir = path.join(exportRoot, exportId)
            const firstFrame = path.join(exportDir, 'frame_000001.png')

            if (!fs.existsSync(firstFrame)) {
              response.statusCode = 400
              response.end('No exported frames found')
              return
            }

            const result = await encodeTransparentMov(exportDir, exportId, Number(payload.fps ?? 30))
            removeExportFrames(exportDir)

            response.setHeader('Content-Type', 'application/json')
            response.end(
              JSON.stringify({
                codec: result.codec,
                directory: exportDir,
                file: path.join(exportDir, result.outputFile),
                ok: true,
              }),
            )
          } catch (error) {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'Video encode failed')
          }
        })

        server.middlewares.use('/api/test-ai-connection', async (request, response) => {
          if (request.method !== 'POST') {
            response.statusCode = 405
            response.end('Method Not Allowed')
            return
          }

          try {
            const body = await readRequestBody(request)
            const payload = JSON.parse(body) as {
              apiKey?: string
              baseUrl?: string
              model?: string
            }
            const apiKey = String(payload.apiKey ?? '').trim()
            const model = String(payload.model ?? '').trim()

            if (!apiKey || !model) {
              response.statusCode = 400
              response.end('请先填写 API Key 和模型名')
              return
            }

            const chatCompletionsUrl = getChatCompletionsUrl(String(payload.baseUrl ?? ''))
            await requestChatCompletion(
              chatCompletionsUrl,
              apiKey,
              model,
              [{ content: '只回复 OK。', role: 'user' }],
              8,
            )

            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ model, ok: true }))
          } catch (error) {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'AI 连接测试失败')
          }
        })

        server.middlewares.use('/api/generate-overlay', async (request, response) => {
          if (request.method !== 'POST') {
            response.statusCode = 405
            response.end('Method Not Allowed')
            return
          }

          try {
            const body = await readRequestBody(request)
            const payload = JSON.parse(body) as {
              apiKey?: string
              baseUrl?: string
              fileName?: string
              model?: string
              srtText?: string
            }
            const apiKey = String(payload.apiKey ?? '').trim()
            const model = String(payload.model ?? '').trim()
            const srtText = String(payload.srtText ?? '').trim()
            const fileName = String(payload.fileName ?? 'subtitle.srt').trim()

            if (!apiKey || !model || !srtText) {
              response.statusCode = 400
              response.end('请先填写 API Key、模型名，并导入有效 SRT')
              return
            }

            const chatCompletionsUrl = getChatCompletionsUrl(String(payload.baseUrl ?? ''))
            const requestModel = async (messages: ChatMessage[]) => {
              const upstreamText = await requestChatCompletion(chatCompletionsUrl, apiKey, model, messages, 8000)
              const upstreamJson = JSON.parse(upstreamText) as {
                choices?: Array<{ message?: { content?: string } }>
              }
              const content = upstreamJson.choices?.[0]?.message?.content

              if (!content) {
                throw new Error('模型响应里没有 message.content')
              }

              return content
            }

            const content = await requestModel([
              {
                content: '你只输出可解析 JSON，不输出 Markdown 或解释。',
                role: 'system',
              },
              {
                content: buildOverlayPrompt(fileName, srtText),
                role: 'user',
              },
            ])

            let project: unknown
            try {
              project = extractJsonPayload(content)
            } catch (parseError) {
              const repairedContent = await requestModel([
                {
                  content: '你是 JSON 修复器。你只输出合法 JSON 对象。',
                  role: 'system',
                },
                {
                  content: buildJsonRepairPrompt(content, parseError),
                  role: 'user',
                },
              ])
              try {
                project = extractJsonPayload(repairedContent)
              } catch (repairError) {
                const message = repairError instanceof Error ? repairError.message : 'JSON repair failed'
                throw new Error(`模型返回的 JSON 仍然不合法，已自动修复但失败。请重试一次或更换模型。${message}`)
              }
            }

            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ ok: true, project }))
          } catch (error) {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'AI 生成失败')
          }
        })
      },
    },
  ],
})
