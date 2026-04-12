import { graphql } from "@octokit/graphql"
import { Octokit } from "@octokit/rest"
import * as core from "@actions/core"
import * as github from "@actions/github"
import type { Context } from "@actions/github/lib/context"
import type {
    IssueCommentEvent,
    IssuesEvent,
    PullRequestReviewCommentEvent,
    WorkflowDispatchEvent,
    WorkflowRunEvent,
    PullRequestEvent,
} from "@octokit/webhooks-types"
import { cmd } from "../../cmd"
import { bootstrap } from "../../../bootstrap"
import { Session } from "../../../../session"
import { $ } from "bun"
import { REPO_EVENTS, type RepoEvent, SUPPORTED_EVENTS, USER_EVENTS, type UserEvent } from "../types"
import * as env from "./env"
import * as git from "./git"
import * as api from "./api"
import * as agent from "./agent"

export const GithubRunCommand = cmd({
    command: "run",
    describe: "run the GitHub agent",
    builder: (yargs) =>
        yargs
            .option("event", {
                type: "string",
                describe: "GitHub mock event to run the agent for",
            })
            .option("token", {
                type: "string",
                describe: "GitHub personal access token (github_pat_********)",
            }),
    async handler(args) {
        await bootstrap(process.cwd(), async () => {
            const isMock = args.token || args.event

            const context = isMock ? (JSON.parse(args.event!) as Context) : github.context
            if (!SUPPORTED_EVENTS.includes(context.eventName as (typeof SUPPORTED_EVENTS)[number])) {
                core.setFailed(`Unsupported event type: ${context.eventName}`)
                process.exit(1)
            }

            // Determine event category for routing
            const isUserEvent = USER_EVENTS.includes(context.eventName as UserEvent)
            const isRepoEvent = REPO_EVENTS.includes(context.eventName as RepoEvent)
            const isCommentEvent = ["issue_comment", "pull_request_review_comment"].includes(context.eventName)
            const isIssuesEvent = context.eventName === "issues"
            const isScheduleEvent = context.eventName === "schedule"
            const isWorkflowDispatchEvent = context.eventName === "workflow_dispatch"

            const { providerID, modelID } = env.normalizeModel()
            const runId = env.normalizeRunId()
            const share = env.normalizeShare()
            const oidcBaseUrl = env.normalizeOidcBaseUrl()
            const { owner, repo } = context.repo
            const payload = context.payload as
                | IssueCommentEvent
                | IssuesEvent
                | PullRequestReviewCommentEvent
                | WorkflowDispatchEvent
                | WorkflowRunEvent
                | PullRequestEvent
            const issueEvent = isIssueCommentEvent(payload) ? payload : undefined
            const actor = isScheduleEvent ? undefined : context.actor

            const issueId = isRepoEvent
                ? undefined
                : context.eventName === "issue_comment" || context.eventName === "issues"
                    ? (payload as IssueCommentEvent | IssuesEvent).issue.number
                    : (payload as PullRequestEvent | PullRequestReviewCommentEvent).pull_request.number
            const runUrl = `/${owner}/${repo}/actions/runs/${runId}`
            const shareBaseUrl = isMock ? "https://dev.atomcli.ai" : "https://atomcli.ai"

            let appToken: string
            let octoRest: Octokit
            let octoGraph: typeof graphql
            let gitConfig: string | undefined
            let session: { id: string; title: string; version: string }
            let shareId: string | undefined
            let exitCode = 0

            const triggerCommentId = isCommentEvent
                ? (payload as IssueCommentEvent | PullRequestReviewCommentEvent).comment.id
                : undefined
            const useGithubToken = env.normalizeUseGithubToken()
            const commentType = isCommentEvent
                ? context.eventName === "pull_request_review_comment"
                    ? "pr_review"
                    : "issue"
                : undefined

            try {
                if (useGithubToken) {
                    const githubToken = process.env["GITHUB_TOKEN"]
                    if (!githubToken) {
                        throw new Error(
                            "GITHUB_TOKEN environment variable is not set. When using use_github_token, you must provide GITHUB_TOKEN.",
                        )
                    }
                    appToken = githubToken
                } else {
                    const actionToken = isMock ? args.token! : await api.getOidcToken()
                    appToken = await api.exchangeForAppToken(actionToken, oidcBaseUrl, owner, repo)
                }
                octoRest = new Octokit({ auth: appToken })
                octoGraph = graphql.defaults({
                    headers: { authorization: `token ${appToken}` },
                })

                function getReviewCommentContext() {
                    if (context.eventName !== "pull_request_review_comment") return null
                    const reviewPayload = payload as PullRequestReviewCommentEvent
                    return {
                        file: reviewPayload.comment.path,
                        diffHunk: reviewPayload.comment.diff_hunk,
                        line: reviewPayload.comment.line,
                        originalLine: reviewPayload.comment.original_line,
                        position: reviewPayload.comment.position,
                        commitId: reviewPayload.comment.commit_id,
                        originalCommitId: reviewPayload.comment.original_commit_id,
                    }
                }

                const { userPrompt, promptFiles } = await agent.getUserPrompt(
                    appToken,
                    context.eventName,
                    isRepoEvent,
                    isIssuesEvent,
                    isCommentEvent,
                    payload,
                    getReviewCommentContext
                )

                if (!useGithubToken) {
                    gitConfig = await git.configureGit(appToken, !!isMock)
                }

                if (isUserEvent && actor) {
                    await api.assertPermissions(octoRest, owner, repo, actor)
                    if (issueId) {
                        await api.addReaction(octoRest, owner, repo, issueId, triggerCommentId, commentType)
                    }
                }

                // Setup atomcli session
                const repoData = await api.fetchRepo(octoRest, owner, repo)
                session = await Session.create({
                    permission: [
                        {
                            permission: "question",
                            action: "deny",
                            pattern: "*",
                        },
                    ],
                })
                agent.subscribeSessionEvents(session.id)
                shareId = await (async () => {
                    if (share === false) return
                    if (!share && repoData.data.private) return
                    await Session.share(session.id)
                    return session.id.slice(-8)
                })()
                console.log("atomcli session", session.id)

                if (isRepoEvent) {
                    // Repo event
                    if (isWorkflowDispatchEvent && actor) {
                        console.log(`Triggered by: ${actor}`)
                    }
                    const branchPrefix = isWorkflowDispatchEvent ? "dispatch" : "schedule"
                    const branch = await git.checkoutNewBranch(branchPrefix, issueId)
                    const head = (await $`git rev-parse HEAD`).stdout.toString().trim()

                    const response = await agent.chat(session, providerID, modelID, userPrompt, promptFiles)
                    const { dirty, uncommittedChanges } = await git.branchIsDirty(head)
                    if (dirty) {
                        const summary = await agent.summarize(session, providerID, modelID, response, "Automated update")
                        await git.pushToNewBranch(summary, branch, uncommittedChanges, isScheduleEvent, actor)
                        const triggerType = isWorkflowDispatchEvent ? "workflow_dispatch" : "scheduled workflow"
                        const pr = await api.createPR(
                            octoRest,
                            owner,
                            repo,
                            repoData.data.default_branch,
                            branch,
                            summary,
                            `${response}\n\nTriggered by ${triggerType}${footer({ image: true })}`,
                        )
                        console.log(`Created PR #${pr}`)
                    } else {
                        console.log("Response:", response)
                    }
                } else if (
                    ["pull_request", "pull_request_review_comment"].includes(context.eventName) ||
                    issueEvent?.issue.pull_request
                ) {
                    if (!issueId) throw new Error("No issue ID found")
                    const prData = await api.fetchPR(octoGraph, owner, repo, issueId)
                    // Local PR
                    if (prData.headRepository.nameWithOwner === prData.baseRepository.nameWithOwner) {
                        await git.checkoutLocalBranch(prData)
                        const head = (await $`git rev-parse HEAD`).stdout.toString().trim()
                        const dataPrompt = agent.buildPromptDataForPR(prData, triggerCommentId)
                        const response = await agent.chat(session, providerID, modelID, `${userPrompt}\n\n${dataPrompt}`, promptFiles)
                        const { dirty, uncommittedChanges } = await git.branchIsDirty(head)
                        if (dirty) {
                            const summary = await agent.summarize(session, providerID, modelID, response, prData.title)
                            await git.pushToLocalBranch(summary, uncommittedChanges, actor)
                        }
                        const hasShared = prData.comments.nodes.some((c) => c.body.includes(`${shareBaseUrl}/s/${shareId}`))
                        await api.createComment(octoRest, owner, repo, issueId, `${response}${footer({ image: !hasShared })}`)
                        await api.removeReaction(octoRest, owner, repo, issueId, triggerCommentId, commentType)
                    }
                    // Fork PR
                    else {
                        await git.checkoutForkBranch(prData, issueId)
                        const head = (await $`git rev-parse HEAD`).stdout.toString().trim()
                        const dataPrompt = agent.buildPromptDataForPR(prData, triggerCommentId)
                        const response = await agent.chat(session, providerID, modelID, `${userPrompt}\n\n${dataPrompt}`, promptFiles)
                        const { dirty, uncommittedChanges } = await git.branchIsDirty(head)
                        if (dirty) {
                            const summary = await agent.summarize(session, providerID, modelID, response, prData.title)
                            await git.pushToForkBranch(summary, prData, uncommittedChanges, actor)
                        }
                        const hasShared = prData.comments.nodes.some((c) => c.body.includes(`${shareBaseUrl}/s/${shareId}`))
                        await api.createComment(octoRest, owner, repo, issueId, `${response}${footer({ image: !hasShared })}`)
                        await api.removeReaction(octoRest, owner, repo, issueId, triggerCommentId, commentType)
                    }
                }
                // Issue
                else {
                    if (!issueId) throw new Error("No issue ID found")
                    const branch = await git.checkoutNewBranch("issue", issueId)
                    const head = (await $`git rev-parse HEAD`).stdout.toString().trim()
                    const issueData = await api.fetchIssue(octoGraph, owner, repo, issueId)
                    const dataPrompt = agent.buildPromptDataForIssue(issueData, triggerCommentId)
                    const response = await agent.chat(session, providerID, modelID, `${userPrompt}\n\n${dataPrompt}`, promptFiles)
                    const { dirty, uncommittedChanges } = await git.branchIsDirty(head)
                    if (dirty) {
                        const summary = await agent.summarize(session, providerID, modelID, response, issueData.title)
                        await git.pushToNewBranch(summary, branch, uncommittedChanges, false, actor)
                        const pr = await api.createPR(
                            octoRest,
                            owner,
                            repo,
                            repoData.data.default_branch,
                            branch,
                            summary,
                            `${response}\n\nCloses #${issueId}${footer({ image: true })}`,
                        )
                        await api.createComment(octoRest, owner, repo, issueId, `Created PR #${pr}${footer({ image: true })}`)
                        await api.removeReaction(octoRest, owner, repo, issueId, triggerCommentId, commentType)
                    } else {
                        await api.createComment(octoRest, owner, repo, issueId, `${response}${footer({ image: true })}`)
                        await api.removeReaction(octoRest, owner, repo, issueId, triggerCommentId, commentType)
                    }
                }
            } catch (e: any) {
                exitCode = 1
                console.error(e)
                let msg = e
                if (e instanceof $.ShellError) {
                    msg = e.stderr.toString()
                } else if (e instanceof Error) {
                    msg = e.message
                }
                if (isUserEvent && issueId) {
                    await api.createComment(octoRest!, owner, repo, issueId, `${msg}${footer()}`)
                    await api.removeReaction(octoRest!, owner, repo, issueId, triggerCommentId, commentType)
                }
                core.setFailed(msg)
            } finally {
                if (!useGithubToken) {
                    await git.restoreGitConfig(gitConfig)
                    await api.revokeAppToken(appToken!)
                }
            }
            process.exit(exitCode)

            function footer(opts?: { image?: boolean }) {
                const image = (() => {
                    if (!shareId) return ""
                    if (!opts?.image) return ""

                    const titleAlt = encodeURIComponent(session.title.substring(0, 50))
                    const title64 = Buffer.from(session.title.substring(0, 700), "utf8").toString("base64")

                    return `<a href="${shareBaseUrl}/s/${shareId}"><img width="200" alt="${titleAlt}" src="https://social-cards.sst.dev/atomcli-share/${title64}.png?model=${providerID}/${modelID}&version=${session.version}&id=${shareId}" /></a>\n`
                })()
                const shareUrl = shareId ? `[atomcli session](${shareBaseUrl}/s/${shareId})&nbsp;&nbsp;|&nbsp;&nbsp;` : ""
                return `\n\n${image}${shareUrl}[github run](${runUrl})`
            }

            function isIssueCommentEvent(
                event:
                    | IssueCommentEvent
                    | IssuesEvent
                    | PullRequestReviewCommentEvent
                    | WorkflowDispatchEvent
                    | WorkflowRunEvent
                    | PullRequestEvent,
            ): event is IssueCommentEvent {
                return "issue" in event && "comment" in event
            }
        })
    },
})
