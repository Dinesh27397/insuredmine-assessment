const { uniqueBy } = require("./utils.helper");

function buildAgentOperations(rows) {
    const agents = uniqueBy(
        rows.filter(row => row.agentName),
        "agentName"
    );

    return agents.map((agent) => ({
        updateOne: {
            filter: {
                agentName: agent.agentName
            },

            update: {
                $set: {
                    agentName: agent.agentName
                }
            },

            upsert: true
        }
    }));
}

function buildAccountOperations(rows) {
    const accounts = uniqueBy(
        rows.filter(row => row.accountName),
        "accountName"
    );

    return accounts.map((account) => ({
        updateOne: {
            filter: {
                accountName: account.accountName
            },

            update: {
                $set: {
                    accountName: account.accountName
                }
            },

            upsert: true
        }
    }));
}

function buildLobOperations(rows) {
    const categories = uniqueBy(
        rows.filter(row => row.categoryName),
        "categoryName"
    );

    return categories.map((item) => ({
        updateOne: {
            filter: {
                categoryName: item.categoryName
            },

            update: {
                $set: {
                    categoryName: item.categoryName
                }
            },

            upsert: true
        }
    }));
}

function buildCarrierOperations(rows) {
    const carriers = uniqueBy(
        rows.filter(row => row.companyName),
        "companyName"
    );

    return carriers.map((item) => ({
        updateOne: {
            filter: {
                companyName: item.companyName
            },

            update: {
                $set: {
                    companyName: item.companyName
                }
            },

            upsert: true
        }
    }));
}

function buildUserOperations(rows) {
    const users = uniqueBy(
        rows.filter(row => row.email),
        "email"
    );

    return users.map((user) => ({
        updateOne: {
            filter: {
                email: user.email
            },

            update: {
                $set: {
                    firstName: user.firstName,
                    dob: user.dob || null,
                    address: user.address,
                    phoneNumber: user.phoneNumber,
                    state: user.state,
                    zipCode: user.zipCode,
                    email: user.email,
                    gender: user.gender,
                    userType: user.userType
                }
            },

            upsert: true
        }
    }));
}

function buildPolicyOperations(
    rows,
    maps
) {
    const {
        userMap,
        lobMap,
        carrierMap
    } = maps;

    // One update per policy keeps unordered writes deterministic for duplicate rows.
    // Policy numbers use the same case-sensitive identity as the database index.
    const policies = new Map();
    for (const row of rows) {
        if (row.policyNumber) policies.set(row.policyNumber, row);
    }

    return [...policies.values()]
        .map((row) => {

            return {
                updateOne: {
                    filter: {
                        policyNumber:
                            row.policyNumber
                    },

                    update: {
                        $set: {
                            policyNumber:
                                row.policyNumber,

                            policyMode:
                                row.policyMode,

                            producer:
                                row.producer,

                            premiumAmountWritten:
                                row.premiumAmountWritten,

                            premiumAmount:
                                row.premiumAmount,

                            policyType:
                                row.policyType,

                            policyStartDate:
                                row.policyStartDate,

                            policyEndDate:
                                row.policyEndDate,

                            userId:
                                userMap.get(
                                    row.email?.toLowerCase()
                                ),

                            categoryId:
                                lobMap.get(
                                    row.categoryName?.toLowerCase()
                                ),

                            companyId:
                                carrierMap.get(
                                    row.companyName?.toLowerCase()
                                )
                        }
                    },

                    upsert: true
                }
            };
        });
}



module.exports = {
    buildAgentOperations,
    buildAccountOperations,
    buildLobOperations,
    buildCarrierOperations,
    buildUserOperations,
    buildPolicyOperations
};
