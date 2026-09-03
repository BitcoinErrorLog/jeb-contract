# Staging fixtures

Recorded **2026-09-03** from `https://nexus.staging.pubky.app` (read-only).

Source user (notifications page with both `mention` and `reply`): `operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo`

Refresh:

```
npm run record-fixtures
```

Files:

- `notifications.json` — `GET /v0/user/{id}/notifications?limit=50`
- `post.json` — `GET /v0/post/{author}/{id}` for a mentioned post
- `post_details.json` — `GET /v0/post/{author}/{id}/details` (flat details object, including `lock`)
- `post_replies.json` — `GET /v0/stream/posts?source=post_replies&author_id=&post_id=`
- `user.json` — `GET /v0/user/{id}`
- `user_details.json` — `GET /v0/user/{id}/details`
