const jwt = require("jsonwebtoken");
const { User } = require("../models/User");

module.exports = async (req, res, next) => {
  const token = req.header("x-auth-token");
  if (!token) return res.status(401).json("Access denied"); // no token provided

  try {
    const payload = jwt.verify(token, process.env.JWT_KEY);
    if (!payload) return res.status(400).json("Invalid token provided!");
    const userInfo = await User.findById(payload?.userId);
    if (!userInfo) return res.status(404).send("User account not found");
    if (userInfo.accountType !== "manager")
      return res.status(422).send("Unauthorized request!!!");
    req.user = payload;
    next();
  } catch (err) {
    res.status(400).json("Invalid token provided!");
  }
};
