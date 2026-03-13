import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

// Mock the fileWatcher so it doesn't try to read a real log file or start chokidar
vi.mock('../utils/fileWatcher.js', () => ({
  startWatching: vi.fn(),
}));

// Dynamic import after mocks are in place
const { default: app } = await import('../app.js');

describe('App integration tests', () => {
  describe('404 handling', () => {
    it('returns 404 JSON error for unknown routes', async () => {
      const res = await request(app).get('/api/nonexistent-route');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('message');
      expect(res.body.error.message).toBe('Route not found');
    });

    it('returns 404 for routes outside /api prefix', async () => {
      const res = await request(app).get('/random-path');

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Route not found');
    });
  });

  describe('CORS headers (RISK #10)', () => {
    it('includes CORS headers for allowed origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');

      // CORS should allow the configured origin
      expect(res.headers['access-control-allow-origin']).toBeDefined();
    });

    it('responds to preflight OPTIONS request', async () => {
      const res = await request(app)
        .options('/api/health')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');

      // Should respond (Express 5 + cors middleware handles OPTIONS)
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('JSON body parsing', () => {
    it('parses JSON request bodies', async () => {
      // We can verify JSON parsing works by sending a POST to a non-existent route
      // The body parsing should succeed (no 400 parse error), and we get a 404
      const res = await request(app)
        .post('/api/some-endpoint')
        .send({ key: 'value' })
        .set('Content-Type', 'application/json');

      // Should get 404 (not found), not 400 (bad request / parse error)
      expect(res.status).toBe(404);
    });
  });

  describe('Security headers (Helmet)', () => {
    it('includes X-Content-Type-Options header', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('includes X-Frame-Options or Content-Security-Policy header', async () => {
      const res = await request(app).get('/api/health');
      // Helmet sets either x-frame-options or csp frame-ancestors
      const hasFrameProtection =
        res.headers['x-frame-options'] !== undefined ||
        res.headers['content-security-policy'] !== undefined;
      expect(hasFrameProtection).toBe(true);
    });

    it('removes X-Powered-By header', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('includes Strict-Transport-Security header', async () => {
      const res = await request(app).get('/api/health');
      // Helmet adds HSTS by default
      expect(res.headers['strict-transport-security']).toBeDefined();
    });
  });

  describe('Known routes work through the app', () => {
    it('GET /api/health returns 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /api/events returns SSE stream', async () => {
      const res = await new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve) => {
        const req = request(app)
          .get('/api/events')
          .buffer(false);

        req.then((r) => {
          // won't reach here normally for SSE
          resolve({ status: r.status, headers: r.headers as Record<string, string>, body: '' });
        });

        req.on('response', (r) => {
          let data = '';
          r.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: init')) {
              resolve({ status: r.statusCode, headers: r.headers as Record<string, string>, body: data });
              r.destroy(); // cleanly close
            }
          });
        });
      });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
    });
  });
});
