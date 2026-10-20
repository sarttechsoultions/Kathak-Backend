const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
// Set every required credential to synthetic values BEFORE loading application modules.
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  JWT_SECRET: 'test-only-secret-01234567890123456789', REDIS_URL: '',
  BUNNY_LIBRARY_ID: 'test', BUNNY_STREAM_API_KEY: 'test', BUNNY_PULL_ZONE_HOSTNAME: 'test.invalid',
  CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test-secret',
  CLOUDINARY_VIDEO_SIGNED_PRESET: 'test-signed', CLOUDINARY_VIDEO_MAX_BYTES: '2147483648',
  CLOUDINARY_VIDEO_ACCOUNT_LIMIT_CONFIRMED: 'true',
});
const express = require('express');
const jwt = require('jsonwebtoken');
const { prisma } = require('../dist/lib/prisma');
const cloudinary = require('../dist/config/cloudinary.config').default;
require('../dist/lib/tokenBlocklist').isTokenRevoked = async () => false;
let locked = false;
require('../dist/modules/student/access.service').getStudentAccessState = async () => ({ isLocked: locked });
const router = require('../dist/modules/upload/upload.routes').default;
const { verifyDirectVideoLinks } = require('../dist/modules/upload/direct-video-link.middleware');
const { authenticate } = require('../dist/middleware/auth.middleware');
const { VIDEO_EAGER } = require('../dist/modules/upload/direct-video.policy');
let records, asset, resourceFails, membership, enrollment, now;
let sequence = 0, currentId;
let app;
const selection = { name: 'dance.mov', mimeType: 'video/quicktime', size: 20000000 };
const matches = (item, where) => Object.entries(where).every(([key, value]) =>
  value && typeof value === 'object' && 'in' in value ? value.in.includes(item[key]) : item[key] === value);
