function clean(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return String(value).trim();
}
function toNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const parsed = Number(
    String(value).replace(/[$,]/g, "")
  );

  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeRow(row) {
  return {
    agentName: clean(row.agent),

    firstName: clean(row.firstname),
    dob: row.dob ? new Date(row.dob) : null,
    address: clean(row.address),
    phoneNumber: clean(row.phone),
    state: clean(row.state),
    zipCode: clean(row.zip),
    email: clean(row.email)?.toLowerCase(),
    gender: clean(row.gender),
    userType: clean(row.userType),

    accountName: clean(row.account_name),

    categoryName: clean(row.category_name),

    companyName: clean(row.company_name),

    policyNumber: clean(row.policy_number),

    policyMode: clean(row.policy_mode),

    producer: clean(row.producer),

    premiumAmountWritten:
      toNumber(row.premium_amount_written),

    premiumAmount:
      toNumber(row.premium_amount),

    policyType:
      clean(row.policy_type),

    policyStartDate:
      row.policy_start_date
        ? new Date(row.policy_start_date)
        : null,

    policyEndDate:
      row.policy_end_date
        ? new Date(row.policy_end_date)
        : null
  };
}

function uniqueBy(items, key) {
  const map = new Map();

  for (const item of items) {
    const value = item[key];

    if (!value) {
      continue;
    }

    map.set(
      String(value).toLowerCase(),
      item
    );
  }

  return [...map.values()];
}



function getColumn(row, aliases) {
  const keys = Object.keys(row);

  const matchedKey = keys.find((key) => {
    const normalizedKey = key
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    return aliases.some((alias) => {
      const normalizedAlias = alias
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      return normalizedKey === normalizedAlias;
    });
  });

  return matchedKey
    ? row[matchedKey]
    : null;
}

module.exports = {
  normalizeRow,
  uniqueBy,
  clean,
  getColumn
};