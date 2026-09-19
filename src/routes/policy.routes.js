const express = require("express");
const router = express.Router();
const { searchPoliciesByUsername, getPoliciesByUser } = require("../controllers/policy.controller");

router.get("/search", searchPoliciesByUsername);
router.get(
  "/users",
  getPoliciesByUser
);

module.exports = router;