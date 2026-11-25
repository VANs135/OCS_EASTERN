/** Serialize commands and keep the underlying session open until accepted work drains. */
export function createRequestQueue<Request, Response>(
  handle: (request: Request) => Response | Promise<Response>,
  release: () => void | Promise<void>,
) {
  let tail = Promise.resolve()
  let closing: Promise<void> | undefined

  function dispatch(request: Request): Promise<Response> {
    if (closing) return Promise.reject(new Error('Match request queue is closed'))
    const result = tail.then(() => handle(request))
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  function close(): Promise<void> {
    closing ??= tail.then(release)
    return closing
  }

  return { dispatch, close }
}
