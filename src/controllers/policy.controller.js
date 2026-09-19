const User = require("../models/user");

const searchPoliciesByUsername = async (req, res) => {
  try {
    const rawUsername = req.query.username;

    if (rawUsername !== undefined && typeof rawUsername !== "string") {
      return res.status(400).json({
        success: false,
        message: "username must be a single string"
      });
    }

    let username = (rawUsername || "").trim();
    const quote = username[0];
    if (username.length >= 2 && (quote === '"' || quote === "'") && username.endsWith(quote)) {
      username = username.slice(1, -1).trim();
    }

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "username is required"
      });
    }

    // Treat a username as literal text while retaining partial, case-insensitive search.
    const searchText = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const results = await User.aggregate([
      {
        $match: {
          firstName: {
            $regex: searchText,
            $options: "i"
          }
        }
      },

      {
        $lookup: {
          from: "policies",
          localField: "_id",
          foreignField: "userId",
          as: "policies"
        }
      },

      {
        $unwind: {
          path: "$policies",
          preserveNullAndEmptyArrays: false
        }
      },

      {
        $lookup: {
          from: "lobs",
          localField: "policies.categoryId",
          foreignField: "_id",
          as: "category"
        }
      },

      {
        $lookup: {
          from: "carriers",
          localField: "policies.companyId",
          foreignField: "_id",
          as: "carrier"
        }
      },

      {
        $lookup: {
          from: "agents",
          localField: "policies.agentId",
          foreignField: "_id",
          as: "agent"
        }
      },

      {
        $project: {
          _id: 0,

          user: {
            id: "$_id",
            firstName: "$firstName",
            email: "$email",
            phoneNumber: "$phoneNumber"
          },

          policy: {
            policyNumber: "$policies.policyNumber",
            policyStartDate: "$policies.policyStartDate",
            policyEndDate: "$policies.policyEndDate",

            category: {
              $arrayElemAt: [
                "$category.categoryName",
                0
              ]
            },

            carrier: {
              $arrayElemAt: [
                "$carrier.companyName",
                0
              ]
            },

            agent: {
              $arrayElemAt: [
                "$agent.agentName",
                0
              ]
            }
          }
        }
      }
    ]);

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });

  } catch (error) {
    console.error(
      "[PolicyController] Search error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to search policies"
    });
  }
};

const getPoliciesByUser = async (req, res) => {
  try {
    const results = await User.aggregate([
      {
        $lookup: {
          from: "policies",
          localField: "_id",
          foreignField: "userId",
          as: "policies"
        }
      },

      {
        $match: {
          "policies.0": {
            $exists: true
          }
        }
      },

      {
        $project: {
          _id: 0,

          userId: "$_id",

          firstName: 1,
          email: 1,

          policyCount: {
            $size: "$policies"
          },

          policies: {
            $map: {
              input: "$policies",
              as: "policy",

              in: {
                policyNumber:
                  "$$policy.policyNumber",

                policyStartDate:
                  "$$policy.policyStartDate",

                policyEndDate:
                  "$$policy.policyEndDate"
              }
            }
          }
        }
      },

      {
        $sort: {
          policyCount: -1
        }
      }
    ]);

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message:
        "Failed to aggregate policies"
    });
  }
};

module.exports = {
  searchPoliciesByUsername,
  getPoliciesByUser
};
