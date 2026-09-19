const mongoose = require("mongoose");

const policySchema = new mongoose.Schema(
  {
    policyNumber: {
      type: String,
      required: true,
      unique: true
    },

    policyMode: {
      type: String,
      trim: true
    },

    producer: {
      type: String,
      trim: true
    },

    premiumAmountWritten: {
      type: Number,
      default: 0
    },

    premiumAmount: {
      type: Number,
      default: 0
    },

    policyType: {
      type: String,
      trim: true
    },

    policyStartDate: {
      type: Date
    },

    policyEndDate: {
      type: Date
    },

    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LOB",
      required: true
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Carrier",
      required: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Policy", policySchema);
