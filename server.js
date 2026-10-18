/** Точка входа: npm start → http://localhost:3000 */
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const path = require("path");
const { seed } = require("./db");
const { loadUser, errorHandler } = require("./middleware");
const { UPLOADS } = require("./util");

seed(); // создаёт тестовые данные, если БД пустая

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
// CORS: по умолчанию только тот же адрес. Для отдельного фронтенда: CORS_ORIGIN=https://site.example
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : false, credentials: true }));
app.use((req, res, next) => { res.set("X-Content-Type-Options", "nosniff"); next(); });
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(loadUser);

app.use("/uploads", express.static(UPLOADS, { maxAge: "7d" }));
app.use("/api/auth", require("./routes-auth"));
app.use("/api/admin", require("./routes-admin"));
app.use("/api", require("./routes-api"));
app.use("/api", (req, res) => res.status(404).json({ error: "Маршрут не найден" }));

// Отдаём только страницу сайта (остальные файлы проекта наружу не раздаются)
app.get(["/", "/index.html"], (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сайт запущен: http://localhost:${PORT}`));
