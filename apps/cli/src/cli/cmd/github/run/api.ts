import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"
import * as core from "@actions/core"
import { AGENT_REACTION, AGENT_USERNAME } from "../constants"
import type { IssueQueryResponse, PullRequestQueryResponse } from "../types"

export async function getOidcToken() {
    try {
        return await core.getIDToken("atomcli-github-action")
    } catch (error) {
        console.error("Failed to get OIDC token:", error)
        throw new Error(
            "Could not fetch an OIDC token. Make sure to add `id-token: write` to your workflow permissions.",
        )
    }
}

export async function exchangeForAppToken(token: string, oidcBaseUrl: string, owner: string, repo: string) {
    const response = token.startsWith("github_pat_")
        ? await fetch(`${oidcBaseUrl}/exchange_github_app_token_with_pat`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ owner, repo }),
        })
        : await fetch(`${oidcBaseUrl}/exchange_github_app_token`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })

    if (!response.ok) {
        const responseJson = (await response.json()) as { error?: string }
        throw new Error(
            `App token exchange failed: ${response.status} ${response.statusText} - ${responseJson.error}`,
        )
    }

    const responseJson = (await response.json()) as { token: string }
    return responseJson.token
}

export async function revokeAppToken(appToken: string | undefined) {
    if (!appToken) return

    await fetch("https://api.github.com/installation/token", {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${appToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    })
}

export async function assertPermissions(octoRest: Octokit, owner: string, repo: string, actor: string) {
    // Only called for non-schedule events, so actor is defined
    console.log(`Asserting permissions for user ${actor}...`)

    let permission
    try {
        const response = await octoRest.repos.getCollaboratorPermissionLevel({
            owner,
            repo,
            username: actor,
        })

        permission = response.data.permission
        console.log(`  permission: ${permission}`)
    } catch (error) {
        console.error(`Failed to check permissions: ${error}`)
        throw new Error(`Failed to check permissions for user ${actor}: ${error}`)
    }

    if (!["admin", "write"].includes(permission)) throw new Error(`User ${actor} does not have write permissions`)
}

export async function addReaction(
    octoRest: Octokit,
    owner: string,
    repo: string,
    issueId: number,
    triggerCommentId?: number,
    commentType?: "issue" | "pr_review",
) {
    console.log("Adding reaction...")
    if (triggerCommentId) {
        if (commentType === "pr_review") {
            return await octoRest.rest.reactions.createForPullRequestReviewComment({
                owner,
                repo,
                comment_id: triggerCommentId,
                content: AGENT_REACTION,
            })
        }
        return await octoRest.rest.reactions.createForIssueComment({
            owner,
            repo,
            comment_id: triggerCommentId,
            content: AGENT_REACTION,
        })
    }
    return await octoRest.rest.reactions.createForIssue({
        owner,
        repo,
        issue_number: issueId,
        content: AGENT_REACTION,
    })
}

export async function removeReaction(
    octoRest: Octokit,
    owner: string,
    repo: string,
    issueId: number,
    triggerCommentId?: number,
    commentType?: "issue" | "pr_review",
) {
    console.log("Removing reaction...")
    if (triggerCommentId) {
        if (commentType === "pr_review") {
            const reactions = await octoRest.rest.reactions.listForPullRequestReviewComment({
                owner,
                repo,
                comment_id: triggerCommentId,
                content: AGENT_REACTION,
            })

            const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
            if (!eyesReaction) return

            return await octoRest.rest.reactions.deleteForPullRequestComment({
                owner,
                repo,
                comment_id: triggerCommentId,
                reaction_id: eyesReaction.id,
            })
        }

        const reactions = await octoRest.rest.reactions.listForIssueComment({
            owner,
            repo,
            comment_id: triggerCommentId,
            content: AGENT_REACTION,
        })

        const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
        if (!eyesReaction) return

        return await octoRest.rest.reactions.deleteForIssueComment({
            owner,
            repo,
            comment_id: triggerCommentId,
            reaction_id: eyesReaction.id,
        })
    }

    const reactions = await octoRest.rest.reactions.listForIssue({
        owner,
        repo,
        issue_number: issueId,
        content: AGENT_REACTION,
    })

    const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
    if (!eyesReaction) return

    await octoRest.rest.reactions.deleteForIssue({
        owner,
        repo,
        issue_number: issueId,
        reaction_id: eyesReaction.id,
    })
}

export async function createComment(
    octoRest: Octokit,
    owner: string,
    repo: string,
    issueId: number,
    body: string,
) {
    console.log("Creating comment...")
    return await octoRest.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueId,
        body,
    })
}

