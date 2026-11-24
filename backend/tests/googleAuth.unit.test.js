import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import {
  loginWithGoogle,
  verifyGoogleIdToken,
  verifyGoogleAccessToken,
  verifyToken,
  register,
  resetGoogleJwksCacheForTest,
  AuthError,
} from '../src/services/authService.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-google-key-1',
  use: 'sig',
  alg: 'RS256',
};

const TEST_CLIENT_ID = '1234567890-testclient.apps.googleusercontent.com';

function createMockGoogleFetch() {
  return async () => ({
    ok: true,
    headers: new Headers({ 'cache-control': 'public, max-age=3600' }),
    json: async () => ({ keys: [publicJwk] }),
  });
}

function signGoogleToken(payload, { kid = 'test-google-key-1', key = privateKey } = {}) {
  return jwt.sign(payload, key, {
    algorithm: 'RS256',
    keyid: kid,
    expiresIn: '1h',
  });
}

function setupTempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaksafe-google-auth-'));
  const filePath = path.join(dir, 'store.json');
  process.env.JAKSAFE_LOCAL_STORAGE_PATH = filePath;
  return { dir, filePath };
}

test('Google OAuth: verifies valid RS256 ID token and creates new user with JakSafe JWT', async () => {
  const { dir } = setupTempStorage();
  resetGoogleJwksCacheForTest();
  try {
    const idToken = signGoogleToken({
      iss: 'https://accounts.google.com',
      aud: TEST_CLIENT_ID,
      sub: 'google-sub-1001',
      email: 'new.google.user@gmail.com',
      email_verified: true,
      name: 'New Google User',
      picture: 'https://lh3.googleusercontent.com/avatar.png',
    });

    const result = await loginWithGoogle(
      { credential: idToken, isHealthSensitive: true },
      { clientId: TEST_CLIENT_ID, fetchImpl: createMockGoogleFetch() }
    );

    assert.equal(result.isNewUser, true);
    assert.equal(result.user.email, 'new.google.user@gmail.com');
    assert.equal(result.user.name, 'New Google User');
    assert.equal(result.user.role, 'user');
    assert.equal(result.user.googleId, 'google-sub-1001');
    assert.equal(result.user.healthProfile.isSensitive, true);
    assert.equal(result.user.password, undefined);

    const decoded = verifyToken(result.token);
    assert.equal(decoded.email, 'new.google.user@gmail.com');
  } finally {
    delete process.env.JAKSAFE_LOCAL_STORAGE_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Google OAuth: links seamlessly to existing email user without overwriting role or healthProfile', async () => {
  const { dir } = setupTempStorage();
  resetGoogleJwksCacheForTest();
  try {
    await register({
      email: 'existing.user@gmail.com',
      password: 'Password123!',
      name: 'Existing Member',
      isHealthSensitive: true,
    });

    const idToken = signGoogleToken({
      iss: 'accounts.google.com',
      aud: TEST_CLIENT_ID,
      sub: 'google-sub-2002',
      email: 'existing.user@gmail.com',
      email_verified: true,
      name: 'Existing Google Name',
    });

    const result = await loginWithGoogle(
      { credential: idToken, isHealthSensitive: false },
      { clientId: TEST_CLIENT_ID, fetchImpl: createMockGoogleFetch() }
    );

    assert.equal(result.isNewUser, false);
    assert.equal(result.user.email, 'existing.user@gmail.com');
    assert.equal(result.user.name, 'Existing Member');
    assert.equal(result.user.healthProfile.isSensitive, true);
  } finally {
    delete process.env.JAKSAFE_LOCAL_STORAGE_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Google OAuth: rejects unverified Google email with 403', async () => {
  resetGoogleJwksCacheForTest();
  const idToken = signGoogleToken({
    iss: 'https://accounts.google.com',
    aud: TEST_CLIENT_ID,
    sub: 'google-sub-3003',
    email: 'unverified@gmail.com',
    email_verified: false,
    name: 'Unverified User',
  });

  await assert.rejects(
    () => verifyGoogleIdToken(idToken, { clientId: TEST_CLIENT_ID, fetchImpl: createMockGoogleFetch() }),
    (err) => err instanceof AuthError && err.status === 403
  );
});

test('Google OAuth: rejects mismatched audience (Client ID) with 401', async () => {
  resetGoogleJwksCacheForTest();
  const idToken = signGoogleToken({
    iss: 'https://accounts.google.com',
    aud: 'wrong-client-id.apps.googleusercontent.com',
    sub: 'google-sub-4004',
    email: 'user@gmail.com',
    email_verified: true,
    name: 'Wrong Audience',
  });

  await assert.rejects(
    () => verifyGoogleIdToken(idToken, { clientId: TEST_CLIENT_ID, fetchImpl: createMockGoogleFetch() }),
    (err) => err instanceof AuthError && err.status === 401
  );
});

test('Google OAuth: returns 503 when GOOGLE_CLIENT_ID is not configured', async () => {
  resetGoogleJwksCacheForTest();
  await assert.rejects(
    () => verifyGoogleIdToken('dummy.jwt.token', { clientId: '', fetchImpl: createMockGoogleFetch() }),
    (err) => err instanceof AuthError && err.status === 503
  );
});

test('Google OAuth Access Token: verifies audience + userinfo and signs in user', async () => {
  const { dir } = setupTempStorage();
  try {
    const mockFetch = async (url) => {
      if (String(url).includes('tokeninfo')) {
        return {
          ok: true,
          json: async () => ({ aud: TEST_CLIENT_ID, sub: 'oauth-sub-55' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          sub: 'oauth-sub-55',
          email: 'oauth.popup@gmail.com',
          email_verified: true,
          name: 'OAuth Popup User',
        }),
      };
    };

    const result = await loginWithGoogle(
      { accessToken: 'ya29.mock-access-token', isHealthSensitive: false },
      { clientId: TEST_CLIENT_ID, fetchImpl: mockFetch }
    );

    assert.equal(result.isNewUser, true);
    assert.equal(result.user.email, 'oauth.popup@gmail.com');
    assert.equal(result.user.googleId, 'oauth-sub-55');
  } finally {
    delete process.env.JAKSAFE_LOCAL_STORAGE_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Google OAuth Access Token: rejects token issued for another Client ID', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ aud: 'other-app.apps.googleusercontent.com' }),
  });

  await assert.rejects(
    () => verifyGoogleAccessToken('ya29.other-app-token', { clientId: TEST_CLIENT_ID, fetchImpl: mockFetch }),
    (err) => err instanceof AuthError && err.status === 401
  );
});
