const autobahn = require("autobahn");
const BN = require("bn.js");
const geoip = require("geoip-lite");
const { sha256 } = require("js-sha256");
const stats = require("./stats");

const models = require("../models");

const {
  wampNearNetworkName,
  wampNearExplorerUrl,
  wampNearExplorerBackendSecret,
  nearLockupAccountIdSuffix,
} = require("./config");

const { nearRpc } = require("./near");

const wampHandlers = {};

wampHandlers["node-telemetry"] = async ([nodeInfo]) => {
  let geo = geoip.lookup(nodeInfo.ip_address);
  if (geo) {
    nodeInfo.latitude = geo.ll[0];
    nodeInfo.longitude = geo.ll[1];
    nodeInfo.city = geo.city;
  } else {
    console.warn("Node Telemetry failed to lookup geoIP for ", nodeInfo);
  }
  return;
  //return saveNodeIntoDatabase(nodeInfo);
};

const saveNodeIntoDatabase = async (nodeInfo) => {
  if (!nodeInfo.hasOwnProperty("agent")) {
    // This seems to be an old format, and all our nodes should support the new
    // Telemetry format as of 2020-04-14, so we just ignore those old Telemetry
    // reports.
    return;
  }
  return await models.Node.upsert({
    ipAddress: nodeInfo.ip_address,
    latitude: nodeInfo.latitude,
    longitude: nodeInfo.longitude,
    city: nodeInfo.city,
    lastSeen: Date.now(),
    nodeId: nodeInfo.chain.node_id,
    moniker: nodeInfo.chain.account_id,
    accountId: nodeInfo.chain.account_id,
    lastHeight: nodeInfo.chain.latest_block_height,
    peerCount: nodeInfo.chain.num_peers,
    isValidator: nodeInfo.chain.is_validator,
    lastHash: nodeInfo.chain.latest_block_hash,
    signature: nodeInfo.signature || "",
    agentName: nodeInfo.agent.name,
    agentVersion: nodeInfo.agent.version,
    agentBuild: nodeInfo.agent.build,
    status: nodeInfo.chain.status,
  });
};

wampHandlers["select"] = async ([query, replacements]) => {
  console.log("SELECT START", new Date(), query, replacements);
  if (query.includes("json_extract")) {
    console.log("SELECT BANNED json_extract");
    throw Error(
      "this query causes Explorer sluggishness, we banned it. Please, reach us out at https://github.com/near/near-explorer/discussions"
    );
  }
  const result = await models.sequelizeLegacySyncBackendReadOnly.query(query, {
    replacements,
    type: models.Sequelize.QueryTypes.SELECT,
  });
  console.log("SELECT END", new Date(), query, replacements);
  return result;
};

wampHandlers["select:INDEXER_BACKEND"] = async ([query, replacements]) => {
  console.log("SELECT INDEXER START", new Date(), query, replacements);
  const result = await models.sequelizeIndexerBackendReadOnly.query(query, {
    replacements,
    type: models.Sequelize.QueryTypes.SELECT,
  });
  console.log("SELECT INDEXER END", new Date(), query, replacements);
  return result;
};

