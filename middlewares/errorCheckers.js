module.exports.checkUploadAvater = (req, res, next) => {
  // DO some check logic
  const data = req.body;
  console.log(data);
  next();
};
