/** Валидация, сериализация и загрузка файлов */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { ROOT } = require("./db");

const UPLOADS = path.join(ROOT, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

// Телефон: 10 цифр после +7/8 → "+7XXXXXXXXXX", иначе пустая строка
const normPhone = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.length === 11 && /^[78]/.test(d)) d = d.slice(1);
  return d.length === 10 ? "+7" + d : "";
};
const okMail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ""));
const okNick = (n) => /^[A-Za-zА-Яа-яЁё0-9_-]{3,20}$/.test(String(n || ""));
const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Сериализаторы: id отдаём строками (так проще на фронтенде). Контакты — только когда full=true
const S = String;
const user = (u, full) => ({
  id: S(u.id), nick: u.nick, role: u.role, avatar: u.avatar || "", banner: u.banner || "",
  bio: u.bio || "", created: u.created_at,
  ...(full ? { phone: u.phone || "", email: u.email || "" } : {}),
});
const item = (g) => ({ id: S(g.id), title: g.title, desc: g.description, price: g.price, img: g.image || "", seller: S(g.seller_id), date: g.created_at });
const review = (r) => ({ id: S(r.id), to: S(r.target_id), from: S(r.author_id), stars: r.stars, text: r.text, date: r.created_at });
const message = (m) => ({ id: S(m.id), name: m.name, email: m.email, text: m.text, date: m.created_at });

// Загрузка картинок: только jpg/png/webp/gif, до 5 МБ, случайное имя файла
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString("hex") + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new HttpError(400, "Допустимы только изображения JPG, PNG, WEBP, GIF"))),
});
const urlOf = (file) => (file ? "/uploads/" + file.filename : null);
// Удаляет файл из uploads (если путь наш)
const removeFile = (url) => {
  if (url && url.startsWith("/uploads/")) fs.unlink(path.join(UPLOADS, path.basename(url)), () => {});
};

module.exports = { UPLOADS, normPhone, okMail, okNick, str, HttpError, user, item, review, message, upload, urlOf, removeFile };
