import fs from 'node:fs'
import path from 'node:path'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const API_BASE = '/api/treeviewer'
const PATHS = {
  status: `${API_BASE}/status`,
  modules: `${API_BASE}/modules`,
  options: `${API_BASE}/options`,
  render: `${API_BASE}/render`,
  image: `${API_BASE}/image`,
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

function jsonResult(status, payload) {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(payload) }
}

function defaultOutputPath(engine, format) {
  const dir = path.join(engine.config.workDir, 'renders')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(dir, `render-${stamp}.${format}`)
}

function readJson(bodyText) {
  if (!bodyText) return {}
  try {
    return JSON.parse(bodyText)
  } catch {
    const error = new Error('request body is not valid JSON')
    error.code = 'INVALID_INPUT'
    throw error
  }
}

/**
 * Carrier-neutral request handler. The browser Fetch bridge and the web-server
 * fallback both call it and only differ in how they materialise the result.
 */
async function handleRequest({ engine, store }, request) {
  const url = new URL(request.url, 'http://localhost')
  const route = url.pathname
  const method = request.method

  if (route === PATHS.status && method === 'GET') {
    const status = await engine.detect()
    return jsonResult(status.ok ? 200 : 503, status)
  }
  if (route === PATHS.modules && method === 'GET') {
    return jsonResult(200, await engine.listModules())
  }
  if (route === PATHS.options && method === 'GET') {
    const category = url.searchParams.get('category') || ''
    const module = url.searchParams.get('module') || ''
    const result = await engine.getModuleOptions({ module, category })
    return jsonResult(result.ok ? 200 : 400, result)
  }
  if (route === PATHS.render && method === 'POST') {
    const bodyText = await request.text()
    if (Buffer.byteLength(bodyText) > MAX_BODY_BYTES) {
      return jsonResult(413, { ok: false, error: { code: 'INVALID_INPUT', message: 'request body is too large' } })
    }
    const parsed = readJson(bodyText)
    const settings = parsed && typeof parsed === 'object' ? parsed.settings ?? parsed : null
    if (!settings || typeof settings !== 'object' || Object.keys(settings).length === 0) {
      return jsonResult(400, { ok: false, error: { code: 'INVALID_INPUT', message: 'settings are required' } })
    }
    const format = settings.output?.format || 'png'
    const output = settings.output && typeof settings.output === 'object'
      ? { format, path: settings.output.path || defaultOutputPath(engine, format), ...settings.output }
      : { format: 'png', path: defaultOutputPath(engine, 'png') }
    const result = await engine.render({ ...settings, output })
    if (!result.ok) {
      return jsonResult(result.error.code === 'INVALID_INPUT' ? 400 : 422, result)
    }
    const id = store.add(result)
    return jsonResult(200, {
      ok: true,
      id,
      imageUrl: `${PATHS.image}?id=${id}`,
      imagePath: result.imagePath,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      durationMs: result.durationMs,
      appliedSettings: result.appliedSettings,
    })
  }
  if (route === PATHS.image && method === 'GET') {
    const entry = store.get(url.searchParams.get('id') || '')
    if (!entry) {
      return jsonResult(404, { ok: false, error: { code: 'NOT_FOUND', message: 'render not found' } })
    }
    let stat
    try {
      stat = fs.statSync(entry.imagePath)
    } catch {
      return jsonResult(410, { ok: false, error: { code: 'OUTPUT_NOT_WRITTEN', message: 'the rendered file no longer exists' } })
    }
    return {
      status: 200,
      headers: {
        'content-type': entry.mediaType,
        'content-length': String(stat.size),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...(entry.format === 'svg' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
      },
      file: entry.imagePath,
    }
  }
  return jsonResult(404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown route' } })
}

async function dispatch(services, request, logger) {
  try {
    return await handleRequest(services, request)
  } catch (error) {
    if (error && error.code === 'INVALID_INPUT') {
      return jsonResult(400, { ok: false, error: { code: 'INVALID_INPUT', message: error.message } })
    }
    logger?.warn?.(`[dsh-treeviewer] route ${new URL(request.url, 'http://localhost').pathname} failed: ${error.message}`)
    return jsonResult(500, { ok: false, error: { code: 'INTERNAL', message: error.message } })
  }
}

async function toResponse(services, request, logger) {
  const result = await dispatch(services, request, logger)
  if (result.file) {
    const data = fs.readFileSync(result.file)
    return new Response(data, { status: result.status, headers: result.headers })
  }
  return new Response(result.body, { status: result.status, headers: result.headers })
}

const ROUTE_METHODS = [
  [PATHS.status, ['GET']],
  [PATHS.modules, ['GET']],
  [PATHS.options, ['GET']],
  [PATHS.render, ['POST']],
  [PATHS.image, ['GET']],
]

/**
 * Register the panel API.
 *
 * The exact Fetch routes live on `ctx.connection`, which every carrier exposes:
 * the Web carrier serves them over HTTP under `/api`, and the desktop shell
 * dispatches them in-process. Older compositions without a connection service
 * fall back to plain web-server routes on the same paths.
 */
export function mountRoutes(ctx, services) {
  const { logger } = services
  const connection = ctx.get?.('connection')
  const disposers = []

  if (connection && typeof connection.fetch?.register === 'function') {
    for (const [routePath, methods] of ROUTE_METHODS) {
      const dispose = connection.fetch.register({
        path: routePath,
        methods,
        requestBody: 'buffered',
        fetch: (request) => toResponse(services, request, logger),
      })
      if (typeof dispose === 'function') disposers.push(dispose)
    }
    logger?.info?.(`[dsh-treeviewer] panel API mounted on ${API_BASE}`)
    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          /* already released */
        }
      }
    }
  }

  const webServer = ctx.get?.('webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    logger?.warn?.('[dsh-treeviewer] no connection or webServer service; the panel API is unavailable')
    return () => {}
  }
  const handler = async (req, res) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, error: { code: 'INVALID_INPUT', message: 'request body is too large' } }))
        return
      }
      chunks.push(chunk)
    }
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    })
    const result = await dispatch(services, request, logger)
    if (result.file) {
      res.writeHead(result.status, result.headers)
      fs.createReadStream(result.file).pipe(res)
      return
    }
    res.writeHead(result.status, result.headers)
    res.end(result.body)
  }
  for (const [routePath] of ROUTE_METHODS) {
    const dispose = webServer.register({ kind: 'exact', path: routePath, handler })
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  logger?.info?.(`[dsh-treeviewer] panel API mounted on ${API_BASE} (web-server fallback)`)
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* already released */
      }
    }
  }
}

export { PATHS as ROUTE_PATHS, API_BASE }
