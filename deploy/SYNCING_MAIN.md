# Syncing `main` into `release/test`

`main` remains the Node-only product branch. `release/test` adds the Python control plane and Docker deployment without rewriting the stock business logic.

Recommended sync flow:

```bash
git fetch origin
git switch release/test
git diff --name-status $(jq -r .lastMergedMainSha .release-sync/main.json)..origin/main
git merge origin/main
```

After resolving conflicts and testing, update `.release-sync/main.json`:

```bash
git rev-parse origin/main
```

Set `lastMergedMainSha` to that value and commit the sync.

Areas that usually need adaptation after a main merge:

- New `app/api/**` routes may need auth or billing checks.
- New cron routes should be added to `cron_jobs`.
- New database tables should be added to `services/api/migrations/postgres`.
- Changes to `next.config.mjs`, `package.json`, and `.github/workflows/**` should be reviewed carefully.
