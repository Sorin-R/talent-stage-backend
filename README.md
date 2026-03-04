# Talents Stage — TypeScript + MySQL Backend

A full REST API for the Talents Stage video-sharing platform.  
Built with **Express**, **TypeScript**, **MySQL 8**, and **Multer** (video uploads).

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Language | TypeScript 5 |
| Framework | Express 4 |
| Database | MySQL 8 |
| ORM/Driver | mysql2 (promise pool) |
| Auth | JWT (jsonwebtoken + bcryptjs) |
| File uploads | Multer (disk storage) |
| Env config | dotenv |

---

## Quick Start

### 1. Prerequisites
- Node.js ≥ 18
- MySQL 8 running locally (or Docker)
- A MySQL user with `CREATE DATABASE` privileges

### 2. Install
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env — set DB_PASSWORD, JWT_SECRET, etc.
```

### 4. Create tables
```bash
npm run db:migrate
```

### 5. (Optional) Seed demo data
```bash
npm run db:seed
# Demo login: john@example.com / Password123!
```

### 6. Start development server
```bash
npm run dev
# → http://localhost:3000
```

### 7. Build for production
```bash
npm run build
npm start
```

### 8. Seed fake users + bulk video uploads (testing)
Use this only on local/staging.

1) Optional: generate videos from photos in `seed/images`:
```bash
npm run seed:make-videos -- --input-dir ./seed/images --output-dir ./seed/videos --count 1000
```
Supported image inputs: `.jpg .jpeg .png .webp .heic .heif` (HEIC/HEIF uses macOS fallback when needed).

2) Put your source videos in:
```bash
seed/videos
```
Supports nested folders and these extensions:
`.mp4 .mov .webm .mkv .avi .mpeg .mpg .3gp .ogg`

3) Run a small proof test first:
```bash
npm run seed:load:test
```

4) Run the full 1000-upload batch:
```bash
npm run seed:load:1000 -- --video-dir ./seed/videos
```

You can also run custom values:
```bash
npm run seed:load -- --video-dir ./seed/videos --videos 250 --users 20 --concurrency 3
```

The script output report is saved to:
```bash
seed-output/seed-video-load-<runTag>.json
```

Important notes:
- Script creates users like `testuser_<runTag>_<index>@seed.local`.
- Default password for seeded users is `Password123!` (override with `--password`).
- Each upload goes through real API validation and upload pipeline.
- By default, it blocks `uploads/videos` as source folder. Use your own source folder.
- By default, it blocks source reuse (`--videos` cannot exceed number of source files).
- Override only if intentional: `--allow-uploads-source` and/or `--allow-repeat-source`.

---

## Project Structure

```
src/
├── config/
│   ├── database.ts     # mysql2 connection pool
│   ├── migrate.ts      # DDL — creates all tables
│   └── seed.ts         # demo data
├── controllers/
│   ├── authController.ts
│   ├── videoController.ts
│   ├── commentController.ts
│   └── userController.ts
├── middleware/
│   ├── auth.ts         # JWT authenticate / optionalAuth
│   ├── upload.ts       # Multer config (video, image, avatar)
│   └── errorHandler.ts
├── models/
│   └── types.ts        # TypeScript interfaces
├── routes/
│   ├── auth.ts
│   ├── videos.ts
│   └── users.ts
└── server.ts           # Express app + startup
```

---

## Database Schema

```
users            — accounts
videos           — uploaded videos (links to file on disk)
follows          — follower ↔ following
saved_videos     — bookmarked videos per user
shared_videos    — share history per user + platform
video_likes      — like / dislike per user per video
comments         — threaded comments on videos
refresh_tokens   — (reserved for future refresh-token flow)
```

---

## API Reference

All endpoints return:
```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": "message" }
```

### Auth
```
POST  /api/auth/register    { username, email, password, full_name?, phone?, talent_type? }
POST  /api/auth/login       { email, password }
GET   /api/auth/me          🔒 → current user
PUT   /api/auth/me          🔒 { full_name, phone, bio, talent_type }
DELETE /api/auth/me         🔒 → delete account
```

### Videos
```
GET    /api/videos                  ?talent_type=Dancer&search=kw&page=1&limit=20
POST   /api/videos           🔒     multipart/form-data:
                                      video       (required, ≤ 500 MB)
                                      thumbnail   (optional image)
                                      title       (required)
                                      description
                                      tags        (comma-separated or JSON array)
                                      talent_type
                                      is_public   (1/0, default 1)
