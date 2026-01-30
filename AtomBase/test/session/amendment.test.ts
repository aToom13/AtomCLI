import { describe, it, expect, beforeEach } from "bun:test"
import { AmendmentQueue } from "../../src/session/amendment"

describe("AmendmentQueue", () => {
  const sessionID = "test-session-123"

  beforeEach(() => {
    // Clear queue before each test
    AmendmentQueue.clear(sessionID)
  })

  it("should create a new queue for a session", () => {
    const queue = AmendmentQueue.getQueue(sessionID)
    expect(queue.sessionID).toBe(sessionID)
    expect(queue.items).toEqual([])
    expect(queue.isProcessing).toBe(false)
  })

  it("should add amendment to queue", () => {
    const amendment = AmendmentQueue.addAmendment(sessionID, "Test amendment content")
    
    expect(amendment.content).toBe("Test amendment content")
    expect(amendment.type).toBe("amendment")
    expect(amendment.id).toBeDefined()
    expect(amendment.timestamp).toBeGreaterThan(0)
  })

  it("should add interrupt to queue", () => {
    const interrupt = AmendmentQueue.addInterrupt(sessionID, "Stop please")
    
    expect(interrupt.content).toBe("Stop please")
    expect(interrupt.type).toBe("interrupt")
    expect(interrupt.id).toBeDefined()
  })

  it("should dequeue items in FIFO order", () => {
    AmendmentQueue.addAmendment(sessionID, "First")
    AmendmentQueue.addAmendment(sessionID, "Second")
    AmendmentQueue.addAmendment(sessionID, "Third")

    const first = AmendmentQueue.dequeue(sessionID)
    const second = AmendmentQueue.dequeue(sessionID)
    const third = AmendmentQueue.dequeue(sessionID)

    expect(first?.content).toBe("First")
    expect(second?.content).toBe("Second")
    expect(third?.content).toBe("Third")
  })

  it("should return undefined when queue is empty", () => {
    const item = AmendmentQueue.dequeue(sessionID)
    expect(item).toBeUndefined()
  })

  it("should check if queue has items", () => {
    expect(AmendmentQueue.hasItems(sessionID)).toBe(false)
    
    AmendmentQueue.addAmendment(sessionID, "Test")
    expect(AmendmentQueue.hasItems(sessionID)).toBe(true)
  })

  it("should get queue length", () => {
    expect(AmendmentQueue.length(sessionID)).toBe(0)
    
    AmendmentQueue.addAmendment(sessionID, "Test 1")
    AmendmentQueue.addAmendment(sessionID, "Test 2")
    
    expect(AmendmentQueue.length(sessionID)).toBe(2)
  })

  it("should peek at next item without removing", () => {
    AmendmentQueue.addAmendment(sessionID, "Peek test")
    
    const peeked = AmendmentQueue.peek(sessionID)
    const length = AmendmentQueue.length(sessionID)
    
    expect(peeked?.content).toBe("Peek test")
    expect(length).toBe(1) // Item still in queue
  })

  it("should clear queue", () => {
    AmendmentQueue.addAmendment(sessionID, "Test 1")
    AmendmentQueue.addAmendment(sessionID, "Test 2")
    
    AmendmentQueue.clear(sessionID)
    
    expect(AmendmentQueue.length(sessionID)).toBe(0)
    expect(AmendmentQueue.hasItems(sessionID)).toBe(false)
  })

  it("should set and get processing state", () => {
    expect(AmendmentQueue.isProcessing(sessionID)).toBe(false)
    
    AmendmentQueue.setProcessing(sessionID, true)
    expect(AmendmentQueue.isProcessing(sessionID)).toBe(true)
    
    AmendmentQueue.setProcessing(sessionID, false)
    expect(AmendmentQueue.isProcessing(sessionID)).toBe(false)
  })

  it("should get all items without removing", () => {
    AmendmentQueue.addAmendment(sessionID, "Item 1")
    AmendmentQueue.addAmendment(sessionID, "Item 2")
    
    const all = AmendmentQueue.getAll(sessionID)
    
    expect(all.length).toBe(2)
    expect(all[0].content).toBe("Item 1")
    expect(all[1].content).toBe("Item 2")
    expect(AmendmentQueue.length(sessionID)).toBe(2) // Still in queue
  })

  it("should remove specific item by ID", () => {
    const amendment = AmendmentQueue.addAmendment(sessionID, "To be removed")
    AmendmentQueue.addAmendment(sessionID, "Keep this")
    
    const removed = AmendmentQueue.remove(sessionID, amendment.id)
    
    expect(removed).toBe(true)
    expect(AmendmentQueue.length(sessionID)).toBe(1)
    expect(AmendmentQueue.peek(sessionID)?.content).toBe("Keep this")
  })

  it("should return false when removing non-existent item", () => {
    const removed = AmendmentQueue.remove(sessionID, "non-existent-id")
    expect(removed).toBe(false)
  })

  it("should get queue stats", () => {
    AmendmentQueue.addAmendment(sessionID, "Test")
    AmendmentQueue.setProcessing(sessionID, true)
    
    const stats = AmendmentQueue.getStats(sessionID)
    
    expect(stats.length).toBe(1)
    expect(stats.isProcessing).toBe(true)
    expect(stats.oldestItemAge).toBeGreaterThanOrEqual(0)
  })

  it("should cleanup queue for session", () => {
    AmendmentQueue.addAmendment(sessionID, "Test")
    
    AmendmentQueue.cleanup(sessionID)
    
    // After cleanup, getQueue should create a new empty queue
    const queue = AmendmentQueue.getQueue(sessionID)
    expect(queue.items).toEqual([])
  })
})
