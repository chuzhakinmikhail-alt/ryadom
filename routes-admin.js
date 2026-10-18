/** Админ-действия. Весь роутер защищён requireAdmin */
const router = require("express").Router();
const { db } = require("./db");
const { requireAdmin } = require("./middleware");
const { HttpError, removeFile } = require("./util");

router.use(requireAdmin);

router.delete("/support/:id", (req, res) => {
  db.prepare("DELETE FROM support_messages WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

router.patch("/users/:id/role", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, "Нельзя менять собственную роль");
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!u) throw new HttpError(404, "Пользователь не найден");
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(u.role === "admin" ? "user" : "admin", id);
  res.json({ ok: true });
});

router.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, "Нельзя удалить самого себя");
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!u) throw new HttpError(404, "Пользователь не найден");
  const imgs = db.prepare("SELECT image FROM listings WHERE seller_id = ?").all(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id); // объявления и отзывы удалятся каскадом
  [u.avatar, u.banner, ...imgs.map((i) => i.image)].forEach(removeFile);
  res.json({ ok: true });
});

module.exports = router;