before(() => {
  cloudinary.api.upload_preset = async () => ({ unsigned: false, options: { allowed_formats: ['mp4', 'mov', 'webm', 'm4v'] } });
  cloudinary.api.resource = async () => { if (resourceFails) throw new Error('sensitive provider detail'); return asset; };
  prisma.videoUploadIntent.create = async ({ data }) => {
    const item = { ...data, status: 'UPLOADING', processingStatus: 'PENDING', createdAt: now, completedAt: null, playbackUrl: null };
    records.push(item); return item;
  };
  prisma.videoUploadIntent.findFirst = async ({ where }) => records.find(item => matches(item, where)) || null;
  prisma.videoUploadIntent.findUniqueOrThrow = async ({ where }) => records.find(item => matches(item, where));
  prisma.videoUploadIntent.updateMany = async ({ where, data }) => {
    const found = records.filter(item => matches(item, where));
    found.forEach(item => Object.assign(item, data)); return { count: found.length };
  };
  prisma.batchStudent.findMany = async () => membership ? [{ batchId: 'batch', batch: { id: 'batch', name: 'A', code: 'A' } }] : [];
  prisma.batch.findUnique = async () => ({ courseId: 'course' });
  prisma.enrollment.findFirst = async () => enrollment ? { id: 'enrollment' } : null;
  prisma.assignment.findUnique = async () => ({ id: 'assignment', batchId: 'batch', status: 'ACTIVE', dueDate: new Date(Date.now() + 86400000), allowLateSubmissions: false });
  app = express(); app.use('/upload', router);
  app.post('/student/assignments/submit', authenticate, verifyDirectVideoLinks, (_req, res) => res.json({ status: 'success' }));
});
after(async () => { await prisma.$disconnect(); });
beforeEach(() => { currentId = `user-${++sequence}`; records = []; now = new Date(); resourceFails = false; membership = enrollment = true; locked = false;
  asset = { public_id: '', asset_id: 'asset', resource_type: 'video', type: 'upload', bytes: selection.size,
    format: 'mov', duration: 60, created_at: now.toISOString(), version: 1,
    derived: [{ transformation: VIDEO_EAGER, secure_url: 'https://res.cloudinary.com/test/video/upload/derived.mp4' }] };
});
async function call(path, { role = 'ADMIN', id = currentId, body = {}, method = 'POST' } = {}) {
  const token = jwt.sign({ id, email: 'test@example.invalid', role, permissions: [] }, process.env.JWT_SECRET);
  const { IncomingMessage, ServerResponse } = require('node:http');
  const { Duplex } = require('node:stream');
  const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
  const req = new IncomingMessage(socket);
  Object.assign(req, { method, url: path, body, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  const res = new ServerResponse(req);
  return new Promise((resolve, reject) => {
    res.end = chunk => { try { res.emit('finish'); resolve({ status: res.statusCode, data: JSON.parse(String(chunk)) }); } catch (error) { reject(error); } return res; };
    app.handle(req, res, reject);
  });
}
async function init(options) {
  const response = await call('/upload/video/intents', { body: selection, ...options });
  if (records[0]) asset.public_id = records[0].publicId;
  return response;
}
test('admin signs a unique non-overwriting destination without exposing API secret', async () => {
  const result = await init(); assert.equal(result.status, 201);
  assert.equal(result.data.data.params.overwrite, false);
  assert.equal(result.data.data.chunkBytes, 10485760);
  assert.ok(result.data.data.params.public_id.startsWith(`kathak_direct/${currentId}/`));
  assert.equal(JSON.stringify(result.data).includes('test-secret'), false);
  const { signature, api_key, ...params } = result.data.data.params;
  assert.equal(signature, cloudinary.utils.api_sign_request(params, 'test-secret'));
});
test('teacher upload authorization preserves existing role access', async () => { assert.equal((await init({ role: 'TEACHER' })).status, 201); });
test('students cannot initialize staff uploads', async () => { assert.equal((await init({ role: 'STUDENT' })).status, 403); });
test('authorized enrolled student may upload to their assignment', async () => {
  const result = await call('/upload/student/video/intents', { role: 'STUDENT', body: { ...selection, purpose: 'ASSIGNMENT', relatedId: 'assignment' } });
  assert.equal(result.status, 201); assert.equal(records[0].userId, currentId); assert.equal(records[0].relatedId, 'assignment');
});
test('student with no membership is rejected', async () => {
  membership = false;
  assert.equal((await call('/upload/student/video/intents', { role: 'STUDENT', body: { ...selection, purpose: 'ASSIGNMENT', relatedId: 'assignment' } })).status, 403);
});
test('locked student cannot authorize an upload', async () => {
  locked = true;
  assert.equal((await call('/upload/student/video/intents', { role: 'STUDENT', id: 'locked', body: { ...selection, purpose: 'ASSIGNMENT', relatedId: 'assignment' } })).status, 403);
});
test('student without active enrollment is rejected', async () => {
  enrollment = false;
  assert.equal((await call('/upload/student/video/intents', { role: 'STUDENT', id: 'unenrolled', body: { ...selection, purpose: 'ASSIGNMENT', relatedId: 'assignment' } })).status, 403);
});
test('arbitrary signature parameters are rejected', async () => {
  assert.equal((await init({ body: { ...selection, public_id: 'another-user', overwrite: true } })).status, 400);
});
test('excessive size is rejected server-side', async () => { assert.equal((await init({ body: { ...selection, size: 2147483649 } })).status, 400); });
test('expired upload intents cannot complete', async () => {
  await init(); records[0].expiresAt = new Date(0);
  assert.equal((await call(`/upload/video/intents/${records[0].id}/complete`)).status, 410);
});
test('cross-user completion is rejected', async () => {
  await init(); assert.equal((await call(`/upload/video/intents/${records[0].id}/complete`, { id: 'other' })).status, 404);
});
test('completion rejects client supplied public IDs', async () => {
  await init(); assert.equal((await call(`/upload/video/intents/${records[0].id}/complete`, { body: { public_id: 'evil' } })).status, 400);
});
test('wrong provider public ID cannot be accepted', async () => {
  await init(); asset.public_id = 'wrong'; assert.equal((await call(`/upload/video/intents/${records[0].id}/complete`)).status, 422);
});
test('provider resource verification errors return a safe retryable response', async () => {
  await init(); resourceFails = true;
  const result = await call(`/upload/video/intents/${records[0].id}/complete`);
  assert.equal(result.status, 502); assert.equal(JSON.stringify(result.data).includes('sensitive'), false);
});
test('actual bytes cannot differ from the authorized size', async () => {
  await init(); asset.bytes++; assert.equal((await call(`/upload/video/intents/${records[0].id}/complete`)).status, 422);
});
test('concurrent duplicate completion is idempotent', async () => {
  await init(); const path = `/upload/video/intents/${records[0].id}/complete`;
  const results = await Promise.all([call(path), call(path)]);
  assert.ok(results.every(result => result.status === 200 && result.data.data.status === 'READY'));
  assert.equal(records.length, 1); assert.equal(results[0].data.data.url, results[1].data.data.url);
});
test('transfer completion is separate from processing readiness', async () => {
  await init(); asset.derived = [];
  const result = await call(`/upload/video/intents/${records[0].id}/complete`);
  assert.equal(result.data.data.status, 'PROCESSING'); assert.equal(result.data.data.url, undefined);
});
test('verified processing failure is terminal', async () => {
  await init(); asset.derived[0].status = 'failed';
  const path = `/upload/video/intents/${records[0].id}/complete`;
  assert.equal((await call(path)).data.data.status, 'FAILED'); assert.equal((await call(path)).status, 409);
});
test('cancelled intents cannot be replayed', async () => {
  await init(); await call(`/upload/video/intents/${records[0].id}`, { method: 'DELETE' });
  assert.equal((await call(`/upload/video/intents/${records[0].id}/complete`)).status, 409);
});
test('historical video URLs remain compatible', async () => {
  const result = await call('/student/assignments/submit', { role: 'STUDENT', body: { assignmentId: 'assignment', files: [{ url: 'https://res.cloudinary.com/test/video/upload/old.mp4' }] } });
  assert.equal(result.status, 200);
});
test('students cannot link another user direct upload', async () => {
  await init(); const result = await call('/student/assignments/submit', { role: 'STUDENT', body: { assignmentId: 'assignment', files: [{ url: 'https://res.cloudinary.com/test/video/upload/kathak_direct/other/asset.mp4' }] } });
  assert.equal(result.status, 403);
});
test('account limit confirmation is required before issuing signatures', async () => {
  process.env.CLOUDINARY_VIDEO_ACCOUNT_LIMIT_CONFIRMED = 'false';
  try { assert.equal((await init()).status, 503); assert.equal(records.length, 0); }
  finally { process.env.CLOUDINARY_VIDEO_ACCOUNT_LIMIT_CONFIRMED = 'true'; }
});
test('unsupported file formats are rejected', async () => {
  assert.equal((await init({ body: { ...selection, name: 'script.exe', mimeType: 'application/octet-stream' } })).status, 400);
});
test('upload authorization is rate limited per authenticated user', async () => {
  for (let attempt = 0; attempt < 12; attempt++) assert.equal((await init({ id: 'rate-limited-user' })).status, 201);
  assert.equal((await init({ id: 'rate-limited-user' })).status, 429);
});
test('gallery and practice record creation locks the intent and returns the existing record on retry', async () => {
  const { createMediaRecordOnce } = require('../dist/modules/upload/direct-video-record');
  await init(); records[0].status = 'READY'; records[0].playbackUrl = 'https://res.cloudinary.com/test/video/upload/kathak_direct/user/id.mp4'; records[0].links = {};
  const oldTransaction = prisma.$transaction;
  const order = [];
  const tx = { videoUploadIntent: {
    findUnique: async () => records[0], findUniqueOrThrow: async () => records[0],
    update: async ({ data }) => { order.push('link'); Object.assign(records[0], data); },
  }, $queryRaw: async () => { order.push('lock'); return [{ id: records[0].id }]; } };
  prisma.$transaction = async callback => callback(tx);
  let created = 0;
  const create = async () => { order.push('create'); created++; return { id: 'record' }; };
  const find = async (_tx, id) => ({ id });
  try {
    const first = await createMediaRecordOnce(records[0].playbackUrl, 'GALLERY', create, find);
    const retry = await createMediaRecordOnce(records[0].playbackUrl, 'GALLERY', create, find);
    assert.equal(first.id, retry.id); assert.equal(created, 1); assert.deepEqual(order, ['lock', 'create', 'link', 'lock']);
  } finally { prisma.$transaction = oldTransaction; }
});
