/**
 * Amendment Queue System for Streaming Interrupt
 * 
 * Allows users to send messages while agent is streaming/writing.
 * Messages go to "amendment queue" instead of blocking.
 * Agent incorporates amendments without stopping current stream.
 * 
 * Usage:
 * - Shift+Enter: Add amendment to queue
 * - Enter: Force interrupt current stream
 */

import { Log } from "../util/log"
import { ulid } from "ulid"

export namespace AmendmentQueue {
  const log = Log.create({ service: "amendment" })

  export interface Amendment {
    id: string
    content: string
    timestamp: number
    type: "amendment" | "interrupt"
    metadata?: Record<string, any>
  }

  export interface Queue {
    sessionID: string
    items: Amendment[]
    isProcessing: boolean
    lastProcessedAt?: number
  }

  // In-memory queue storage (per session)
  const queues = new Map<string, Queue>()

  /**
   * Get or create queue for a session
   */
  export function getQueue(sessionID: string): Queue {
    if (!queues.has(sessionID)) {
      queues.set(sessionID, {
        sessionID,
        items: [],
        isProcessing: false,
      })
    }
    return queues.get(sessionID)!
  }

  /**
   * Add amendment to queue
   */
  export function addAmendment(
    sessionID: string,
    content: string,
    metadata?: Record<string, any>
  ): Amendment {
    const queue = getQueue(sessionID)
    const amendment: Amendment = {
      id: ulid(),
      content,
      timestamp: Date.now(),
      type: "amendment",
      metadata,
    }
    
    queue.items.push(amendment)
    log.info("amendment added", { 
      sessionID, 
      amendmentID: amendment.id,
      queueLength: queue.items.length 
    })
    
    return amendment
  }

  /**
   * Add interrupt signal to queue
   */
  export function addInterrupt(
    sessionID: string,
    content?: string,
    metadata?: Record<string, any>
  ): Amendment {
    const queue = getQueue(sessionID)
    const interrupt: Amendment = {
      id: ulid(),
      content: content || "",
      timestamp: Date.now(),
      type: "interrupt",
      metadata,
    }
    
    queue.items.push(interrupt)
    log.info("interrupt added", { 
      sessionID, 
      interruptID: interrupt.id,
      queueLength: queue.items.length 
    })
    
    return interrupt
  }

  /**
   * Get next item from queue (FIFO)
   */
  export function dequeue(sessionID: string): Amendment | undefined {
    const queue = getQueue(sessionID)
    const item = queue.items.shift()
    
    if (item) {
      queue.lastProcessedAt = Date.now()
      log.info("dequeued", { 
        sessionID, 
        itemID: item.id, 
        type: item.type,
        remaining: queue.items.length 
      })
    }
    
    return item
  }

  /**
   * Peek at next item without removing
   */
  export function peek(sessionID: string): Amendment | undefined {
    const queue = getQueue(sessionID)
    return queue.items[0]
  }

  /**
   * Check if queue has items
   */
  export function hasItems(sessionID: string): boolean {
    const queue = getQueue(sessionID)
    return queue.items.length > 0
  }

  /**
   * Get queue length
   */
  export function length(sessionID: string): number {
    const queue = getQueue(sessionID)
    return queue.items.length
  }

  /**
   * Clear queue
   */
  export function clear(sessionID: string): void {
    const queue = getQueue(sessionID)
    const count = queue.items.length
    queue.items = []
    queue.isProcessing = false
    log.info("queue cleared", { sessionID, clearedCount: count })
  }

  /**
   * Set processing state
   */
  export function setProcessing(sessionID: string, isProcessing: boolean): void {
    const queue = getQueue(sessionID)
    queue.isProcessing = isProcessing
    log.info("processing state changed", { sessionID, isProcessing })
  }

  /**
   * Check if currently processing
   */
  export function isProcessing(sessionID: string): boolean {
    const queue = getQueue(sessionID)
    return queue.isProcessing
  }

  /**
   * Get all items in queue (without removing)
   */
  export function getAll(sessionID: string): Amendment[] {
    const queue = getQueue(sessionID)
    return [...queue.items]
  }

  /**
   * Remove specific item by ID
   */
  export function remove(sessionID: string, amendmentID: string): boolean {
    const queue = getQueue(sessionID)
    const index = queue.items.findIndex(item => item.id === amendmentID)
    
    if (index >= 0) {
      queue.items.splice(index, 1)
      log.info("item removed", { sessionID, amendmentID })
      return true
    }
    
    return false
  }

  /**
   * Cleanup queue for session (when session ends)
   */
  export function cleanup(sessionID: string): void {
    queues.delete(sessionID)
    log.info("queue cleaned up", { sessionID })
  }

  /**
   * Get queue statistics
   */
  export function getStats(sessionID: string): {
    length: number
    isProcessing: boolean
    lastProcessedAt?: number
    oldestItemAge?: number
  } {
    const queue = getQueue(sessionID)
    const oldestItem = queue.items[0]
    
    return {
      length: queue.items.length,
      isProcessing: queue.isProcessing,
      lastProcessedAt: queue.lastProcessedAt,
      oldestItemAge: oldestItem ? Date.now() - oldestItem.timestamp : undefined,
    }
  }
}
