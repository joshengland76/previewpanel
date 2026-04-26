import express from "express";

const app = express();

app.get("/health", (_, res) => {
  console.log("[health] OK");
  res.json({ ok: true });
});

app.get("/", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Minimal server listening on 0.0.0.0:${PORT}`);
});
