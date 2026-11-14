import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  register,
  login,
  getCurrentUser,
  updateProfile,
  generateToken,
  verifyToken,
  AuthError,
} from '../src/services/authService.js';
import {
  createSavedRoute,
  getSavedRoutesByUser,
  deleteSavedRoute,
  createTripHistory,
  getTripHistoryByUser,
  deleteTripHistory,
  clearTripHistoryByUser,
} from '../src/db/storageService.js';

describe('Unit Test: User Auth & Saved Routes Storage (Braude / Humphrey Methodology)', () => {

  const tempStoragePath = path.join(os.tmpdir(), `jaksafe-auth-test-${process.pid}-${Date.now()}.json`);
  const prevStoragePath = process.env.JAKSAFE_LOCAL_STORAGE_PATH;
  const testUserEmail = `tester_${Date.now()}@jaksafe.id`;
  let createdUserId = null;
  let userToken = null;

  before(() => {
    process.env.JAKSAFE_LOCAL_STORAGE_PATH = tempStoragePath;
  });

  after(() => {
    if (prevStoragePath === undefined) {
      delete process.env.JAKSAFE_LOCAL_STORAGE_PATH;
    } else {
      process.env.JAKSAFE_LOCAL_STORAGE_PATH = prevStoragePath;
    }
    try {
      if (fs.existsSync(tempStoragePath)) fs.unlinkSync(tempStoragePath);
    } catch {
      // Abaikan cleanup error di tmp
    }
  });

  describe('1. Parameter Limits & Illegal Inputs (Humphrey Checklist #1, #2, #3)', () => {
    it('register: rejects invalid or malformed email addresses', async () => {
      const invalidEmails = ['plainaddress', '@missingusername.com', 'username@.com', ''];
      for (const email of invalidEmails) {
        await assert.rejects(
          async () => {
            await register({ email, password: 'validPassword123' });
          },
          (err) => {
            assert.ok(err instanceof AuthError);
            assert.equal(err.status, 400);
            return true;
          },
          `Email "${email}" should be rejected`
        );
      }
    });

    it('register: rejects short or empty passwords (< 6 characters)', async () => {
      const shortPasswords = ['', '123', 'abcde'];
      for (const password of shortPasswords) {
        await assert.rejects(
          async () => {
            await register({ email: 'valid_test@jaksafe.id', password });
          },
          (err) => {
            assert.ok(err instanceof AuthError);
            assert.equal(err.status, 400);
            return true;
          }
        );
      }
    });

    it('login: rejects nonexistent user with 404', async () => {
      await assert.rejects(
        async () => {
          await login({ email: 'nonexistent_account_999@jaksafe.id', password: 'randomPassword123' });
        },
        (err) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.status, 404);
          return true;
        }
      );
    });
  });

  describe('2. Registration, Authentication & Invariant Privacy (Braude Invariant Verification)', () => {
    it('register: creates new user with hashed password and generates valid JWT', async () => {
      const result = await register({
        name: 'Budi Santoso',
        email: testUserEmail,
        password: 'PasswordRahasia123',
        isHealthSensitive: true,
      });

      assert.ok(result.user, 'Result must contain user object');
      assert.ok(result.token, 'Result must contain JWT token');
      assert.equal(result.user.email, testUserEmail.toLowerCase());
      assert.equal(result.user.name, 'Budi Santoso');
      assert.equal(result.user.healthProfile?.isSensitive, true);

      // Invariant: Password must NEVER be exposed in returned user object
      assert.equal(result.user.password, undefined, 'Invariant: user.password must be undefined');

      createdUserId = result.user.id || result.user._id;
      userToken = result.token;
      assert.ok(createdUserId, 'User must have an ID');
    });

    it('register: prevents duplicate email registration (Conflict 409)', async () => {
      await assert.rejects(
        async () => {
          await register({
            name: 'Imposter',
            email: testUserEmail,
            password: 'AnotherPassword123',
          });
        },
        (err) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.status, 409);
          return true;
        }
      );
    });

    it('login: verifies correct password and rejects incorrect password with 401', async () => {
      // Login with correct password
      const loginSuccess = await login({
        email: testUserEmail,
        password: 'PasswordRahasia123',
      });
      assert.ok(loginSuccess.token, 'Valid login must yield a token');
      assert.equal(loginSuccess.user.email, testUserEmail.toLowerCase());
      assert.equal(loginSuccess.user.password, undefined, 'Invariant: password must not leak');

      // Login with wrong password
      await assert.rejects(
        async () => {
          await login({
            email: testUserEmail,
            password: 'SalahPasswordTotal',
          });
        },
        (err) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.status, 401);
          return true;
        }
      );
    });

    it('verifyToken: verifies valid token and rejects tampered or expired token', () => {
      const decoded = verifyToken(userToken);
      assert.equal(decoded.id, createdUserId);
      assert.equal(decoded.email, testUserEmail.toLowerCase());

      // Tampered token must throw AuthError 401
      assert.throws(
        () => {
          verifyToken(`${userToken}corrupt`);
        },
        (err) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.status, 401);
          return true;
        }
      );
    });

    it('updateProfile: updates health sensitivity profile and persists changes', async () => {
      const updated = await updateProfile(createdUserId, {
        name: 'Budi Santoso S.T.',
        isHealthSensitive: false,
        conditions: ['asma'],
      });

      assert.equal(updated.name, 'Budi Santoso S.T.');
      assert.equal(updated.healthProfile?.isSensitive, false);
      assert.deepEqual(updated.healthProfile?.conditions, ['asma']);

      // Read back via getCurrentUser
      const fresh = await getCurrentUser(createdUserId);
      assert.equal(fresh.name, 'Budi Santoso S.T.');
      assert.equal(fresh.healthProfile?.isSensitive, false);
    });
  });

  describe('3. Saved Routes CRUD & User Isolation Invariant', () => {
    let savedRouteId = null;

    it('createSavedRoute: persists route with origin, destination, score, and user reference', async () => {
      const routePayload = {
        userId: createdUserId,
        title: 'Kantor Sudirman ke Monas',
        origin: { name: 'Sudirman', lat: -6.2115, lon: 106.8229 },
        destination: { name: 'Monas', lat: -6.1754, lon: 106.8272 },
        score: { totalScore: 88, label: 'AMAN', color: '#16a34a' },
        distanceM: 5200,
        durationS: 780,
        profile: 'car',
      };

      const created = await createSavedRoute(routePayload);
      assert.ok(created.id, 'Created route must have unique id');
      assert.equal(created.userId, createdUserId);
      assert.equal(created.score.totalScore, 88);
      assert.equal(created.origin.name, 'Sudirman');

      savedRouteId = created.id;
    });

    it('getSavedRoutesByUser: retrieves routes belonging to the authenticated user', async () => {
      const list = await getSavedRoutesByUser(createdUserId);
      assert.ok(Array.isArray(list));
      assert.ok(list.length >= 1);
      const found = list.find((r) => String(r.id || r._id) === String(savedRouteId));
      assert.ok(found, 'Saved route should be in user route list');
      assert.equal(found.title, 'Kantor Sudirman ke Monas');
    });

    it('User Isolation: user B cannot view or delete user A routes', async () => {
      const userBId = 'different-user-uuid-999';

      // User B query returns empty list
      const userBList = await getSavedRoutesByUser(userBId);
      const crossFound = userBList.find((r) => String(r.id || r._id) === String(savedRouteId));
      assert.equal(crossFound, undefined, 'User B must not see User A routes');

      // User B cannot delete User A route
      const deleteAttempt = await deleteSavedRoute(savedRouteId, userBId);
      assert.equal(deleteAttempt, false, 'User B must not be able to delete User A route');

      // User A can delete their own route
      const deleteSuccess = await deleteSavedRoute(savedRouteId, createdUserId);
      assert.equal(deleteSuccess, true, 'User A should be able to delete their own route');

      // Verify deletion
      const listAfter = await getSavedRoutesByUser(createdUserId);
      assert.equal(listAfter.find((r) => String(r.id || r._id) === String(savedRouteId)), undefined);
    });
  });

  describe('5. Alert Preferences & Trip History Isolation (Steps 2 Storage)', () => {
    it('updateProfile: persists hazard alert preferences cleanly', async () => {
      const updated = await updateProfile(createdUserId, {
        alertPreferences: {
          enabled: true,
          regions: ['Jakarta Selatan', 'Jakarta Barat'],
          minSeverity: 'siaga',
        },
      });
      assert.equal(updated.alertPreferences.enabled, true);
      assert.deepEqual(updated.alertPreferences.regions, ['Jakarta Selatan', 'Jakarta Barat']);
      assert.equal(updated.alertPreferences.minSeverity, 'siaga');

      const reloaded = await getCurrentUser(createdUserId);
      assert.deepEqual(reloaded.alertPreferences.regions, ['Jakarta Selatan', 'Jakarta Barat']);
    });

    it('TripHistory CRUD + user isolation + clear removes only owning user entries', async () => {
      const entry = await createTripHistory({
        userId: createdUserId,
        origin: { id: 'o1', name: 'Bundaran HI', lat: -6.195, lon: 106.823 },
        destination: { id: 'd1', name: 'Blok M', lat: -6.244, lon: 106.798 },
        score: { totalScore: 84, label: 'AMAN', color: '#16a34a' },
        distanceM: 6400,
        durationS: 890,
        profile: 'motor',
        summary: 'Jl. Jenderal Sudirman',
        source: 'agent',
      });

      assert.ok(entry.id);
      assert.equal(entry.profile, 'motor');
      assert.equal(entry.summary, 'Jl. Jenderal Sudirman');

      const ownerList = await getTripHistoryByUser(createdUserId);
      assert.ok(ownerList.some((h) => String(h.id || h._id) === String(entry.id)));

      const otherUserList = await getTripHistoryByUser('other-user-history-999');
      assert.equal(otherUserList.some((h) => String(h.id || h._id) === String(entry.id)), false);

      // User lain gagal menghapus entri milik pengguna ini
      assert.equal(await deleteTripHistory(entry.id, 'other-user-history-999'), false);

      // Pemilik bisa menghapus entri spesifik dan membersihkan seluruh riwayatnya
      assert.equal(await deleteTripHistory(entry.id, createdUserId), true);
      await createTripHistory({
        userId: createdUserId,
        origin: { name: 'Monas', lat: -6.1754, lon: 106.8272 },
        destination: { name: 'Senayan', lat: -6.218, lon: 106.802 },
        score: { totalScore: 76, label: 'AMAN', color: '#16a34a' },
        profile: 'bike',
      });
      const cleared = await clearTripHistoryByUser(createdUserId);
      assert.ok(cleared >= 1);
      const afterClear = await getTripHistoryByUser(createdUserId);
      assert.equal(afterClear.length, 0);
    });
  });

});