wampHandlers["nearcore-view-account"] = async ([accountId]) => {
  console.log("VIEW ACCOUNT START", new Date(), accountId);
  const result = await nearRpc.sendJsonRpc("query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
  console.log("VIEW ACCOUNT END", new Date(), accountId);
  return result;
};

wampHandlers["nearcore-view-access-key-list"] = async ([accountId]) => {
  console.log("VIEW ACCESS KEY LIST START", new Date(), accountId);
  const result = await nearRpc.sendJsonRpc("query", {
    request_type: "view_access_key_list",
    finality: "final",
    account_id: accountId,
  });
  console.log("VIEW ACCESS KEY LIST END", new Date(), accountId);
  return result;
};

wampHandlers["nearcore-tx"] = async ([transactionHash, accountId]) => {
  console.log("TX START", new Date(), transactionHash, accountId);
  const result = await nearRpc.sendJsonRpc("tx", [transactionHash, accountId]);
  console.log("TX END", new Date(), transactionHash, accountId);
  return result;
};

wampHandlers["nearcore-final-block"] = async () => {
  console.log("FINAL BLOCK START", new Date());
  const result = await nearRpc.sendJsonRpc("block", { finality: "final" });
  console.log("FINAL BLOCK END", new Date());
  return result;
};

wampHandlers["nearcore-status"] = async () => {
  console.log("STATUS START", new Date());
  const result = await nearRpc.sendJsonRpc("status");
  console.log("STATUS END", new Date());
  return result;
};

wampHandlers["nearcore-validators"] = async () => {
  console.log("VALIDATORS START", new Date());
  const result = await nearRpc.sendJsonRpc("validators", [null]);
  console.log("VALIDATORS END", new Date());
  return result;
};

wampHandlers["get-account-details"] = async ([accountId]) => {
  console.log("GET ACCOUNT DETAILS START", new Date(), accountId);
  function generateLockupAccountIdFromAccountId(accountId) {
    // copied from https://github.com/near/near-wallet/blob/f52a3b1a72b901d87ab2c9cee79770d697be2bd9/src/utils/wallet.js#L601
    return (
      sha256(Buffer.from(accountId)).substring(0, 40) +
      "." +
      nearLockupAccountIdSuffix
    );
  }

  function ignore_if_does_not_exist(error) {
    if (
      typeof error.message === "string" &&
      (error.message.includes("doesn't exist") ||
        error.message.includes("does not exist") ||
        error.message.includes("MethodNotFound"))
    ) {
      return null;
    }
    throw error;
  }

  let lockupAccountId;
  if (accountId.endsWith(`.${nearLockupAccountIdSuffix}`)) {
    lockupAccountId = accountId;
  } else {
    lockupAccountId = generateLockupAccountIdFromAccountId(accountId);
  }

  const [
    accountInfo,
    lockupAccountInfo,
    lockupLockedBalance,
    lockupStakingPoolAccountId,
    genesisConfig,
  ] = await Promise.all([
    nearRpc
      .sendJsonRpc("query", {
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      })
      .catch(ignore_if_does_not_exist),
    accountId !== lockupAccountId
      ? nearRpc
          .sendJsonRpc("query", {
            request_type: "view_account",
            finality: "final",
            account_id: lockupAccountId,
          })
          .catch(ignore_if_does_not_exist)
      : null,
    nearRpc
      .callViewMethod(lockupAccountId, "get_locked_amount", {})
      .then((balance) => new BN(balance))
      .catch(ignore_if_does_not_exist),
    nearRpc
      .callViewMethod(lockupAccountId, "get_staking_pool_account_id", {})
      .catch(ignore_if_does_not_exist),
    nearRpc.sendJsonRpc("EXPERIMENTAL_genesis_config", {}),
  ]);

  if (accountInfo === null) {
    return null;
  }

  const storageUsage = new BN(accountInfo.storage_usage);
  const storageAmountPerByte = new BN(
    genesisConfig.runtime_config.storage_amount_per_byte
  );
  const stakedBalance = new BN(accountInfo.locked);
  const nonStakedBalance = new BN(accountInfo.amount);
  const minimumBalance = storageAmountPerByte.mul(storageUsage);
  const availableBalance = nonStakedBalance
    .add(stakedBalance)
    .sub(BN.max(stakedBalance, minimumBalance));

  const accountDetails = {
    storageUsage: storageUsage.toString(),
    stakedBalance: stakedBalance.toString(),
    nonStakedBalance: nonStakedBalance.toString(),
    minimumBalance: minimumBalance.toString(),
    availableBalance: availableBalance.toString(),
  };

  let lockupDelegatedToStakingPoolBalance;
  if (lockupStakingPoolAccountId) {
    lockupDelegatedToStakingPoolBalance = await nearRpc
      .callViewMethod(lockupStakingPoolAccountId, "get_account_total_balance", {
        account_id: lockupAccountId,
      })
      .then((balance) => new BN(balance))
      .catch(ignore_if_does_not_exist);
  }

  let totalBalance = stakedBalance.add(nonStakedBalance);
  // The following section could be compressed into more complicated checks,
  // but it is left in a readable form.
  if (accountId !== lockupAccountId && !lockupAccountInfo) {
    // It is a regular account without lockup
  } else if (accountId !== lockupAccountId) {
    // It is a regular account with lockup
    const lockupStakedBalance = new BN(lockupAccountInfo.locked);
    const lockupNonStakedBalance = new BN(lockupAccountInfo.amount);
    let lockupTotalBalance = lockupStakedBalance.add(lockupNonStakedBalance);
    if (lockupDelegatedToStakingPoolBalance) {
      console.log(lockupTotalBalance, lockupDelegatedToStakingPoolBalance);
      lockupTotalBalance.iadd(lockupDelegatedToStakingPoolBalance);
    }
    totalBalance.iadd(lockupTotalBalance);
    accountDetails.lockupAccountId = lockupAccountId;
    accountDetails.lockupTotalBalance = lockupTotalBalance.toString();
    accountDetails.lockupLockedBalance = lockupLockedBalance.toString();
    accountDetails.lockupUnlockedBalance = lockupTotalBalance
      .sub(lockupLockedBalance)
      .toString();
  } else if (accountId === lockupAccountId) {
    // It is a lockup account
    if (lockupDelegatedToStakingPoolBalance) {
      totalBalance.iadd(lockupDelegatedToStakingPoolBalance);
    }
  }

  accountDetails.totalBalance = totalBalance.toString();

  console.log("GET ACCOUNT DETAILS END", new Date(), accountId);
  return accountDetails;
};

wampHandlers["transactions-count-aggregated-by-date"] = async () => {
  console.log("STATS tx count", new Date(), accountId);
  return await stats.getTransactionsByDate();
};

wampHandlers["teragas-used-aggregated-by-date"] = async () => {
  console.log("STATS gas", new Date(), accountId);
  return await stats.getTeragasUsedByDate();
};

wampHandlers["new-accounts-count-aggregated-by-date"] = async () => {
  console.log("STATS new accounts", new Date(), accountId);
  return await stats.getNewAccountsCountByDate();
};

wampHandlers["new-contracts-count-aggregated-by-date"] = async () => {
  console.log("STATS new contracts", new Date(), accountId);
  return await stats.getNewContractsCountByDate();
};

wampHandlers["active-contracts-count-aggregated-by-date"] = async () => {
  console.log("STATS active contracts", new Date(), accountId);
  return await stats.getActiveContractsCountByDate();
};

wampHandlers["active-accounts-count-aggregated-by-date"] = async () => {
  console.log("STATS active accounts", new Date(), accountId);
  return await stats.getActiveAccountsCountByDate();
};

wampHandlers["active-accounts-list"] = async () => {
  console.log("STATS accounts list", new Date(), accountId);
  return await stats.getActiveAccountsList();
};

wampHandlers["active-contracts-list"] = async () => {
  console.log("STATS contracts list", new Date(), accountId);
  return await stats.getActiveContractsList();
};

function setupWamp() {
  const wamp = new autobahn.Connection({
    realm: "near-explorer",
    transports: [
      {
        url: wampNearExplorerUrl,
        type: "websocket",
      },
    ],
    authmethods: ["ticket"],
    authid: "near-explorer-backend",
    onchallenge: (session, method, extra) => {
      if (method === "ticket") {
        return wampNearExplorerBackendSecret;
      }
      throw "WAMP authentication error: unsupported challenge method";
    },
    retry_if_unreachable: true,
    max_retries: Number.MAX_SAFE_INTEGER,
    max_retry_delay: 10,
  });

  wamp.onopen = async (session) => {
    console.log("WAMP connection is established. Waiting for commands...");

    for (const [name, handler] of Object.entries(wampHandlers)) {
      const uri = `com.nearprotocol.${wampNearNetworkName}.explorer.${name}`;
      try {
        await session.register(uri, handler);
      } catch (error) {
        console.error(`Failed to register "${uri}" handler due to:`, error);
        wamp.close();
        setTimeout(() => {
          wamp.open();
        }, 1000);
        return;
      }
    }
  };

  wamp.onclose = (reason) => {
    console.log(
      "WAMP connection has been closed (check WAMP router availability and credentials):",
      reason
    );
  };

  return wamp;
}

const wampPublish = (topic, args, wamp) => {
  const uri = `com.nearprotocol.${wampNearNetworkName}.explorer.${topic}`;
  wamp.session.publish(uri, args);
};

exports.setupWamp = setupWamp;
exports.wampPublish = wampPublish;
