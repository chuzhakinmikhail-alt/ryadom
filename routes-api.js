/** Данные для фронтенда, профиль, объявления, отзывы, поддержка */
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { db } = require("./db");
const { requireAuth, wrap } = require("./middleware");
const U = require("./util");
const { HttpError, str } = U;

const isAdmin = (u) => u && u.role === "admin";

// Всё нужное для отрисовки одним запросом. Телефоны/email видны только админу и самому владельцу
router.get("/bootstrap", (req, res) => {
  const me = req.user;
  res.json({
    me: me ? U.user(me, true) : null,
    users: db.prepare("SELECT * FROM users ORDER BY id").all().map((u) => U.user(u, isAdmin(me) || (me && me.id === u.id))),
    items: db.prepare("SELECT * FROM listings ORDER BY created_at DESC").all().map(U.item),
    reviews: db.prepare("SELECT * FROM reviews ORDER BY created_at DESC").all().map(U.review),
    msgs: isAdmin(me) ? db.prepare("SELECT * FROM support_messages ORDER BY created_at DESC").all().map(U.message) : [],
  });
});

/* ---------- Профиль ---------- */
router.put("/profile", requireAuth, U.upload.fields([{ name: "avatar", maxCount: 1 }, { name: "banner", maxCount: 1 }]), wrap(async (req, res) => {
  const me = req.user, nick = str(req.body.nick, 20), bio = str(req.body.bio, 300);
  const files = req.files || {};
  const cleanup = () => Object.values(files).flat().forEach((f) => U.removeFile(U.urlOf(f)));
  try {
    if (!U.okNick(nick)) throw new HttpError(400, "Никнейм: 3–20 букв, цифр, _ или -");
    if (db.prepare("SELECT 1 FROM users WHERE nick = ? AND id != ?").get(nick, me.id)) throw new HttpError(409, "Никнейм уже занят");
    let hash = me.password_hash;
    if (req.body.newPassword) {
      if (String(req.body.newPassword).length < 6) throw new HttpError(400, "Новый пароль: от 6 символов");
      if (!(await bcrypt.compare(String(req.body.oldPassword || ""), me.password_hash))) throw new HttpError(400, "Текущий пароль неверный");
      hash = await bcrypt.hash(String(req.body.newPassword), 10);
    }
    const avatar = files.avatar ? U.urlOf(files.avatar[0]) : me.avatar, banner = files.banner ? U.urlOf(files.banner[0]) : me.banner;
    db.prepare("UPDATE users SET nick=?, bio=?, password_hash=?, avatar=?, banner=? WHERE id=?").run(nick, bio, hash, avatar || null, banner || null, me.id);
    if (files.avatar) U.removeFile(me.avatar);
    if (files.banner) U.removeFile(me.banner);
    res.json({ ok: true });
  } catch (e) { cleanup(); throw e; }
}));

/* ---------- Объявления ---------- */
const listingData = (b) => {
  const title = str(b.title, 80), description = str(b.description, 2000), price = Number(b.price);
  if (!title || !description) throw new HttpError(400, "Заполните название и описание");
  if (!Number.isFinite(price) || price < 0 || price > 1e9) throw new HttpError(400, "Некорректная цена");
  return { title, description, price };
};
const canEdit = (u, g) => isAdmin(u) || g.seller_id === u.id;
const findListing = (id) => {
  const g = db.prepare("SELECT * FROM listings WHERE id = ?").get(Number(id));
  if (!g) throw new HttpError(404, "Объявление не найдено");
  return g;
};

router.post("/listings", requireAuth, U.upload.single("photo"), (req, res) => {
  try {
    const d = listingData(req.body);
    const r = db.prepare("INSERT INTO listings (seller_id, title, description, price, image, created_at) VALUES (?,?,?,?,?,?)")
      .run(req.user.id, d.title, d.description, d.price, U.urlOf(req.file), Date.now());
    res.status(201).json({ id: String(r.lastInsertRowid) });
  } catch (e) { if (req.file) U.removeFile(U.urlOf(req.file)); throw e; }
});

router.put("/listings/:id", requireAuth, U.upload.single("photo"), (req, res) => {
  try {
    const g = findListing(req.params.id);
    if (!canEdit(req.user, g)) throw new HttpError(403, "Это чужое объявление");
    const d = listingData(req.body), img = req.file ? U.urlOf(req.file) : g.image;
    db.prepare("UPDATE listings SET title=?, description=?, price=?, image=? WHERE id=?").run(d.title, d.description, d.price, img || null, g.id);
    if (req.file) U.removeFile(g.image);
    res.json({ ok: true });
  } catch (e) { if (req.file) U.removeFile(U.urlOf(req.file)); throw e; }
});

router.delete("/listings/:id", requireAuth, (req, res) => {
  const g = findListing(req.params.id);
  if (!canEdit(req.user, g)) throw new HttpError(403, "Это чужое объявление");
  db.prepare("DELETE FROM listings WHERE id = ?").run(g.id);
  U.removeFile(g.image);
  res.json({ ok: true });
});

// Контакты продавца — только для вошедших пользователей
router.get("/listings/:id/contact", requireAuth, (req, res) => {
  const g = findListing(req.params.id);
  const s = db.prepare("SELECT nick, phone, email FROM users WHERE id = ?").get(g.seller_id);
  res.json({ nick: s.nick, phone: s.phone || "", email: s.email || "" });
});

/* ---------- Отзывы ---------- */
router.post("/reviews", requireAuth, (req, res) => {
  const to = Number(req.body.to), stars = Number(req.body.stars), text = str(req.body.text, 600);
  if (to === req.user.id) throw new HttpError(400, "Нельзя оставить отзыв самому себе");
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(to)) throw new HttpError(404, "Пользователь не найден");
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, "Оценка от 1 до 5");
  if (!text) throw new HttpError(400, "Напишите текст отзыва");
  // Повторный отзыв того же автора обновляет прежний
  db.prepare(`INSERT INTO reviews (target_id, author_id, stars, text, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(target_id, author_id) DO UPDATE SET stars=excluded.stars, text=excluded.text, created_at=excluded.created_at`)
    .run(to, req.user.id, stars, text, Date.now());
  res.status(201).json({ ok: true });
});

router.delete("/reviews/:id", requireAuth, (req, res) => {
  const r = db.prepare("SELECT * FROM reviews WHERE id = ?").get(Number(req.params.id));
  if (!r) throw new HttpError(404, "Отзыв не найден");
  if (!isAdmin(req.user) && r.author_id !== req.user.id) throw new HttpError(403, "Нельзя удалить чужой отзыв");
  db.prepare("DELETE FROM reviews WHERE id = ?").run(r.id);
  res.json({ ok: true });
});

/* ---------- Поддержка (доступна и гостям) ---------- */
router.post("/support", (req, res) => {
  const name = str(req.body.name, 60), email = str(req.body.email, 120), text = str(req.body.text, 2000);
  if (!name || !text) throw new HttpError(400, "Заполните имя и сообщение");
  if (!U.okMail(email)) throw new HttpError(400, "Введите корректный email");
  db.prepare("INSERT INTO support_messages (user_id, name, email, text, created_at) VALUES (?,?,?,?,?)")
    .run(req.user ? req.user.id : null, name, email, text, Date.now());
  res.status(201).json({ ok: true });
});

module.exports = router;
