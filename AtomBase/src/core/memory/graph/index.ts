/**
 * Simple Knowledge Graph
 * 
 * Stores relationships between concepts, errors, solutions, and files.
 * Enables semantic queries and connection discovery.
 */

import os from "os"
import path from "path"
import fs from "fs/promises"

import type {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeGraph as KnowledgeGraphType,
  NodeType,
  EdgeType,
} from "../types"

import { Log } from "@/util/util/log"

const log = Log.create({ service: "memory.graph" })

// ============================================================================
// CONSTANTS
// ============================================================================

const GRAPH_DIR = ".atomcli/knowledge"
const GRAPH_FILE = "graph.json"

// ============================================================================
// KNOWLEDGE GRAPH
// ============================================================================

export class KnowledgeGraphService {
  private graphPath: string
  private nodes: Map<string, KnowledgeNode> = new Map()
  private edges: Map<string, KnowledgeEdge> = new Map()
  private initialized = false

  constructor() {
    this.graphPath = path.join(os.homedir(), GRAPH_DIR, GRAPH_FILE)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await fs.mkdir(path.dirname(this.graphPath), { recursive: true })

      try {
        await fs.access(this.graphPath)
        await this.loadGraph()
      } catch {
        await this.saveGraph()
      }

      this.initialized = true
      log.info("Knowledge graph initialized", { path: this.graphPath })
    } catch (error) {
      log.error("Failed to initialize knowledge graph", { error })
      throw error
    }
  }

  /**
   * Load graph from file
   */
  private async loadGraph(): Promise<void> {
    const content = await fs.readFile(this.graphPath, "utf-8")
    const graph: KnowledgeGraphType = JSON.parse(content)

    this.nodes = new Map(Object.entries(graph.nodes) as [string, KnowledgeNode][])
    this.edges = new Map(Object.entries(graph.edges) as [string, KnowledgeEdge][])

    log.info("Loaded knowledge graph", { 
      nodes: this.nodes.size, 
      edges: this.edges.size 
    })
  }

  /**
   * Save graph to file
   */
  private async saveGraph(): Promise<void> {
    const graph: KnowledgeGraphType = {
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
    }

    await fs.writeFile(this.graphPath, JSON.stringify(graph, null, 2))
  }

  // ============================================================================
  // NODE OPERATIONS
  // ============================================================================

  /**
   * Add a node to the graph
   */
  async addNode(node: Omit<KnowledgeNode, "id" | "createdAt" | "relationships" | "strength">): Promise<KnowledgeNode> {
    await this.initialize()

    const newNode: KnowledgeNode = {
      ...node,
      id: `${node.type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
      relationships: [],
      strength: 0.5,
    }

    this.nodes.set(newNode.id, newNode)
    await this.saveGraph()

    log.debug("Added node", { id: newNode.id, type: newNode.type, label: newNode.label })

    return newNode
  }

  /**
   * Get a node by ID
   */
  async getNode(id: string): Promise<KnowledgeNode | null> {
    await this.initialize()
    return this.nodes.get(id) || null
  }

  /**
   * Find nodes by type
   */
  async findNodesByType(type: NodeType): Promise<KnowledgeNode[]> {
    await this.initialize()

    const results: KnowledgeNode[] = []
    for (const node of this.nodes.values()) {
      if (node.type === type) {
        results.push(node)
      }
    }

    return results
  }

  /**
   * Find nodes by label (partial match)
   */
  async findNodesByLabel(label: string): Promise<KnowledgeNode[]> {
    await this.initialize()

    const labelLower = label.toLowerCase()
    const results: KnowledgeNode[] = []

    for (const node of this.nodes.values()) {
      if (node.label.toLowerCase().includes(labelLower)) {
        results.push(node)
      }
    }

    return results
  }

  /**
   * Update a node
   */
  async updateNode(id: string, updates: Partial<KnowledgeNode>): Promise<void> {
    await this.initialize()

    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Node not found: ${id}`)
    }

    const updated = { ...node, ...updates }
    this.nodes.set(id, updated)
    await this.saveGraph()
  }

  /**
   * Delete a node and its edges
   */
  async deleteNode(id: string): Promise<void> {
    await this.initialize()

    // Delete node
    this.nodes.delete(id)

    // Delete connected edges
    const edgesToDelete: string[] = []
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === id || edge.target === id) {
        edgesToDelete.push(edgeId)
      }
    }

    for (const edgeId of edgesToDelete) {
      this.edges.delete(edgeId)
    }

    await this.saveGraph()
  }

  // ============================================================================
  // EDGE OPERATIONS
  // ============================================================================

  /**
   * Add an edge between two nodes
   */
  async addEdge(
    source: string,
    target: string,
    type: EdgeType,
    weight: number = 0.5
  ): Promise<KnowledgeEdge> {
    await this.initialize()

    // Verify nodes exist
    if (!this.nodes.has(source)) {
      throw new Error(`Source node not found: ${source}`)
    }
    if (!this.nodes.has(target)) {
      throw new Error(`Target node not found: ${target}`)
    }

    // Check if edge already exists
    for (const edge of this.edges.values()) {
      if (edge.source === source && edge.target === target) {
        // Update existing edge
        edge.type = type
        edge.weight = weight
        await this.saveGraph()
        return edge
      }
    }

    const edge: KnowledgeEdge = {
      id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      source,
      target,
      type,
      weight,
      createdAt: new Date().toISOString(),
    }

    this.edges.set(edge.id, edge)
    await this.saveGraph()

    log.debug("Added edge", { id: edge.id, type, source, target })

    return edge
  }

  /**
   * Get edges connected to a node
   */
  async getConnectedEdges(nodeId: string): Promise<KnowledgeEdge[]> {
    await this.initialize()

    const edges: KnowledgeEdge[] = []
    for (const edge of this.edges.values()) {
      if (edge.source === nodeId || edge.target === nodeId) {
        edges.push(edge)
      }
    }

    return edges
  }

  /**
   * Delete an edge
   */
  async deleteEdge(edgeId: string): Promise<void> {
    await this.initialize()

    this.edges.delete(edgeId)
    await this.saveGraph()
  }

  // ============================================================================
  // GRAPH QUERIES
  // ============================================================================

  /**
   * Get all nodes related to a node
   */
  async getRelated(nodeId: string, edgeType?: EdgeType): Promise<KnowledgeNode[]> {
    await this.initialize()

    const related: KnowledgeNode[] = []
    const visited = new Set<string>()

    // BFS traversal
    const queue: string[] = [nodeId]
    visited.add(nodeId)

    while (queue.length > 0) {
      const current = queue.shift()!
      const edges = await this.getConnectedEdges(current)

      for (const edge of edges) {
        if (edgeType && edge.type !== edgeType) continue

        const neighborId = edge.source === current ? edge.target : edge.source

        if (!visited.has(neighborId)) {
          visited.add(neighborId)
          const neighbor = this.nodes.get(neighborId)
          if (neighbor) {
            related.push(neighbor)
            queue.push(neighborId)
          }
        }
      }
    }

    return related
  }

  /**
   * Find path between two nodes
   */
  async findPath(source: string, target: string): Promise<string[]> {
    await this.initialize()

    // BFS to find shortest path
    const queue: Array<{ id: string; path: string[] }> = [{ id: source, path: [] }]
    const visited = new Set<string>()

    while (queue.length > 0) {
      const { id, path } = queue.shift()!

      if (id === target) {
        return path
      }

      if (visited.has(id)) continue
      visited.add(id)

      const edges = await this.getConnectedEdges(id)
      for (const edge of edges) {
        const neighborId = edge.source === id ? edge.target : edge.source
        if (!visited.has(neighborId)) {
          queue.push({
            id: neighborId,
            path: [...path, edge.id],
          })
        }
      }
    }

    return [] // No path found
  }

  /**
   * Suggest connections for a node
   */
  async suggestConnections(nodeId: string): Promise<Array<{ node: KnowledgeNode; reason: string }>> {
    await this.initialize()

    const node = this.nodes.get(nodeId)
    if (!node) return []

    const suggestions: Array<{ node: KnowledgeNode; reason: string }> = []
    const existingIds = new Set<string>([nodeId])

    // Get existing connections
    const connected = await this.getRelated(nodeId)
    for (const n of connected) {
      existingIds.add(n.id)
    }

    // Find potential connections based on type
    for (const other of this.nodes.values()) {
      if (existingIds.has(other.id)) continue

      const suggestion = this.getConnectionSuggestion(node, other)
      if (suggestion) {
        suggestions.push({ node: other, reason: suggestion })
      }
    }

    return suggestions.slice(0, 5)
  }

  /**
   * Get connection suggestion between two nodes
   */
  private getConnectionSuggestion(
    node1: KnowledgeNode,
    node2: KnowledgeNode
  ): string | null {
    // Same type → "similar_to"
    if (node1.type === node2.type) {
      return `Both are ${node1.type} nodes`
    }

    // Error → Solution (heuristic)
    if (node1.type === "error" && node2.type === "solution") {
      return "Error might be solved by this solution"
    }
    if (node1.type === "solution" && node2.type === "error") {
      return "This solution might solve the error"
    }

    // File → Concept (heuristic)
    if (node1.type === "file" && node2.type === "concept") {
      return `File might implement the ${node2.label} concept`
    }
    if (node1.type === "concept" && node2.type === "file") {
      return `Concept might be implemented in the file`
    }

    // Pattern → File
    if (node1.type === "pattern" && node2.type === "file") {
      return "Pattern might be used in this file"
    }

    return null
  }

  // ============================================================================
  // AUTO-BUILD FROM MEMORY
  // ============================================================================

  /**
   * Build graph from memory items
   */
  async buildFromMemory(
    memories: Array<{
      id: string
      type: string
      title: string
      context: string
      solution?: string
      tags?: string[]
    }>
  ): Promise<void> {
    await this.initialize()

    // Create nodes for each memory
    const memoryNodes = new Map<string, KnowledgeNode>()

    for (const mem of memories) {
      const node = await this.addNode({
        type: this.mapMemoryTypeToNodeType(mem.type),
        label: mem.title,
        properties: {
          memoryId: mem.id,
          context: mem.context,
          tags: mem.tags,
        },
      })

      memoryNodes.set(mem.id, node)
    }

    // Create edges based on relationships
    for (const mem of memories) {
      const sourceNode = memoryNodes.get(mem.id)
      if (!sourceNode) continue

      // Context → Memory edge
      await this.addEdge(
        `context_${mem.context.toLowerCase().replace(/\s+/g, "_")}`,
        sourceNode.id,
        "uses"
      )

      // Solution connections
      if (mem.solution) {
        // This is simplified - in reality would do more sophisticated matching
        const solutionPatterns = await this.findNodesByType("solution")
        for (const solNode of solutionPatterns) {
          if (solNode.label.toLowerCase().includes(mem.solution!.toLowerCase().slice(0, 20))) {
            await this.addEdge(sourceNode.id, solNode.id, "solves", 0.7)
          }
        }
      }
    }

    log.info("Built graph from memory", { 
      memories: memories.length,
      nodes: this.nodes.size,
      edges: this.edges.size,
    })
  }

  /**
   * Map memory type to node type
   */
  private mapMemoryTypeToNodeType(memoryType: string): NodeType {
    const mapping: Record<string, NodeType> = {
      error: "error",
      pattern: "pattern",
      solution: "solution",
      preference: "concept",
      context: "concept",
      research: "knowledge",
      knowledge: "knowledge",
    }

    return mapping[memoryType] || "concept"
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get graph statistics
   */
  async getStats(): Promise<{
    nodeCount: number
    edgeCount: number
    nodesByType: Record<string, number>
    edgesByType: Record<string, number>
    avgConnections: number
  }> {
    await this.initialize()

    const nodesByType: Record<string, number> = {}
    const edgesByType: Record<string, number> = {}

    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1
    }

    for (const edge of this.edges.values()) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1
    }

    const avgConnections = this.nodes.size > 0
      ? this.edges.size * 2 / this.nodes.size
      : 0

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      nodesByType,
      edgesByType,
      avgConnections,
    }
  }

  // ============================================================================
  // MAINTENANCE
  // ============================================================================

  /**
   * Clear all graph data
   */
  async clear(): Promise<void> {
    this.nodes.clear()
    this.edges.clear()
    await this.saveGraph()
    log.info("Cleared knowledge graph")
  }

  /**
   * Export graph data
   */
  async export(): Promise<string> {
    await this.initialize()
    return JSON.stringify({
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
    }, null, 2)
  }

  /**
   * Import graph data
   */
  async import(data: string): Promise<void> {
    const graph: KnowledgeGraphType = JSON.parse(data)

    this.nodes = new Map(Object.entries(graph.nodes) as [string, KnowledgeNode][])
    this.edges = new Map(Object.entries(graph.edges) as [string, KnowledgeEdge][])

    await this.saveGraph()
    log.info("Imported knowledge graph", { 
      nodes: this.nodes.size, 
      edges: this.edges.size 
    })
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let defaultInstance: KnowledgeGraphService | null = null

export function getKnowledgeGraph(): KnowledgeGraphService {
  if (!defaultInstance) {
    defaultInstance = new KnowledgeGraphService()
  }
  return defaultInstance
}

export async function initializeKnowledgeGraph(): Promise<KnowledgeGraphService> {
  const graph = getKnowledgeGraph()
  await graph.initialize()
  return graph
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default KnowledgeGraphService
