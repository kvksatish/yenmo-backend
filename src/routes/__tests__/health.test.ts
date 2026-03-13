import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRouter from '../health.js';

function createApp() {
  const app = express();
  app.use('/api', healthRouter);
  return app;
}

describe('GET /api/health', () => {
  it('returns 200 status code', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('response has status, timestamp, and uptime fields', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
  });

  it('status field is "ok"', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('ok');
  });

  it('uptime is a positive number', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThan(0);
  });

  it('timestamp is a valid ISO string', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    const date = new Date(res.body.timestamp);
    expect(date.toISOString()).toBe(res.body.timestamp);
    expect(isNaN(date.getTime())).toBe(false);
  });

  it('returns application/json content type', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
