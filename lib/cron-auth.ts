export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret === "change-me") return process.env.WEB_AUTH_REQUIRED === "false"
  return request.headers.get("authorization") === `Bearer ${secret}`
}
