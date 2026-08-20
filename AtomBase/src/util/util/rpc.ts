export namespace Rpc {
  type Definition = {
    [method: string]: (input: any) => any
  }

  export function listen(rpc: Definition) {
    onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.request") {
        try {
          const method = rpc[parsed.method]
          if (!method) throw Object.assign(new Error(`Unknown RPC method: ${parsed.method}`), { code: "METHOD_NOT_FOUND" })
          const result = await method(parsed.input)
          postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
        } catch (error) {
          postMessage(JSON.stringify({
            type: "rpc.error",
            id: parsed.id,
            error: {
              code: typeof (error as any)?.code === "string" ? (error as any).code : "INTERNAL_ERROR",
              name: error instanceof Error ? error.name : "Error",
              message: error instanceof Error ? error.message : String(error),
              data: typeof (error as any)?.toObject === "function" ? (error as any).toObject() : undefined,
            },
          }))
        }
      }
    }
  }

  export function emit(event: string, data: unknown) {
    postMessage(JSON.stringify({ type: "rpc.event", event, data }))
  }

  export function client<T extends Definition>(target: {
    postMessage: (data: string) => void | null
    onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
  }) {
    const pending = new Map<number, { resolve(result: any): void; reject(error: Error): void }>()
    const listeners = new Map<string, Set<(data: any) => void>>()
    let id = 0
    target.onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.result") {
        const request = pending.get(parsed.id)
        if (request) {
          request.resolve(parsed.result)
          pending.delete(parsed.id)
        }
      }
      if (parsed.type === "rpc.error") {
        const request = pending.get(parsed.id)
        if (request) {
          const error = Object.assign(new Error(parsed.error?.message ?? "RPC request failed"), parsed.error)
          request.reject(error)
          pending.delete(parsed.id)
        }
      }
      if (parsed.type === "rpc.event") {
        const handlers = listeners.get(parsed.event)
        if (handlers) {
          for (const handler of handlers) {
            handler(parsed.data)
          }
        }
      }
    }
    return {
      call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
        const requestId = id++
        return new Promise((resolve, reject) => {
          pending.set(requestId, { resolve, reject })
          target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
        })
      },
      on<Data>(event: string, handler: (data: Data) => void) {
        let handlers = listeners.get(event)
        if (!handlers) {
          handlers = new Set()
          listeners.set(event, handlers)
        }
        handlers.add(handler)
        return () => {
          handlers!.delete(handler)
        }
      },
    }
  }
}
