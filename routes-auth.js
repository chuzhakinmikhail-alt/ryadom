/** Регистрация (телефон + email + код), вход, выход */
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { db } = require("./db");
const { issueSession, limit, wrap } = require("./middleware");
const { normPhone, okMail, okNick, str, HttpError } = require("./util");

// Ожидающие подтверждения регистрации (в памяти, 10 минут)
const pending = new Map();
// ДОПУЩЕНИЕ: реальной SMS/почты нет. Код пишется в консоль сервера и (в демо-режиме) возвращается в ответе.
// Для продакшена: DEMO_CODES=false и подключите SMS-провайдера и SMTP в sendCode().
const DEMO = process.env.DEMO_CODES !== "false";
function sendCode(phone, email, code) {
  console.log(`[код подтверждения] ${phone} / ${email}: ${code}`);
}

router.post("/register", limit(20, 15 * 60e3), wrap(async (req, res) => {
  const nick = str(req.body.nick, 20), phone = normPhone(req.body.phone), email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password || "");
  if (!okNick(nick)) throw new HttpError(400, "Никнейм: 3–20 букв, цифр, _ или -");
  if (!phone) throw new HttpError(400, "Введите корректный номер телефона");
  if (!okMail(email)) throw new HttpError(400, "Введите корректный email");
  if (password.length < 6 || password.length > 100) throw new HttpError(400, "Пароль: от 6 символов");
  if (db.prepare("SELECT 1 FROM users WHERE nick = ? OR phone = ? OR email = ?").get(nick, phone, email))
    throw new HttpError(409, "Ник, телефон или email уже заняты");
  const code = String(crypto.randomInt(1000, 10000)), id = crypto.randomUUID();
  pending.set(id, { nick, phone, email, hash: await bcrypt.hash(password, 10), code, tries: 0, exp: Date.now() + 10 * 60e3 });
  sendCode(phone, email, code);
  res.json({ pendingId: id, phone, email, ...(DEMO ? { demoCode: code } : {}) });
}));

router.post("/verify", limit(30, 15 * 60e3), wrap(async (req, res) => {
  const p = pending.get(String(req.body.pendingId));
  if (!p || p.exp < Date.now()) throw new HttpError(400, "Код устарел, начните регистрацию заново");
  if (++p.tries > 5) { pending.delete(req.body.pendingId); throw new HttpError(429, "Слишком много попыток"); }
  if (String(req.body.code).trim() !== p.code) throw new HttpError(400, "Неверный код");
  pending.delete(req.body.pendingId);
  const r = db.prepare(`INSERT INTO users (nick, phone, email, password_hash, role, created_at) VALUES (?,?,?,?, 'user', ?)`)
    .run(p.nick, p.phone, p.email, p.hash, Date.now());
  issueSession(res, r.lastInsertRowid);
  res.json({ ok: true });
}));

// Вход: ник, email или телефон + пароль (админ входит по нику без телефона/email)
router.post("/login", limit(30, 15 * 60e3), wrap(async (req, res) => {
  const id = str(req.body.login, 120), password = String(req.body.password || "");
  const u = db.prepare("SELECT * FROM users WHERE nick = ? OR email = ? OR (phone IS NOT NULL AND phone = ?)")
    .get(id, id.toLowerCase(), normPhone(id) || "-");
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, "Неверные данные для входа");
  issueSession(res, u.id);
  res.json({ ok: true, role: u.role, nick: u.nick });
}));

router.post("/logout", (req, res) => { res.clearCookie("sid"); res.json({ ok: true }); });

module.exports = router;
