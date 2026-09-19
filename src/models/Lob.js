const mongoose = require("mongoose");

const lobSchema = new mongoose.Schema(
  {
    categoryName: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);

lobSchema.index({ categoryName: 1 }, { unique: true });

module.exports = mongoose.model("LOB", lobSchema);