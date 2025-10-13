export default function handler(req, res) {
  res.status(200).json({ ok: true, from: "pages-router", method: req.method });
}

