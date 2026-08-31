import type {
  CheckState,
  DagDocument,
  GitHubBindingUpdate,
  PlanIssueBinding,
  PlanPullRequestBinding,
  ReviewState,
} from '@/app/plan-graph-demo/plan-graph-model'

interface GitHubIssueResponse {
  html_url: string
  number: number
  state: 'open' | 'closed'
}

interface GitHubPullRequestResponse {
  base: { sha: string }
  draft: boolean
  head: { sha: string }
  html_url: string
  mergeable: boolean | null
  merged_at: string | null
  number: number
  state: 'open' | 'closed'
}

interface GitHubCheckRunsResponse {
  check_runs: Array<{ conclusion: string | null; status: string }>
  total_count: number
}

interface GitHubReviewResponse {
  id: number
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  submitted_at: string | null
  user: { login: string } | null
}

function githubHeaders(): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** Reads public GitHub reconciliation state without forwarding Sim credentials. */
async function requestGitHub<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const response = await fetch(url, { headers: githubHeaders(), signal, cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (response.status === 403 && remaining === '0') {
      throw new Error('GitHub public API rate limit reached; retry after its reset window')
    }
    throw new Error(`GitHub reconciliation failed with HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export function resolveCheckState(response: GitHubCheckRunsResponse): CheckState {
  if (response.total_count === 0) return 'Pending'
  if (response.check_runs.some((run) => run.status !== 'completed' || !run.conclusion)) {
    return 'Running'
  }
  const passing = new Set(['success', 'neutral', 'skipped'])
  return response.check_runs.every((run) => passing.has(run.conclusion ?? '')) ? 'Passed' : 'Failed'
}

export function resolveReviewState(reviews: readonly GitHubReviewResponse[]): ReviewState {
  const latestByAuthor = new Map<string, GitHubReviewResponse>()
  for (const review of [...reviews].sort((left, right) => left.id - right.id)) {
    if (!review.user || ['COMMENTED', 'PENDING'].includes(review.state)) continue
    if (review.state === 'DISMISSED') latestByAuthor.delete(review.user.login)
    else latestByAuthor.set(review.user.login, review)
  }
  const states = [...latestByAuthor.values()].map((review) => review.state)
  if (states.includes('CHANGES_REQUESTED')) return 'Changes requested'
  return states.includes('APPROVED') ? 'Approved' : 'Pending'
}

function projectIssue(
  number: number,
  response: GitHubIssueResponse | null,
  repository: string
): PlanIssueBinding {
  if (!response) {
    return {
      number,
      state: 'Unknown',
      url: `https://github.com/${repository}/issues/${number}`,
    }
  }
  return {
    number: response.number,
    state: response.state === 'open' ? 'Open' : 'Closed',
    url: response.html_url,
  }
}

async function projectPullRequest(
  repository: string,
  number: number,
  response: GitHubPullRequestResponse | null,
  syncedAt: string,
  signal?: AbortSignal
): Promise<PlanPullRequestBinding> {
  if (!response) {
    return {
      number,
      state: 'Unopened',
      checks: 'Pending',
      review: 'Pending',
      url: `https://github.com/${repository}/pull/${number}`,
      syncedAt,
    }
  }
  const apiBase = `https://api.github.com/repos/${repository}`
  const [checks, reviews] = await Promise.all([
    requestGitHub<GitHubCheckRunsResponse>(
      `${apiBase}/commits/${encodeURIComponent(response.head.sha)}/check-runs`,
      signal
    ),
    requestGitHub<GitHubReviewResponse[]>(`${apiBase}/pulls/${number}/reviews`, signal),
  ])
  return {
    number: response.number,
    state: response.merged_at
      ? 'Merged'
      : response.state === 'closed'
        ? 'Closed'
        : response.draft
          ? 'Draft'
          : 'Open',
    checks: checks ? resolveCheckState(checks) : 'Pending',
    review: reviews ? resolveReviewState(reviews) : 'Pending',
    url: response.html_url,
    baseSha: response.base.sha,
    headSha: response.head.sha,
    mergeable: response.mergeable,
    syncedAt,
  }
}

/** Reads public GitHub state for each bound artifact without changing the authoritative graph. */
export async function reconcileDagWithGitHub(
  document: DagDocument,
  signal?: AbortSignal
): Promise<{ syncedAt: string; updates: GitHubBindingUpdate[] }> {
  const syncedAt = new Date().toISOString()
  const updates = await Promise.all(
    document.items.map(async (item): Promise<GitHubBindingUpdate> => {
      const repository = item.repository ?? document.repository
      const apiBase = `https://api.github.com/repos/${repository}`
      const [issue, pullRequest] = await Promise.all([
        item.issue.number
          ? requestGitHub<GitHubIssueResponse>(`${apiBase}/issues/${item.issue.number}`, signal)
          : Promise.resolve(null),
        item.primaryPr.number
          ? requestGitHub<GitHubPullRequestResponse>(
              `${apiBase}/pulls/${item.primaryPr.number}`,
              signal
            )
          : Promise.resolve(null),
      ])
      return {
        itemId: item.id,
        ...(item.issue.number ? { issue: projectIssue(item.issue.number, issue, repository) } : {}),
        ...(item.primaryPr.number
          ? {
              primaryPr: await projectPullRequest(
                repository,
                item.primaryPr.number,
                pullRequest,
                syncedAt,
                signal
              ),
            }
          : {}),
      }
    })
  )
  return { syncedAt, updates }
}
