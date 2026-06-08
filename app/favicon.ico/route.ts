const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0b0b0b"/>
  <path d="M19 35.5c0-8.8 6.4-15.5 15-15.5 8.1 0 14 5.9 14 13.8 0 4.1-1.6 7.7-4.2 10.2l5.7 5.8-4.8 4.8-5.7-5.8c-1.8.8-3.8 1.2-6 1.2-8.1 0-14-5.9-14-14.5Zm7.3-.2c0 5 3.4 8.5 8 8.5 4.4 0 7.7-3.4 7.7-8 0-5-3.4-8.5-8-8.5-4.4 0-7.7 3.4-7.7 8Z" fill="#fff"/>
</svg>`

export function GET() {
  return new Response(FAVICON_SVG, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "image/svg+xml",
    },
  })
}
