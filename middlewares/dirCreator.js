const fs = require("fs");

module.exports = (req, res, next) => {
  const path = "uploads/assets";
  fs.access(path, (error) => {
    // To check if the given directory
    // already exists or not
    if (error) {
      // If current directory does not exist
      // then create it
      fs.mkdir(path, (error) => {
        if (error) {
          res.status(400).json({
            status: "failed",
            message: "Directory creation failed",
            error,
          });
        } else {
          console.log(path);
          next();
        }
      });
    } else {
      console.log(path);
      next();
    }
  });
};
