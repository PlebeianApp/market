## Context

Repo: ~/repos/market
PR #1150: perf/auction-query-parallelize-v2 → auctions

## Problem
PR #1150 has 0 files changed, 0 additions, 0 deletions. The entire implementation was reverted after maximotodev's review. The branch tree now matches the base. maximotodev confirmed: "PR now has no net changes... title and description no longer describe the live diff."

## Task

1. Close the PR with a clear comment:
```
gh pr close 1150 --repo PlebeianApp/market --comment "Closing — the performance optimization was fully reverted per @maximotodev's review feedback (composite query introduced regressions). The branch now matches the base with 0 net changes. If we revisit auction query parallelization, it should follow maximotodev's guidance: settlement-specific concurrency with dedicated tests, not route-level composite."
```

2. Delete the remote branch:
```
git push fork --delete perf/auction-query-parallelize-v2
```

3. Delete the local branch:
```
git branch -D perf/auction-query-parallelize-v2
```

## CRITICAL RULES
- Do NOT touch any other PRs or branches
- Report the PR close confirmation