export async function createPR(
    octoRest: Octokit,
    owner: string,
    repo: string,
    base: string,
    branch: string,
    title: string,
    body: string,
) {
    console.log("Creating pull request...")

    try {
        const existing = await withRetry(() =>
            octoRest.rest.pulls.list({
                owner,
                repo,
                head: `${owner}:${branch}`,
                base,
                state: "open",
            }),
        )

        if (existing.data.length > 0) {
            console.log(`PR #${existing.data[0].number} already exists for branch ${branch}`)
            return existing.data[0].number
        }
    } catch (e) {
        console.log(`Failed to check for existing PR: ${e}`)
    }

    const pr = await withRetry(() =>
        octoRest.rest.pulls.create({
            owner,
            repo,
            head: branch,
            base,
            title,
            body,
        }),
    )
    return pr.data.number
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 5000): Promise<T> {
    try {
        return await fn()
    } catch (e) {
        if (retries > 0) {
            console.log(`Retrying after ${delayMs}ms...`)
            await Bun.sleep(delayMs)
            return withRetry(fn, retries - 1, delayMs)
        }
        throw e
    }
}

export async function fetchRepo(octoRest: Octokit, owner: string, repo: string) {
    return await octoRest.rest.repos.get({ owner, repo })
}

export async function fetchIssue(octoGraph: typeof graphql, owner: string, repo: string, issueId: number) {
    console.log("Fetching prompt data for issue...")
    const issueResult = await octoGraph<IssueQueryResponse>(
        `
query($owner: String!, $repo: String!, $number: Int!) {
repository(owner: $owner, name: $repo) {
  issue(number: $number) {
    title
    body
    author {
      login
    }
    createdAt
    state
    comments(first: 100) {
      nodes {
        id
        databaseId
        body
        author {
          login
        }
        createdAt
      }
    }
  }
}
}`,
        {
            owner,
            repo,
            number: issueId,
        },
    )

    const issue = issueResult.repository.issue
    if (!issue) throw new Error(`Issue #${issueId} not found`)

    return issue
}

export async function fetchPR(octoGraph: typeof graphql, owner: string, repo: string, issueId: number) {
    console.log("Fetching prompt data for PR...")
    const prResult = await octoGraph<PullRequestQueryResponse>(
        `
query($owner: String!, $repo: String!, $number: Int!) {
repository(owner: $owner, name: $repo) {
  pullRequest(number: $number) {
    title
    body
    author {
      login
    }
    baseRefName
    headRefName
    headRefOid
    createdAt
    additions
    deletions
    state
    baseRepository {
      nameWithOwner
    }
    headRepository {
      nameWithOwner
    }
    commits(first: 100) {
      totalCount
      nodes {
        commit {
          oid
          message
          author {
            name
            email
          }
        }
      }
    }
    files(first: 100) {
      nodes {
        path
        additions
        deletions
        changeType
      }
    }
    comments(first: 100) {
      nodes {
        id
        databaseId
        body
        author {
          login
        }
        createdAt
      }
    }
    reviews(first: 100) {
      nodes {
        id
        databaseId
        author {
          login
        }
        body
        state
        submittedAt
        comments(first: 100) {
          nodes {
            id
            databaseId
            body
            path
            line
            author {
              login
            }
            createdAt
          }
        }
      }
    }
  }
}
}`,
        {
            owner,
            repo,
            number: issueId,
        },
    )

    const pr = prResult.repository.pullRequest
    if (!pr) throw new Error(`PR #${issueId} not found`)

    return pr
}
