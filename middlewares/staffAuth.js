const jwt = require("jsonwebtoken");
const { User } = require("../models/User");
const { AdminFlag } = require("../models/AdminMisc");

/** Any dashboard staff (manager | professional). Sets req.user, req.me, req.isManager */
const staffAuth = async (req, res, next) => {
  const token = req.header("x-auth-token");
  if (!token) return res.status(401).json({ success: false, message: "Access denied" });
  try {
    const payload = jwt.verify(token, process.env.JWT_KEY);
    const me = await User.findById(payload.userId).select("-password -__v").lean();
    if (!me) return res.status(401).json({ success: false, message: "Invalid token provided!" });
    if (!["manager", "professional"].includes(me.accountType)) return res.status(403).json({ success: false, message: "Staff only" });
    if (me.accountType === "professional" && !me.verified) return res.status(403).json({ success: false, message: "Awaiting verification by a manager" });
    if (await AdminFlag.exists({ kind: "user", ref: me._id })) return res.status(403).json({ success: false, message: "Account suspended" });
    req.user = payload;
    req.me = me;
    req.isManager = me.accountType === "manager";
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: "Invalid token provided!" });
  }
};
const managerOnly = (req, res, next) =>
  req.isManager ? next() : res.status(403).json({ success: false, message: "Manager access required" });

module.exports = { staffAuth, managerOnly };
