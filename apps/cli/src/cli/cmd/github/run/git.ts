import { $ } from "bun"
import { AGENT_USERNAME } from "../constants"
import type { GitHubPullRequest } from "../types"

export async function configureGit(appToken: string, isMock: boolean) {
    // Do not change git config when running locally
    if (isMock) return

    console.log("Configuring git...")
    const config = "http.https://github.com/.extraheader"
    // actions/checkout@v6 no longer stores credentials in .git/config,
    // so this may not exist - use nothrow() to handle gracefully
    const ret = await $`git config --local --get ${config}`.nothrow()
    let gitConfig: string | undefined
    if (ret.exitCode === 0) {
        gitConfig = ret.stdout.toString().trim()
        await $`git config --local --unset-all ${config}`
    }

    const newCredentials = Buffer.from(`x-access-token:${appToken}`, "utf8").toString("base64")

    await $`git config --local ${config} "AUTHORIZATION: basic ${newCredentials}"`
    await $`git config --global user.name "${AGENT_USERNAME}"`
    await $`git config --global user.email "${AGENT_USERNAME}@users.noreply.github.com"`

    return gitConfig
}

export async function restoreGitConfig(gitConfig?: string) {
    if (gitConfig === undefined) return
    const config = "http.https://github.com/.extraheader"
    await $`git config --local ${config} "${gitConfig}"`
}

export async function checkoutNewBranch(type: "issue" | "schedule" | "dispatch", issueId: number | undefined) {
    console.log("Checking out new branch...")
    const branch = generateBranchName(type, issueId)
    await $`git checkout -b ${branch}`
    return branch
}

export async function checkoutLocalBranch(pr: GitHubPullRequest) {
    console.log("Checking out local branch...")

    const branch = pr.headRefName
    const depth = Math.max(pr.commits.totalCount, 20)

    await $`git fetch origin --depth=${depth} ${branch}`
    await $`git checkout ${branch}`
}

export async function checkoutForkBranch(pr: GitHubPullRequest, issueId: number | undefined) {
    console.log("Checking out fork branch...")

    const remoteBranch = pr.headRefName
    const localBranch = generateBranchName("pr", issueId)
    const depth = Math.max(pr.commits.totalCount, 20)

    await $`git remote add fork https://github.com/${pr.headRepository.nameWithOwner}.git`
    await $`git fetch fork --depth=${depth} ${remoteBranch}`
    await $`git checkout -b ${localBranch} fork/${remoteBranch}`
}

export function generateBranchName(type: "issue" | "pr" | "schedule" | "dispatch", issueId: number | undefined) {
    const timestamp = new Date()
        .toISOString()
        .replace(/[:-]/g, "")
        .replace(/\.\d{3}Z/, "")
        .split("T")
        .join("")
    if (type === "schedule" || type === "dispatch") {
        const hex = crypto.randomUUID().slice(0, 6)
        return `atomcli/${type}-${hex}-${timestamp}`
    }
    return `atomcli/${type}${issueId}-${timestamp}`
}

export async function pushToNewBranch(
    summary: string,
    branch: string,
    commit: boolean,
    isSchedule: boolean,
    actor?: string,
) {
    console.log("Pushing to new branch...")
    if (commit) {
        await $`git add .`
        if (isSchedule) {
            // No co-author for scheduled events - the schedule is operating as the repo
            await $`git commit -m "${summary}"`
        } else {
            await $`git commit -m "${summary}

Co-authored-by: ${actor} <${actor}@users.noreply.github.com>"`
        }
    }
    await $`git push -u origin ${branch}`
}

export async function pushToLocalBranch(summary: string, commit: boolean, actor?: string) {
    console.log("Pushing to local branch...")
    if (commit) {
        await $`git add .`
        await $`git commit -m "${summary}

Co-authored-by: ${actor} <${actor}@users.noreply.github.com>"`
    }
    await $`git push`
}

export async function pushToForkBranch(summary: string, pr: GitHubPullRequest, commit: boolean, actor?: string) {
    console.log("Pushing to fork branch...")

    const remoteBranch = pr.headRefName

    if (commit) {
        await $`git add .`
        await $`git commit -m "${summary}

Co-authored-by: ${actor} <${actor}@users.noreply.github.com>"`
    }
    await $`git push fork HEAD:${remoteBranch}`
}

export async function branchIsDirty(originalHead: string) {
    console.log("Checking if branch is dirty...")
    const ret = await $`git status --porcelain`
    const status = ret.stdout.toString().trim()
    if (status.length > 0) {
        return {
            dirty: true,
            uncommittedChanges: true,
        }
    }
    const head = await $`git rev-parse HEAD`
    return {
        dirty: head.stdout.toString().trim() !== originalHead,
        uncommittedChanges: false,
    }
}
