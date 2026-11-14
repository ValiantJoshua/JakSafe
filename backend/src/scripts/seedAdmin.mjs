import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDb } from '../db/mongoClient.js';
import { findUserByEmail, createUser, updateUserRole, isMongoActive } from '../db/storageService.js';
import mongoose from 'mongoose';

async function main() {
  const [, , rawEmail, rawPassword, rawName] = process.argv;
  const email = (rawEmail || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = rawPassword || process.env.ADMIN_PASSWORD || '';
  const name = (rawName || process.env.ADMIN_NAME || 'Administrator JakSafe').trim();

  if (!email) {
    console.error('Pemakaian: npm run admin:seed -- <email> [password_minimal_6_karakter] [nama]');
    process.exitCode = 1;
    return;
  }

  await connectDb();
  const existing = await findUserByEmail(email);

  if (existing) {
    if (existing.role === 'admin') {
      console.log(`[admin:seed] Akun ${email} sudah memiliki peran admin (storage=${isMongoActive() ? 'mongodb' : 'local'}).`);
    } else {
      await updateUserRole(existing.id, 'admin');
      console.log(`[admin:seed] Akun ${email} berhasil dinaikkan menjadi admin (storage=${isMongoActive() ? 'mongodb' : 'local'}).`);
    }
  } else {
    if (!password || password.length < 6) {
      console.error(`[admin:seed] Akun ${email} belum terdaftar. Sertakan password minimal 6 karakter untuk membuat akun admin baru.`);
      process.exitCode = 1;
      return;
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await createUser({ name, email, password: hashedPassword, role: 'admin' });
    console.log(`[admin:seed] Akun admin baru ${email} berhasil dibuat (storage=${isMongoActive() ? 'mongodb' : 'local'}).`);
  }
}

main()
  .catch((err) => {
    console.error('[admin:seed] Gagal:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection?.readyState === 1) {
      await mongoose.disconnect();
    }
  });
