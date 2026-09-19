
const mongoose = require("mongoose");

const carrierSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);

carrierSchema.index({ companyName: 1 }, { unique: true });

module.exports = mongoose.model("Carrier", carrierSchema);