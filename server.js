const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = 3000;

// ================= OTOMATIS BUAT FOLDER UPLOADS =================
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ================= MULTER CONFIGURATION =================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// ================= MIDDLEWARE =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  session({
    secret: "glowskin-secret-key",
    resave: false,
    saveUninitialized: true,
  }),
);

// ================= DATABASE INITIALIZATION =================
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) {
    console.error("Database Connection Error:", err.message);
  } else {
    console.log("Berhasil terhubung ke database SQLite.");

    db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            name TEXT
        )`);

    db.run(`CREATE TABLE IF NOT EXISTS routines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            step TEXT,
            completed INTEGER DEFAULT 0
        )`);

    db.run(`CREATE TABLE IF NOT EXISTS skin_diary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            note TEXT,
            date TEXT,
            image_url TEXT
        )`);

    db.run(`CREATE TABLE IF NOT EXISTS dashboard_status (
            user_id INTEGER PRIMARY KEY,
            glasses INTEGER DEFAULT 0,
            skin_condition TEXT DEFAULT 'Normal Skin',
            mood TEXT DEFAULT 'Good',
            mood_emoji TEXT DEFAULT '🌸😊🌸'
        )`);
  }
});

// Middleware Cek Login
function requireLogin(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/login");
  }
}

// ================= AUTHENTICATION ROUTES =================
app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", (req, res) => {
  const { name, username, password } = req.body;
  db.run(
    "INSERT INTO users (name, username, password) VALUES (?, ?, ?)",
    [name, username, password],
    function (err) {
      if (err) return res.send("Username sudah digunakan!");

      db.get(
        "SELECT id FROM users WHERE username = ?",
        [username],
        (err, userRow) => {
          if (userRow) {
            const newUserId = userRow.id;
            db.run(
              'INSERT INTO dashboard_status (user_id, glasses, skin_condition, mood, mood_emoji) VALUES (?, 0, "Normal Skin", "Good", "🌸😊🌸")',
              [newUserId],
              () => {
                res.redirect("/login");
              },
            );
          } else {
            res.redirect("/login");
          }
        },
      );
    },
  );
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.get(
    "SELECT * FROM users WHERE username = ? AND password = ?",
    [username, password],
    (err, row) => {
      if (row) {
        req.session.user = row;
        res.redirect("/");
      } else {
        res.render("login", { error: "Username atau password salah!" });
      }
    },
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ================= MAIN DASHBOARD ROUTE =================
app.get("/", requireLogin, (req, res) => {
  const userId = req.session.user.id;

  db.get(
    "SELECT * FROM dashboard_status WHERE user_id = ?",
    [userId],
    (err, statusRow) => {
      const currentStatus = statusRow || {
        glasses: 0,
        skin_condition: "Normal Skin",
        mood: "Good",
        mood_emoji: "🌸😊🌸",
      };

      db.all(
        "SELECT * FROM routines WHERE user_id = ?",
        [userId],
        (err, routineRows) => {
          const routines = routineRows || [];
          const completedRoutines = routines.filter(
            (r) => r.completed === 1,
          ).length;

          res.render("dashboard", {
            user: req.session.user,
            status: currentStatus,
            routines: routines,
            completedRoutines: completedRoutines,
          });
        },
      );
    },
  );
});

// ================= STATUS & WATER TRACKER UPDATES =================
app.post("/update-condition", requireLogin, (req, res) => {
  const { skin_condition } = req.body;
  const userId = req.session.user.id;
  db.run(
    "UPDATE dashboard_status SET skin_condition = ? WHERE user_id = ?",
    [skin_condition, userId],
    () => {
      res.redirect("/");
    },
  );
});

app.post("/update-mood", requireLogin, (req, res) => {
  const { mood } = req.body;
  const userId = req.session.user.id;

  let moodEmoji = "🌸😊🌸";
  if (mood === "Happy") moodEmoji = "🥳✨💖";
  if (mood === "Tired") moodEmoji = "💤🥱☁️";
  if (mood === "Stressed") moodEmoji = "🤯🌀";

  db.run(
    "UPDATE dashboard_status SET mood = ?, mood_emoji = ? WHERE user_id = ?",
    [mood, moodEmoji, userId],
    () => {
      res.redirect("/");
    },
  );
});

app.post("/add-water", requireLogin, (req, res) => {
  db.run(
    "UPDATE dashboard_status SET glasses = MIN(glasses+1,8) WHERE user_id=?",
    [req.session.user.id],
    () => {
      res.redirect("/");
    },
  );
});

app.post("/reset-water", requireLogin, (req, res) => {
  db.run(
    "UPDATE dashboard_status SET glasses=0 WHERE user_id=?",
    [req.session.user.id],
    () => {
      res.redirect("/");
    },
  );
});

app.post("/toggle-routine/:id", requireLogin, (req, res) => {
  db.run(
    "UPDATE routines SET completed = case when completed=1 then 0 else 1 end WHERE id=? AND user_id=?",
    [req.params.id, req.session.user.id],
    () => {
      res.redirect("/");
    },
  );
});

// ================= ROUTINE TRACKER PAGE ROUTES =================
app.get("/tracker", requireLogin, (req, res) => {
  const userId = req.session.user.id;
  db.all("SELECT * FROM routines WHERE user_id = ?", [userId], (err, rows) => {
    res.render("tracker", {
      user: req.session.user,
      routines: rows || [],
    });
  });
});

app.post("/add-routine", requireLogin, (req, res) => {
  const { step } = req.body;
  const userId = req.session.user.id;
  db.run(
    "INSERT INTO routines (user_id, step, completed) VALUES (?, ?, 0)",
    [userId, step],
    () => {
      res.redirect("/tracker");
    },
  );
});

app.post("/delete-routine/:id", requireLogin, (req, res) => {
  db.run(
    "DELETE FROM routines WHERE id = ? AND user_id = ?",
    [req.params.id, req.session.user.id],
    () => {
      res.redirect("/tracker");
    },
  );
});

// ================= SKIN DIARY PAGE ROUTES =================
app.get("/diary", requireLogin, (req, res) => {
  const userId = req.session.user.id;
  db.all(
    "SELECT * FROM skin_diary WHERE user_id = ? ORDER BY id DESC",
    [userId],
    (err, rows) => {
      res.render("diary", {
        user: req.session.user,
        diaryEntries: rows || [],
      });
    },
  );
});

app.post("/add-diary", requireLogin, upload.single("image"), (req, res) => {
  const { note, date } = req.body;
  const userId = req.session.user.id;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";

  db.run(
    "INSERT INTO skin_diary (user_id, note, date, image_url) VALUES (?, ?, ?, ?)",
    [userId, note, date, imageUrl],
    () => {
      res.redirect("/diary");
    },
  );
});

// ================= RECOMMENDATIONS ROUTE =================
app.get("/recommendations", requireLogin, (req, res) => {
  const userId = req.session.user.id;

  db.get(
    "SELECT skin_condition FROM dashboard_status WHERE user_id = ?",
    [userId],
    (err, statusRow) => {
      const currentCondition =
        statusRow && statusRow.skin_condition
          ? statusRow.skin_condition
          : "Normal Skin";

      const recommendationData = {
        "Dry Skin": {
          ingredients: [
            "Hyaluronic Acid",
            "Ceramide",
            "Glycerin",
            "Shea Butter",
          ],
          tips: "Jangan mencuci muka dengan air yang terlalu panas, gunakan pelembab bertekstur krim thick.",
          products: [
            "Gentle Cream Cleanser",
            "Hydrating Toner",
            "Moisturizing Cream",
            "SPF 50 PA++++",
          ],
        },
        "Oily Skin": {
          ingredients: [
            "Salicylic Acid (BHA)",
            "Niacinamide",
            "Centella Asiatica",
            "Tea Tree",
          ],
          tips: "Gunakan pelembab bertekstur gel yang ringan (oil-free) agar tidak menyumbat pori-pori.",
          products: [
            "Gel Cleanser",
            "Exfoliating Toner",
            "Centella Gel Moisturizer",
            "Watery Sunscreen",
          ],
        },
        "Acne Prone": {
          ingredients: [
            "Salicylic Acid",
            "Benzoyl Peroxide",
            "Zinc PCA",
            "Tea Tree Oil",
          ],
          tips: "Hindari memencet jerawat secara paksa dan kurangi makanan yang terlalu manis atau berlemak.",
          products: [
            "Acne Cleanser",
            "Acne Spot Treatment",
            "Soothing Gel",
            "Physical Sunscreen",
          ],
        },
        "Normal Skin": {
          ingredients: ["Vitamin C", "Hyaluronic Acid", "Niacinamide"],
          tips: "Pertahankan kelembapan kulitmu dan selalu gunakan sunscreen di pagi hari ya!",
          products: [
            "Glow Cleanser",
            "Hydrating Toner",
            "Light Moisturizer",
            "Daily Sunscreen",
          ],
        },
      };

      const userRecommendation =
        recommendationData[currentCondition] ||
        recommendationData["Normal Skin"];

      res.render("recommendations", {
        user: req.session.user,
        condition: currentCondition,
        recommendation: userRecommendation,
      });
    },
  );
});

// ================= ARTICLES ROUTE =================
app.get("/articles", requireLogin, (req, res) => {
  res.render("articles", { user: req.session.user });
});

// ================= SERVER START =================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
