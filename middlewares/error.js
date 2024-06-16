module.exports = (err, req, res, next) => {
  res.status(500).json(`Something went wrong: ${err.message}`);
};
