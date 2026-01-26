import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db/connection';
import authRoutes from './routes/auth';
import trackingRoutes from './routes/tracking';
import analyticsRoutes from './routes/analytics';
import webhookRoutes from './routes/webhook';
import { startScheduler } from './services/scheduler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - CORS configuration
// Allow all origins including .onion domains for Tor hidden service support
// If you need to restrict origins, set ALLOWED_ORIGINS env var (comma-separated)
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : true; // Allow all origins by default

app.use(cors({
  origin: allowedOrigins, // Supports both regular domains and .onion addresses
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
  exposedHeaders: ['Content-Type']
}));

// Webhook routes need raw body for signature verification
// Register webhook route middleware BEFORE general JSON middleware
app.use('/api/webhook', express.text({ 
  type: 'application/json',
  verify: (req: any, res, buf) => {
    // Store raw body as string for signature verification
    req.rawBody = buf.toString('utf8');
  }
}));

// Parse JSON for webhook routes after capturing raw body
app.use('/api/webhook', (req: any, res, next) => {
  if (req.rawBody) {
    try {
      req.body = JSON.parse(req.rawBody);
    } catch (e) {
      console.warn('Failed to parse webhook body as JSON:', e);
    }
  }
  next();
});

// JSON middleware for other routes
app.use(express.json());

// Debug middleware - log all requests to help diagnose routing issues
// Place BEFORE routes so we can see ALL requests including SSE
app.use((req, res, next) => {
  // Log all requests, especially SSE
  if (req.path.includes('/logs/stream')) {
    console.log(`[SSE REQUEST] ${new Date().toISOString()} ${req.method} ${req.path} ${req.url}`);
    console.log(`[SSE REQUEST] Origin: ${req.headers.origin}`);
    console.log(`[SSE REQUEST] User-Agent: ${req.headers['user-agent']}`);
    console.log(`[SSE REQUEST] Has token: ${!!req.query.token}`);
    console.log(`[SSE REQUEST] Query params:`, Object.keys(req.query));
  } else {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${req.url}`);
  }
  next();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/analytics', analyticsRoutes);
// Webhook routes (no authentication required - uses signature verification)
app.use('/api/webhook', webhookRoutes);

// 404 handler - return JSON instead of blank page
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.path} ${req.url} - Route not found`);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.path,
    url: req.url,
    availableRoutes: [
      '/health',
      '/api/auth/*',
      '/api/tracking/*',
      '/api/analytics/*',
      '/api/webhook/',
      '/api/webhook/trackingmore/test',
      '/api/webhook/trackingmore'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Registered routes:');
  console.log('  - GET /health');
  console.log('  - /api/auth/*');
  console.log('  - /api/tracking/*');
  console.log('    - GET /api/tracking/logs/stream (SSE)');
  console.log('  - /api/analytics/*');
  console.log('  - GET /api/webhook/');
  console.log('  - GET /api/webhook/trackingmore/test');
  console.log('  - POST /api/webhook/trackingmore');
  startScheduler();
});

