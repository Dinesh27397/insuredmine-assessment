const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      trim: true
    },

    dob: {
      type: Date
    },

    address: {
      type: String
    },

    phoneNumber: {
      type: String
    },

    state: {
      type: String
    },

    zipCode: {
      type: String
    },

    email: {
      type: String,
      lowercase: true,
      trim: true
    },

    gender: {
      type: String
    },

    userType: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("User", userSchema);