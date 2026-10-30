/**
 * База данных: встроенный SQLite из Node.js (node:sqlite, нужен Node 22.13+).
 * Ничего устанавливать не нужно — файл data/market.db создаётся сам.
 * Таблицы создаются при старте, тестовые данные добавляются, если БД пустая.
 */
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const ROOT = __dirname;
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(ROOT, "data", "market.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nick          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT UNIQUE,            -- NULL у админа
  email         TEXT UNIQUE,            -- NULL у админа
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  avatar        TEXT,                   -- путь вида /uploads/xxx.jpg
  banner        TEXT,
  bio           TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  price       REAL NOT NULL CHECK (price >= 0),
  image       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (target_id, author_id)         -- один отзыв от человека на человека
);
CREATE TABLE IF NOT EXISTS support_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

/** Тестовые данные (только если пользователей ещё нет) */
function seed() {
  if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return;
  const now = Date.now(), day = 864e5;
  const adminPass = process.env.ADMIN_PASSWORD || "admin12345";
  const addUser = db.prepare(`INSERT INTO users (nick, phone, email, password_hash, role, bio, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  // Админ: логин + пароль, БЕЗ телефона и email
  addUser.run("root", null, null, bcrypt.hashSync(adminPass, 10), "admin", "Администратор платформы", now - 9 * day);
  addUser.run("anna", "+79001234567", "anna@example.com", bcrypt.hashSync("user12345", 10), "user", "Продаю вещи, которыми не пользуюсь.", now - 8 * day);
  addUser.run("pavel", "+79007654321", "pavel@example.com", bcrypt.hashSync("user12345", 10), "user", "Коллекционирую винтаж.", now - 8 * day);

  const addItem = db.prepare(`INSERT INTO listings (seller_id, title, description, price, created_at) VALUES (?,?,?,?,?)`);
  addItem.run(2, "Велосипед городской", "Рама 54, состояние хорошее, недавно обслужен.", 12000, now - 3 * day);
  addItem.run(3, "Кожаная куртка", "Размер M, носили два сезона.", 6500, now - 2 * day);
  addItem.run(3, "Виниловый проигрыватель", "Работает отлично, игла новая.", 8900, now - day);
  addItem.run(2, "Настольная лампа", "Металл, регулируемый свет.", 1500, now - day / 2);
  addItem.run(2, "Рюкзак для города", "Влагостойкая ткань, 25 литров.", 2200, now);

  const addRev = db.prepare(`INSERT INTO reviews (target_id, author_id, stars, text, created_at) VALUES (?,?,?,?,?)`);
  addRev.run(2, 3, 5, "Быстро договорились, всё как в описании.", now - 2 * day);
  addRev.run(2, 1, 4, "Хороший продавец, немного задержала ответ.", now - day);
  addRev.run(3, 2, 5, "Отличный покупатель, рекомендую.", now - day);
  console.log("[seed] Созданы тестовые данные. Админ: root (пароль — в переменной ADMIN_PASSWORD)");
}

module.exports = { db, seed, ROOT };