GET    /api/videos/saved     🔒     → my saved videos
GET    /api/videos/shared    🔒     → my shared videos
GET    /api/videos/user/:id         → videos by user
GET    /api/videos/:id              → single video + increments views
PUT    /api/videos/:id       🔒     → update title / description / tags
DELETE /api/videos/:id       🔒     → delete video + file from disk
POST   /api/videos/:id/like  🔒     → toggle like
POST   /api/videos/:id/dislike 🔒   → toggle dislike
POST   /api/videos/:id/save  🔒     → toggle save
POST   /api/videos/:id/share 🔒     { platform? }
```

### Comments
```
GET    /api/videos/:id/comments             ?page=&limit=
POST   /api/videos/:id/comments     🔒      { body }
DELETE /api/videos/:id/comments/:cid 🔒
```

### Users
```
GET  /api/users              ?talent_type=Singer&search=kw&page=&limit=
GET  /api/users/:id
POST /api/users/:id/follow   🔒 → toggle follow/unfollow
GET  /api/users/:id/followers
GET  /api/users/:id/following
PUT  /api/users/me/avatar    🔒  multipart: avatar (image)
```

🔒 = requires `Authorization: Bearer <token>` header

---

## Uploading a Video (example with curl)

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"Password123!"}' \
  | jq -r '.data.token')

# 2. Upload video + thumbnail
curl -X POST http://localhost:3000/api/videos \
  -H "Authorization: Bearer $TOKEN" \
  -F "video=@/path/to/your/video.mp4" \
  -F "thumbnail=@/path/to/thumb.jpg" \
  -F "title=My Awesome Dance" \
  -F "tags=dance,hiphop,freestyle" \
  -F "talent_type=Dancer"
```

The response includes `file_url` — a direct link to stream/download the video.

---

## Connecting the Frontend

In your frontend HTML, replace mock data calls with real API calls:

```js
// Example: load feed
const res = await fetch('http://localhost:3000/api/videos?talent_type=Dancer');
const { data } = await res.json();

// Example: upload video
const form = new FormData();
form.append('video', videoFile);
form.append('thumbnail', thumbFile);
form.append('title', 'My Video');
form.append('tags', 'dance,freestyle');

await fetch('http://localhost:3000/api/videos', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `root` | MySQL user |
| `DB_PASSWORD` | — | MySQL password |
| `DB_NAME` | `talents_stage` | Database name |
| `JWT_SECRET` | — | **Change in production!** |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `MAX_VIDEO_SIZE` | `524288000` | 500 MB |
| `MAX_IMAGE_SIZE` | `10485760` | 10 MB |
| `UPLOAD_DIR` | `uploads` | Upload directory |
| `ALLOWED_ORIGINS` | — | Comma-separated CORS origins |

---

## Production Notes

1. **Never commit `.env`** — it contains secrets.
2. **JWT_SECRET** must be a long random string (≥ 32 chars).
3. Store uploads on **S3 / Cloudflare R2** in production; swap Multer's disk storage for `multer-s3`.
4. Add **rate limiting** (`express-rate-limit`) on auth endpoints.
5. Run behind **nginx** as a reverse proxy and serve `/uploads` from nginx directly.
6. Use a **process manager** like PM2: `pm2 start dist/server.js --name talents-api`.
