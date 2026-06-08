type FallbackReason = "timeout" | "error"

export async function resolveWithFallback<T>(
  promise: Promise<T>,
  options: {
    timeoutMs: number
    onFallback: (reason: FallbackReason, error?: unknown) => T | Promise<T>
  },
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const guardedPromise = promise.catch((error) => {
    if (timedOut) return undefined as T
    throw error
  })

  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true
      resolve(options.onFallback("timeout"))
    }, options.timeoutMs)
  })

  try {
    return await Promise.race([guardedPromise, timeoutPromise])
  } catch (error) {
    return options.onFallback("error", error)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
