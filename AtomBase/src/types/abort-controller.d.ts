declare module "abort-controller" {
  export class AbortController {
    signal: AbortSignal
    abort(): void
  }
  export class AbortSignal {
    aborted: boolean
    onabort: ((this: AbortSignal, ev: Event) => any) | null
    addEventListener(
      type: "abort",
      listener: (this: AbortSignal, ev: Event) => any,
      options?: boolean | AddEventListenerOptions,
    ): void
    removeEventListener(
      type: "abort",
      listener: (this: AbortSignal, ev: Event) => any,
      options?: boolean | EventListenerOptions,
    ): void
  }
}
