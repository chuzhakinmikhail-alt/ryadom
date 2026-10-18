/** Сессии (JWT в httpOnly-cookie), проверка ролей, ошибки */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { db, ROOT } = require("./db");
const { HttpError } = require("./util");

// Секрет подписи: из переменной JWT_SECRET или генерируется один раз и хранится в data/secret.key
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(ROOT, "data", "secret.key");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(f, "utf8");
}
const SECRET = getSecret();

function issueSession(res, userId) {
  const token = jwt.sign({ id: userId }, SECRET, { expiresIn: "7d" });
  res.cookie("sid", token, {
    httpOnly: true, sameSite: "lax", maxAge: 7 * 864e5,
    secure: process.env.COOKIE_SECURE === "true", // включите true при HTTPS
  });
}

// Кладёт req.user (или null) на каждый запрос
function loadUser(req, res, next) {
  req.user = null;
  const t = req.cookies && req.cookies.sid;
  if (t) {
    try {
      const { id } = jwt.verify(t, SECRET);
      req.user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
    } catch { /* просроченный или битый токен */ }
  }
  next();
}
const requireAuth = (req, res, next) => (req.user ? next() : next(new HttpError(401, "Требуется вход в аккаунт")));
const requireAdmin = (req, res, next) => {
  if (!req.user) return next(new HttpError(401, "Требуется вход в аккаунт"));
  if (req.user.role !== "admin") return next(new HttpError(403, "Только для администратора"));
  next();
};

// Простой ограничитель запросов (по IP) для входа и регистрации
const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now();
  const h = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (h.length >= max) return next(new HttpError(429, "Слишком много попыток, попробуйте позже"));
  h.push(now); hits.set(k, h); next();
};

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorHandler(err, req, res, next) { // eslint-disable-line
  let status = err.status || 500, msg = err.message;
  if (err.name === "MulterError") { status = 400; msg = err.code === "LIMIT_FILE_SIZE" ? "Файл больше 5 МБ" : "Ошибка загрузки файла"; }
  if (/UNIQUE constraint/.test(msg || "")) { status = 409; msg = "Такие данные уже заняты"; }
  if (status >= 500) { console.error(err); msg = "Внутренняя ошибка сервера"; }
  res.status(status).json({ error: msg });
}

module.exports = { issueSession, loadUser, requireAuth, requireAdmin, limit, wrap, errorHandler };
