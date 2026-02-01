/**
 * Memory Management CLI Command
 * 
 * View and manage the AI's memory about you and your preferences.
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { getUserProfile } from "../../memory/services/user-profile"
import { getPreferencesService } from "../../memory/services/preferences"
import { Log } from "../../util/log"

const log = Log.create({ service: "cli.cmd.memory" })

// ============================================================================
// SUBCOMMANDS
// ============================================================================

const MemoryShowCommand = cmd({
  command: "show",
  describe: "Show your profile and learned preferences",
  async handler() {
    await showMemoryStatus()
  },
})

const MemoryProfileCommand = cmd({
  command: "profile",
  describe: "Show your user profile",
  async handler() {
    await showProfile()
  },
})

const MemoryPreferencesCommand = cmd({
  command: "preferences",
  describe: "Show learned preferences",
  async handler() {
    await showPreferences()
  },
})

const MemorySetNameCommand = cmd({
  command: "set-name <name>",
  describe: "Set your name",
  async handler(args) {
    await setName(args.name as string)
  },
})

const MemoryClearCommand = cmd({
  command: "clear",
  describe: "Clear all memory (requires confirmation)",
  builder: (yargs: Argv) =>
    yargs.option("yes", {
      alias: "y",
      type: "boolean",
      describe: "Skip confirmation",
    }),
  async handler(args) {
    await clearMemory(args.yes as boolean)
  },
})

const MemoryExportCommand = cmd({
  command: "export",
  describe: "Export memory to JSON",
  builder: (yargs: Argv) =>
    yargs.option("output", {
      alias: "o",
      type: "string",
      describe: "Output file path",
    }),
  async handler(args) {
    await exportMemory(args.output as string | undefined)
  },
})

// ============================================================================
// MAIN COMMAND
// ============================================================================

export const MemoryCommand = cmd({
  command: "memory",
  describe: "View and manage AI memory about you and your preferences",
  builder: (yargs: Argv) =>
    yargs
      .command(MemoryShowCommand)
      .command(MemoryProfileCommand)
      .command(MemoryPreferencesCommand)
      .command(MemorySetNameCommand)
      .command(MemoryClearCommand)
      .command(MemoryExportCommand)
      .demandCommand(),
  async handler() {
    // Default action when no subcommand is provided
    await showMemoryStatus()
  },
})

// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

async function showMemoryStatus() {
  try {
    const userProfile = getUserProfile()
    const preferences = getPreferencesService()

    await userProfile.initialize()
    await preferences.initialize()

    const profile = await userProfile.getProfile()
    const stats = await preferences.getStats()

    console.log("\n🧠 Memory Status\n")
    console.log("═".repeat(50))
    
    // User Profile
    console.log("\n👤 User Profile:")
    if (profile.name) {
      console.log(`   Name: ${profile.name}`)
    } else {
      console.log(`   Name: Not set (use 'atomcli memory set-name <name>')`)
    }
    console.log(`   Tech Level: ${profile.techLevel}`)
    console.log(`   Primary Language: ${profile.primaryLanguage}`)
    console.log(`   Communication Style: ${profile.communication}`)
    console.log(`   Learning Style: ${profile.learningStyle}`)
    console.log(`   Work Style: ${profile.workStyle}`)
    
    // Statistics
    console.log("\n📊 Statistics:")
    console.log(`   Total Interactions: ${profile.totalInteractions}`)
    console.log(`   Learned Preferences: ${stats.total}`)
    console.log(`   High Confidence: ${stats.highConfidenceCount}`)
    console.log(`   Average Confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`)
    
    // Recent Work
    if (profile.recentlyWorkedOn.length > 0) {
      console.log("\n📁 Recent Work:")
      profile.recentlyWorkedOn.forEach(item => {
        console.log(`   - ${item}`)
      })
    }
    
    // Interests
    if (profile.interests.length > 0) {
      console.log("\n💡 Interests:")
      profile.interests.forEach(item => {
        console.log(`   - ${item}`)
      })
    }
    
    // Last Active
    if (profile.lastActive) {
      console.log(`\n⏰ Last Active: ${new Date(profile.lastActive).toLocaleString()}`)
    }
    
    console.log("\n" + "═".repeat(50))
    console.log("\nUse 'atomcli memory profile' or 'atomcli memory preferences' for more details.\n")
    
  } catch (error) {
    log.error("Failed to show memory status", { error })
    console.error("❌ Failed to load memory:", error)
  }
}

async function showProfile() {
  try {
    const userProfile = getUserProfile()
    await userProfile.initialize()
    const profile = await userProfile.getProfile()

    console.log("\n👤 User Profile\n")
    console.log("═".repeat(50))
    
    console.log("\n📋 Basic Information:")
    console.log(`   Name: ${profile.name || "Not set"}`)
    if (profile.preferredPronouns) {
      console.log(`   Pronouns: ${profile.preferredPronouns}`)
    }
    
    console.log("\n🎯 Technical Profile:")
    console.log(`   Tech Level: ${profile.techLevel}`)
    console.log(`   Primary Language: ${profile.primaryLanguage}`)
    console.log(`   Languages: ${profile.languages.join(", ")}`)
    
    console.log("\n💬 Communication:")
    console.log(`   Relation to AI: ${profile.userToAIRelation}`)
    console.log(`   Communication Style: ${profile.communication}`)
    console.log(`   Learning Style: ${profile.learningStyle}`)
    console.log(`   Work Style: ${profile.workStyle}`)
    
    console.log("\n⚙️ Preferences:")
    console.log(`   Prefers Explanations: ${profile.prefersExplanations ? "Yes" : "No"}`)
    console.log(`   Prefers Code Examples: ${profile.prefersCodeExamples ? "Yes" : "No"}`)
    console.log(`   Likes Humor: ${profile.likesHumor ? "Yes" : "No"}`)
    console.log(`   Time Preference: ${profile.timePreference}`)
    
    console.log("\n" + "═".repeat(50) + "\n")
    
  } catch (error) {
    log.error("Failed to show profile", { error })
    console.error("❌ Failed to load profile:", error)
  }
}

async function showPreferences() {
  try {
    const preferences = getPreferencesService()
    await preferences.initialize()
    
    const stats = await preferences.getStats()
    const allPrefs = await preferences.getAll()

    console.log("\n⚙️ Learned Preferences\n")
    console.log("═".repeat(50))
    
    console.log("\n📊 Statistics:")
    console.log(`   Total: ${stats.total}`)
    console.log(`   High Confidence: ${stats.highConfidenceCount}`)
    console.log(`   Average Confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`)
    
    console.log("\n📁 By Category:")
    Object.entries(stats.byCategory).forEach(([category, count]) => {
      console.log(`   ${category}: ${count}`)
    })
    
    if (allPrefs.length > 0) {
      console.log("\n📝 Preferences:")
      
      // Group by category
      const byCategory: Record<string, typeof allPrefs> = {}
      allPrefs.forEach(pref => {
        if (!byCategory[pref.category]) {
          byCategory[pref.category] = []
        }
        byCategory[pref.category].push(pref)
      })
      
      Object.entries(byCategory).forEach(([category, prefs]) => {
        console.log(`\n   ${category.toUpperCase()}:`)
        prefs.forEach(pref => {
          const confidence = (pref.confidence * 100).toFixed(0)
          const value = typeof pref.value === "object" 
            ? JSON.stringify(pref.value) 
            : String(pref.value)
          console.log(`      ${pref.key}: ${value} (${confidence}% confidence)`)
        })
      })
    }
    
    console.log("\n" + "═".repeat(50) + "\n")
    
  } catch (error) {
    log.error("Failed to show preferences", { error })
    console.error("❌ Failed to load preferences:", error)
  }
}

async function setName(name: string) {
  try {
    const userProfile = getUserProfile()
    await userProfile.initialize()
    await userProfile.learnName(name)
    
    console.log(`\n✅ Name set to: ${name}\n`)
    
  } catch (error) {
    log.error("Failed to set name", { error })
    console.error("❌ Failed to set name:", error)
  }
}

async function clearMemory(skipConfirmation: boolean) {
  try {
    if (!skipConfirmation) {
      console.log("\n⚠️  WARNING: This will delete all learned preferences and profile data.")
      console.log("This action cannot be undone.\n")
      
      // In a real implementation, you'd want to use a proper prompt library
      console.log("Use --yes flag to confirm: atomcli memory clear --yes\n")
      return
    }
    
    const userProfile = getUserProfile()
    const preferences = getPreferencesService()
    
    await userProfile.initialize()
    await preferences.initialize()
    
    await preferences.clear()
    
    console.log("\n✅ Memory cleared successfully.\n")
    
  } catch (error) {
    log.error("Failed to clear memory", { error })
    console.error("❌ Failed to clear memory:", error)
  }
}

async function exportMemory(outputPath?: string) {
  try {
    const userProfile = getUserProfile()
    const preferences = getPreferencesService()
    
    await userProfile.initialize()
    await preferences.initialize()
    
    const profile = await userProfile.getProfile()
    const prefsData = await preferences.export()
    
    const exportData = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      profile,
      preferences: JSON.parse(prefsData),
    }
    
    const json = JSON.stringify(exportData, null, 2)
    
    if (outputPath) {
      await Bun.write(outputPath, json)
      console.log(`\n✅ Memory exported to: ${outputPath}\n`)
    } else {
      console.log("\n" + json + "\n")
    }
    
  } catch (error) {
    log.error("Failed to export memory", { error })
    console.error("❌ Failed to export memory:", error)
  }
}
