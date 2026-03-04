import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { testConnection } from './config/database';
import { setupAdminTable } from './config/adminSetup';
import { setupEnhancedAdminTables } from './config/adminEnhancedSetup';
import { UPLOAD_DIR as RESOLVED_UPLOAD_DIR } from './middleware/upload';
import { isFeatureFlagEnabled } from './config/runtimeFlags';
import { purgeOverLimitVideos, ensureCycleColumns, purgeExpiredModerationHiddenVideos } from './controllers/videoController';
import { purgeExpiredModerationHiddenComments } from './controllers/commentController';
import authRoutes  from './routes/auth';
import videoRoutes from './routes/videos';
import userRoutes  from './routes/users';
import adminRoutes from './routes/admin';
import { errorHandler, notFound } from './middleware/errorHandler';

dotenv.config();

const app  = express();
const PORT = parseInt(process.env.PORT || '3000');
const MODERATION_HOLD_SWEEP_MS = parseInt(process.env.MODERATION_HOLD_SWEEP_MS || '3600000');

// Respect reverse-proxy headers (x-forwarded-proto/host) on Hostinger.
app.set('trust proxy', true);

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials:     true,
  allowedHeaders:  ['Content-Type', 'Authorization'],
  methods:         ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Static files (uploaded media) ────────────────────────────
const uploadRoot = path.resolve(RESOLVED_UPLOAD_DIR);

// Serve videos with inline disposition so browser opens player instead of forcing download.
app.use('/uploads/videos', express.static(path.join(uploadRoot, 'videos'), {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.mp4') res.setHeader('Content-Type', 'video/mp4');
    else if (ext === '.mov') res.setHeader('Content-Type', 'video/quicktime');
    else if (ext === '.webm') res.setHeader('Content-Type', 'video/webm');
    res.setHeader('Content-Disposition', 'inline');
  },
}));
app.use('/uploads', express.static(uploadRoot));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status:    'ok',
      timestamp: new Date().toISOString(),
      version:   '1.0.0',
    },
  });
});

// ── Public maintenance status ────────────────────────────────
app.get('/api/maintenance', async (_req, res) => {
  const maintenanceOn = await isFeatureFlagEnabled('maintenance_mode', false);
  res.json({
    success: true,
    data: {
      maintenance: maintenanceOn,
      message: maintenanceOn
        ? 'We are currently doing maintenance. Please try again later.'
        : '',
    },
  });
});

// ── Maintenance mode gate (blocks non-admin API when enabled) ─
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (req.path.startsWith('/api/admin')) return next();
  if (req.path === '/api/maintenance') return next();

  const maintenanceOn = await isFeatureFlagEnabled('maintenance_mode', false);
  if (!maintenanceOn) return next();

  res.status(503).json({
    success: false,
    error: 'Maintenance mode is enabled. Please try again later.',
  });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/users',  userRoutes);
app.use('/api/admin',  adminRoutes);

// ── Serve React admin panel ─────────────────────────────────────
// Serve the built React admin SPA from talents-stage-admin/dist
const adminDistPath = path.resolve(__dirname, '../../..', 'talents-stage-admin', 'dist');
const adminDistFallback = path.resolve(__dirname, '../../../..', 'talents-stage-admin', 'dist');

// Serve static assets (JS, CSS, images) from admin build
app.use('/admin', express.static(adminDistPath, { index: false }));
app.use('/admin', express.static(adminDistFallback, { index: false }));

// SPA fallback: all /admin/* routes serve index.html for client-side routing
app.get('/admin/*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const indexPath = path.join(adminDistPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      const fallbackIndex = path.join(adminDistFallback, 'index.html');
      res.sendFile(fallbackIndex, (err2) => {
        if (err2) {
          // Final fallback: try old admin.html
          const oldAdmin = path.resolve(__dirname, '../../..', 'admin.html');
          res.sendFile(oldAdmin, (err3) => {
            if (err3) res.status(404).send('Admin panel not found. Run: cd talents-stage-admin && npm run build');
          });
        }
      });
    }
  });
});
// Also handle /admin without trailing slash
app.get('/admin', (_req, res) => {
  res.redirect('/admin/');
});

// ── Serve front-end (if same origin) ─────────────────────────
// Uncomment to serve the built frontend from dist/public:
// app.use(express.static(path.resolve('public')));
// app.get('*', (_req, res) => res.sendFile(path.resolve('public', 'index.html')));

// ── 404 & global error handler ────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────
const start = async () => {
  await testConnection();

  const runStartupStep = async (label: string, fn: () => Promise<any>) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`⚠️  Startup step failed (${label}):`, (err as any)?.message || err);
    }
  };

  await runStartupStep('setupAdminTable', setupAdminTable);
  await runStartupStep('setupEnhancedAdminTables', setupEnhancedAdminTables);
  await runStartupStep('ensureCycleColumns', ensureCycleColumns);
  await runStartupStep('purgeOverLimitVideos', purgeOverLimitVideos);
  await runStartupStep('purgeExpiredModerationHiddenVideos', purgeExpiredModerationHiddenVideos);
  await runStartupStep('purgeExpiredModerationHiddenComments', purgeExpiredModerationHiddenComments);

  setInterval(() => {
    purgeExpiredModerationHiddenVideos().catch((err) => {
      console.error('⚠️  Moderation hold sweep failed:', err?.message || err);
    });
    purgeExpiredModerationHiddenComments().catch((err) => {
      console.error('⚠️  Comment moderation hold sweep failed:', err?.message || err);
    });
  }, MODERATION_HOLD_SWEEP_MS);

  app.listen(PORT, () => {
    console.log(`\n🎬  Talents Stage API  →  http://localhost:${PORT}`);
    console.log(`📁  Uploads served at  →  http://localhost:${PORT}/uploads`);
    console.log(`\nAvailable endpoints:`);
    console.log(`   POST   /api/auth/register`);
    console.log(`   POST   /api/auth/login`);
    console.log(`   GET    /api/auth/me`);
    console.log(`   GET    /api/videos          ?talent_type= &search= &page= &limit=`);
    console.log(`   POST   /api/videos          (multipart: video + thumbnail)`);
    console.log(`   GET    /api/videos/:id`);
    console.log(`   DELETE /api/videos/:id`);
    console.log(`   POST   /api/videos/:id/like`);
    console.log(`   POST   /api/videos/:id/save`);
    console.log(`   POST   /api/videos/:id/share`);
    console.log(`   GET    /api/videos/saved`);
    console.log(`   GET    /api/videos/shared`);
    console.log(`   POST   /api/videos/:id/comments`);
    console.log(`   GET    /api/users             ?talent_type= &search=`);
    console.log(`   POST   /api/users/:id/follow`);
    console.log(`   GET    /api/users/:id/followers`);
    console.log(`   GET    /api/users/:id/following`);
    console.log(`   PUT    /api/admin/videos/:id/hide-for-review`);
    console.log('');
  });
};

start().catch(err => {
  console.error('❌  Failed to start server:', err.message);
  process.exit(1);
});

export default app;
