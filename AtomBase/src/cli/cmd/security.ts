/**
 * Security Scanner Command
 * 
 * Scans code for security vulnerabilities, OWASP patterns, and hardcoded secrets.
 * Checks dependencies for known vulnerabilities.
 * 
 * Usage: atomcli security --scan
 */

import { cmd } from "./cmd"
import { Log } from "@/util/log"
import { Glob } from "@/tool/glob"
import { Read } from "@/tool/read"
import { Bash } from "@/tool/bash"
import path from "path"
import fs from "fs/promises"

export namespace SecurityScanner {
  const log = Log.create({ service: "security" })

  export interface ScanOptions {
    scan?: boolean
    fix?: boolean
    severity?: "low" | "medium" | "high" | "critical"
    files?: string[]
  }

  export interface SecurityIssue {
    id: string
    type: "secret" | "vulnerability" | "owasp" | "dependency"
    severity: "low" | "medium" | "high" | "critical"
    file: string
    line: number
    column?: number
    message: string
    description: string
    remediation: string
    cwe?: string
    owasp?: string
    cvss?: number
  }

  export interface ScanResult {
    issues: SecurityIssue[]
    summary: {
      total: number
      critical: number
      high: number
      medium: number
      low: number
      secrets: number
      vulnerabilities: number
      dependencies: number
    }
    scannedFiles: number
    duration: number
  }

