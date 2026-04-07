const express = require("express");
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  next();
});

const TOKENS = [
  "token=UaDZOuDHylFfk6ya7l2GhXdM8o0hWZ5UJNiLRRrPneLqYVLJiIM6o-MoOODdB-YZlCe88a0VzdRAxzInln30kFRa7hSBexr-3O9fu4BOQGYVyD9xWy0IxAbOUZt0_-OrmdBQLCnDHTm_WLmOlOwi8dEhhIsPrR4-99OQDl97rSU.cv4",
  "token=gqtZdMXbFGWWIjkjJbzcJc5Sy6A9-H7t6s2JWQRgVZlVhPL7hTyNnhBpDEHkKK4cB_2KX3ywMIqt_aHRn0ScNHiOvkb9-7doDQBaDhzjmysa4pzhTYhdLslbmCwLuQJJDJsYs7FdaYxmXBMV6jb-4zYdMnwo7KGRZXkrpfEl1Xs.cv4",
  "token=aFK5vySBaNXHI06-0e90VGTTU1MVIQMeMfAgsn_jEoy56Y54vPAA74BG0BJ-YT1owkoZNK5fQXtDEjCaXQdFUFl7cRpCKf3z3dzEyPmT86ZIZYB8JkDC8f_OK0B2beVU-q8-jdiD1hzicky8pXxVWnVnnTvG8N6eNmLvzLfVMmc.cv3",
  "token=XNop1KF8cMQRP2hLuxN-w2ddaHeqvheupT1ZmAVuCXBxUOyDKyo78p4Ev6Jxb1Bk12gNl9x9WxaloIrsAGrRMXOW-LZWrlF6xCJrIAhIccYWU4crOxiFT2xj1NFEo5mf516olfQyOUn0e1V2qvgRpojtLCsQ5H8k_ZuilOzwNzQ.cv3",
  "token=WqbjBxWQev3N7-_KGH-IO8-QIqnqaQjlJ2OkjfLJVun2mZAH_BH8N7uogHrkNPrfcGK3KRFVK-Y5mCdFBRIF-9CiYHNuDmamVesLkzAnwnXaNGEqoZaF4_B9z4SerucFfAkVxLLGYe3Lc0IXXsruorj1lcmBX-5EfJVJfoLIvpk.cv4",
];

const SECRET_KEY = process.env.SECRET_KEY || "Ahmad_Investor_2026";
const TARGET_URL = "https://desktop-llm.skywork.ai/skycowork_llm/v1/proxy/chat/completions";
const PORT = process.env.PORT || 3000;

app.options("/v1/chat/completions", (req, res) => res.status(204).end());

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Skywork Proxy is running" });
});

app.post("/v1/chat/completions", async (req, res) => {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${SECRET_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body;

  for (const token of TOKENS) {
    try {
      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dummy",
          "x-skywork-cookies": token,
        },
        body: JSON.stringify(body),
      });

      if (response.status === 200) {
        const contentType = response.headers.get("content-type") || "application/json";
        res.setHeader("Content-Type", contentType);

        const isStream = body?.stream === true || contentType.includes("text/event-stream");

        if (isStream && response.body) {
          res.status(200);
          const reader = response.body.getReader();
          const pump = async () => {
            const { done, value } = await reader.read();
            if (done) return res.end();
            res.write(value);
            return pump();
          };
          await pump();
        } else {
          const data = await response.json();
          res.status(200).json(data);
        }
        return;
      }
    } catch {
      continue;
    }
  }

  res.status(500).json({ error: "All tokens failed" });
});

app.listen(PORT, () => {
  console.log(`Skywork Proxy running on port ${PORT}`);
});
