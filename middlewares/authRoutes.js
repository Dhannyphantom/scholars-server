const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const token = req.header("x-auth-token");
  if (!token) return res.status(401).send("Access denied"); // no token provided

  try {
    const payload = jwt.verify(token, process.env.JWT_KEY);
    if (!payload) return res.status(400).send("Invalid token provided!");
    req.user = payload;
    next();
  } catch (err) {
    res.status(400).send("Invalid token provided!");
  }
};