  // OWASP Top 10 Patterns
  const OWASP_PATTERNS = [
    {
      id: "A01",
      name: "Broken Access Control",
      patterns: [
        /\.allow\s*:\s*true/,
        /cors\s*:\s*\{[^}]*origin\s*:\s*["']\*["']/,
        /disable.*security/i,
        /skip.*auth/i,
      ],
    },
    {
      id: "A02",
      name: "Cryptographic Failures",
      patterns: [
        /md5\s*\(/i,
        /sha1\s*\(/i,
        /des\s*\(/i,
        /rc4\s*\(/i,
        /createHash\s*\(\s*["']md5["']/,
        /createHash\s*\(\s*["']sha1["']/,
        /encrypt.*aes.*ecb/i,
        /\.skip.*tls/i,
        /rejectUnauthorized\s*:\s*false/,
      ],
    },
    {
      id: "A03",
      name: "Injection",
      patterns: [
        /eval\s*\(/,
        /new\s+Function\s*\(/,
        /exec\s*\([^)]*\$\{/,
        /query\s*\([^)]*\+[^)]*\)/,
        /innerHTML\s*=.*\$/,
        /dangerouslySetInnerHTML/,
      ],
    },
    {
      id: "A05",
      name: "Security Misconfiguration",
      patterns: [
        /debug\s*:\s*true/,
        /NODE_ENV\s*[=:]\s*["']development["']/,
        /\.env["']?\s*\.\s*example/,
        /default.*password/i,
        /admin.*admin/i,
      ],
    },
    {
      id: "A07",
      name: "Authentication Failures",
      patterns: [
        /password\s*[=:]\s*["'][^"']{1,7}["']/,
        /jwt\.sign\s*\([^)]*[^,]*\)/,
        /session\s*:\s*\{[^}]*secret\s*:/,
      ],
    },
  ]

  // Secret Detection Patterns
  const SECRET_PATTERNS = [
    {
      name: "AWS Access Key",
      pattern: /AKIA[0-9A-Z]{16}/,
      severity: "critical" as const,
    },
    {
      name: "AWS Secret Key",
      pattern: /["'][0-9a-zA-Z/+]{40}["']/,
      severity: "critical" as const,
    },
    {
      name: "Private Key",
      pattern: /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/,
      severity: "critical" as const,
    },
    {
      name: "API Key (Generic)",
      pattern: /["'](api[_-]?key|apikey)["']\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/i,
      severity: "high" as const,
    },
    {
      name: "Password in Code",
      pattern: /["'](password|passwd|pwd)["']\s*[:=]\s*["'][^"']{4,}["']/i,
      severity: "high" as const,
    },
    {
      name: "Database Connection String",
      pattern: /(mongodb|mysql|postgres|redis):\/\/[^\/\s:]+:[^@\s]+@/i,
      severity: "critical" as const,
    },
    {
      name: "GitHub Token",
      pattern: /gh[pousr]_[A-Za-z0-9_]{36}/,
      severity: "critical" as const,
    },
    {
      name: "Slack Token",
      pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}(-[a-zA-Z0-9]{24})?/,
      severity: "critical" as const,
    },
    {
      name: "JWT Token",
      pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/,
      severity: "high" as const,
    },
    {
      name: "Bearer Token",
      pattern: /["']Bearer\s+[a-zA-Z0-9_\-\.]{20,}["']/,
      severity: "high" as const,
    },
    {
      name: "OpenAI API Key",
      pattern: /sk-[a-zA-Z0-9]{48}/,
      severity: "critical" as const,
    },
    {
      name: "Stripe Key",
      pattern: /sk_live_[a-zA-Z0-9]{24,}/,
      severity: "critical" as const,
    },
  ]

  /**
   * Scan a single file for security issues
   */
  export async function scanFile(filePath: string): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = []
    const content = await fs.readFile(filePath, "utf-8")
    const lines = content.split("\n")

    // Skip binary and minified files
    if (isBinaryOrMinified(content)) {
      return issues
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNumber = i + 1

      // Check for secrets
      for (const secret of SECRET_PATTERNS) {
        const match = line.match(secret.pattern)
        if (match) {
          // Skip if it's in a comment explaining the pattern
          if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
            continue
          }

          issues.push({
            id: `SECRET-${issues.length + 1}`,
            type: "secret",
            severity: secret.severity,
            file: filePath,
            line: lineNumber,
            column: match.index,
            message: `Potential ${secret.name} detected`,
            description: `A potential ${secret.name} was found in the code. Hardcoded secrets pose a significant security risk.`,
            remediation: `Move the secret to an environment variable or use a secure secret management system.`,
          })
        }
      }

      // Check for OWASP patterns
      for (const owasp of OWASP_PATTERNS) {
        for (const pattern of owasp.patterns) {
          const match = line.match(pattern)
          if (match) {
            issues.push({
              id: `OWASP-${owasp.id}`,
              type: "owasp",
              severity: "high",
              file: filePath,
              line: lineNumber,
              column: match.index,
              message: `OWASP ${owasp.id}: ${owasp.name}`,
              description: `Code pattern matches OWASP ${owasp.id} - ${owasp.name}`,
              remediation: `Review and fix according to OWASP ${owasp.id} guidelines.`,
              owasp: owasp.id,
            })
          }
        }
      }
    }

    return issues
  }

  function isBinaryOrMinified(content: string): boolean {
    // Check for minified files (very long lines)
    const lines = content.split("\n")
    const longLines = lines.filter(l => l.length > 500)
    if (longLines.length > lines.length * 0.5) {
      return true
    }

    // Check for binary content
    const nullBytes = content.split("").filter(c => c === "\0").length
    if (nullBytes > 0) {
      return true
    }

    return false
  }

  /**
   * Scan dependencies for vulnerabilities
   */
  export async function scanDependencies(): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = []

    try {
      // Run npm audit
      const proc = Bun.spawn(["npm", "audit", "--json"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: process.cwd(),
      })

      const output = await new Response(proc.stdout).text()
      const result = JSON.parse(output)

      if (result.vulnerabilities) {
        for (const [pkgName, vuln] of Object.entries(result.vulnerabilities)) {
          const v = vuln as any
          if (v.severity && v.via) {
            for (const via of v.via) {
              if (typeof via === "object") {
                issues.push({
                  id: `DEP-${via.cwe || pkgName}`,
                  type: "dependency",
                  severity: mapSeverity(v.severity),
                  file: "package.json",
                  line: 0,
                  message: `Vulnerable dependency: ${pkgName}@${v.range}`,
                  description: via.title || `Vulnerability in ${pkgName}`,
                  remediation: `Update ${pkgName} to ${v.fixAvailable?.version || "latest"}`,
                  cwe: via.cwe,
                })
              }
            }
          }
        }
      }
    } catch (e) {
      log.warn("npm audit failed", { error: e })
    }

    return issues
  }

  function mapSeverity(severity: string): "low" | "medium" | "high" | "critical" {
    switch (severity.toLowerCase()) {
      case "critical": return "critical"
      case "high": return "high"
      case "moderate":
      case "medium": return "medium"
      default: return "low"
    }
  }

  /**
   * Run full security scan
   */
  export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
    const startTime = Date.now()
    const issues: SecurityIssue[] = []
    let scannedFiles = 0

    // Scan source files
    const glob = new Bun.Glob("**/*.{ts,js,tsx,jsx,mjs,cjs}")
    const excludePatterns = [
      "node_modules",
      "dist",
      "build",
      ".git",
      "*.test.",
      "*.spec.",
    ]

    for await (const file of glob.scan(".")) {
      // Skip excluded files
      if (excludePatterns.some(p => file.includes(p))) {
        continue
      }

      try {
        const fileIssues = await scanFile(file)
        issues.push(...fileIssues)
        scannedFiles++
      } catch (e) {
        log.warn("failed to scan file", { file, error: e })
      }
    }

    // Scan dependencies
    const depIssues = await scanDependencies()
    issues.push(...depIssues)

    // Calculate summary
    const summary = {
      total: issues.length,
      critical: issues.filter(i => i.severity === "critical").length,
      high: issues.filter(i => i.severity === "high").length,
      medium: issues.filter(i => i.severity === "medium").length,
      low: issues.filter(i => i.severity === "low").length,
      secrets: issues.filter(i => i.type === "secret").length,
      vulnerabilities: issues.filter(i => i.type === "vulnerability" || i.type === "owasp").length,
      dependencies: issues.filter(i => i.type === "dependency").length,
    }

    const duration = Date.now() - startTime

    return {
      issues,
      summary,
      scannedFiles,
      duration,
    }
  }

  /**
   * Generate security report
   */
  export function generateReport(result: ScanResult): string {
    let report = `# Security Scan Report\n\n`
    report += `Generated: ${new Date().toISOString()}\n`
    report += `Duration: ${result.duration}ms\n`
    report += `Files Scanned: ${result.scannedFiles}\n\n`

    report += `## Summary\n\n`
    report += `- **Total Issues:** ${result.summary.total}\n`
    report += `- **Critical:** ${result.summary.critical}\n`
    report += `- **High:** ${result.summary.high}\n`
    report += `- **Medium:** ${result.summary.medium}\n`
    report += `- **Low:** ${result.summary.low}\n`
    report += `- **Secrets Found:** ${result.summary.secrets}\n`
    report += `- **Vulnerabilities:** ${result.summary.vulnerabilities}\n`
    report += `- **Dependency Issues:** ${result.summary.dependencies}\n\n`

    if (result.issues.length === 0) {
      report += `## ✅ No security issues found!\n`
      return report
    }

    // Group issues by severity
    const bySeverity = {
      critical: result.issues.filter(i => i.severity === "critical"),
      high: result.issues.filter(i => i.severity === "high"),
      medium: result.issues.filter(i => i.severity === "medium"),
      low: result.issues.filter(i => i.severity === "low"),
    }

    for (const [severity, issues] of Object.entries(bySeverity)) {
      if (issues.length === 0) continue

      report += `## ${severity.toUpperCase()} Severity Issues (${issues.length})\n\n`

      for (const issue of issues) {
        report += `### ${issue.id}: ${issue.message}\n\n`
        report += `- **File:** ${issue.file}:${issue.line}\n`
        report += `- **Type:** ${issue.type}\n`
        if (issue.cwe) report += `- **CWE:** ${issue.cwe}\n`
        if (issue.owasp) report += `- **OWASP:** ${issue.owasp}\n`
        report += `\n**Description:** ${issue.description}\n\n`
        report += `**Remediation:** ${issue.remediation}\n\n`
        report += `---\n\n`
      }
    }

    return report
  }

  /**
   * Fix auto-fixable issues
   */
  export async function fixIssues(result: ScanResult): Promise<number> {
    let fixed = 0

    for (const issue of result.issues) {
      if (issue.type === "secret") {
        // Cannot auto-fix secrets - require manual intervention
        continue
      }

      // Add more auto-fix logic here as needed
    }

    return fixed
  }
}

/**
 * CLI Command Definition
 */
export const SecurityCommand = cmd({
  command: "security",
  describe: "Scan code for security vulnerabilities and secrets",
  builder: (yargs) =>
    yargs
      .option("scan", {
        type: "boolean",
        alias: "s",
        describe: "Run security scan",
        default: true,
      })
      .option("fix", {
        type: "boolean",
        alias: "f",
        describe: "Attempt to auto-fix issues",
        default: false,
      })
      .option("severity", {
        type: "string",
        choices: ["low", "medium", "high", "critical"],
        describe: "Minimum severity level to report",
        default: "low",
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Output file for report",
        default: "security-report.md",
      })
      .option("json", {
        type: "boolean",
        alias: "j",
        describe: "Output results as JSON",
        default: false,
      }),
  handler: async (args) => {
    const log = Log.create({ service: "security-cli" })

    try {
      console.log("🔒 Running security scan...\n")

      const result = await SecurityScanner.scan({
        scan: args.scan,
        fix: args.fix,
        severity: args.severity as "low" | "medium" | "high" | "critical" | undefined,
      })

      // Filter by severity if specified
      let filteredIssues = result.issues
      if (args.severity) {
        const severityOrder = ["low", "medium", "high", "critical"]
        const minIndex = severityOrder.indexOf(args.severity)
        filteredIssues = result.issues.filter(i => {
          return severityOrder.indexOf(i.severity) >= minIndex
        })
      }

      // Output results
      if (args.json) {
        console.log(JSON.stringify({
          ...result,
          issues: filteredIssues,
        }, null, 2))
      } else {
        const report = SecurityScanner.generateReport({
          ...result,
          issues: filteredIssues,
        })
        console.log(report)

        // Save report to file
        await fs.writeFile(args.output, report, "utf-8")
        console.log(`\n📄 Report saved to: ${args.output}`)
      }

      // Exit with error code if critical issues found
      const criticalCount = filteredIssues.filter(i => i.severity === "critical").length
      if (criticalCount > 0) {
        console.log(`\n❌ ${criticalCount} critical issues found!`)
        process.exit(1)
      }

      // Exit with error code if high issues found and not in fix mode
      const highCount = filteredIssues.filter(i => i.severity === "high").length
      if (highCount > 0 && !args.fix) {
        console.log(`\n⚠️  ${highCount} high severity issues found. Run with --fix to attempt auto-fix.`)
        process.exit(1)
      }

      // Attempt auto-fix
      if (args.fix) {
        const fixed = await SecurityScanner.fixIssues({ ...result, issues: filteredIssues })
        if (fixed > 0) {
          console.log(`\n🔧 Auto-fixed ${fixed} issues`)
        }
      }

      console.log("\n✅ Security scan complete!")

    } catch (error) {
      log.error("security scan failed", { error })
      console.error("Error:", error instanceof Error ? error.message : error)
      process.exit(1)
    }
  },
})
