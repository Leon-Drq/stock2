const DEFAULT_API_URL = "http://localhost:8000"

type ProxyContext = {
  params: Promise<{ path: string[] }>
}

export async function GET(request: Request, context: ProxyContext) {
  return proxyToPython(request, context)
}

export async function POST(request: Request, context: ProxyContext) {
  return proxyToPython(request, context)
}

export async function PATCH(request: Request, context: ProxyContext) {
  return proxyToPython(request, context)
}

export async function DELETE(request: Request, context: ProxyContext) {
  return proxyToPython(request, context)
}

async function proxyToPython(request: Request, context: ProxyContext) {
  const { path } = await context.params
  const sourceUrl = new URL(request.url)
  const apiBaseUrl = process.env.PYTHON_API_URL ?? DEFAULT_API_URL
  const targetUrl = `${apiBaseUrl.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}${sourceUrl.search}`
  const headers = new Headers()

  copyHeader(request.headers, headers, "accept")
  copyHeader(request.headers, headers, "content-type")
  copyHeader(request.headers, headers, "cookie")

  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
  })

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    if (!["connection", "content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  })

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

function copyHeader(from: Headers, to: Headers, key: string) {
  const value = from.get(key)
  if (value) to.set(key, value)
}
