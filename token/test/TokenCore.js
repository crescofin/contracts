"user strict";

/**
 * @author Cyril Lapinte - <cyril.lapinte@openfiz.com>
 */

const assertRevert = require("./helpers/assertRevert");
const TokenProxy = artifacts.require("TokenProxy.sol");
const TokenCore = artifacts.require("TokenCore.sol");
const TokenDelegate = artifacts.require("TokenDelegate.sol");
const UserRegistryMock = artifacts.require("UserRegistryMock.sol");
const RatesProviderMock = artifacts.require("RatesProviderMock.sol");

const NAME = "Token";
const SYMBOL = "TKN";
const DECIMALS = 18;
const SYMBOL_BYTES = web3.utils.toHex("TKN").padEnd(66, "0");
//const CHF = "CHF";
const CHF_BYTES = web3.utils.toHex("CHF").padEnd(66, "0");
const NULL_ADDRESS = "0x".padEnd(42, "0");
const EMPTY_BYTES = "0x".padEnd(66, "0");
const NEXT_YEAR = Math.floor(new Date().getTime() / 1000) + (24 * 3600 * 365);

const AUDIT_MODE_TRIGGERS_ONLY = 1;

// const AUDIT_MODE_ALWAYS = 3;

const AUDIT_STORAGE_MODE_SHARED = 2;

contract("TokenCore", function (accounts) {
  let token, core, delegate, userRegistry, ratesProvider;

  beforeEach(async function () {
    delegate = await TokenDelegate.new();
    core = await TokenCore.new("Test", [accounts[0]]);

    ratesProvider = await RatesProviderMock.new("Test");
    await ratesProvider.defineCurrencies([CHF_BYTES, SYMBOL_BYTES], ["0" , "0"], "100");
    await ratesProvider.defineRates(["150"]);
    userRegistry = await UserRegistryMock.new("Test", CHF_BYTES, accounts, NEXT_YEAR);
    await userRegistry.updateUserAllExtended(1, ["5", "50000", "50000"]);
    await userRegistry.updateUserAllExtended(2, ["5", "50000", "50000"]);
    await userRegistry.updateUserAllExtended(3, ["5", "50000", "50000"]);
  });

  it("should have a name", async function () {
    const name = await core.name();
    assert.equal(name, "Test", "name");
  });

  it("should have no oracle", async function () {
    const oracle = await core.oracle();
    assert.equal(oracle[0], NULL_ADDRESS, "user registry");
    assert.equal(oracle[1], EMPTY_BYTES, "currency");
  });

  it("should have no token delegates", async function () {
    const delegateAddress = await core.delegates(1);
    assert.equal(delegateAddress, NULL_ADDRESS, "no delegate addresses");
  });

  it("should define token delegate with configurations", async function () {
    const tx = await core.defineTokenDelegate(1, delegate.address, [1, 2, 3]);
    
    assert.ok(tx.receipt.status, "Status");
    assert.equal(tx.logs.length, 1);
    assert.equal(tx.logs[0].event, "TokenDelegateDefined", "event");
    assert.equal(tx.logs[0].args.delegateId, 1, "delegateId");
    assert.equal(tx.logs[0].args.delegate, delegate.address, "delegate");
    assert.deepEqual(tx.logs[0].args.configurations.map((x) => x.toString()), ["1", "2", "3"], "configurations");
  });

  it("should let define oracle", async function () {
    const tx = await core.defineOracle(userRegistry.address);
    assert.ok(tx.receipt.status, "Status");
    assert.equal(tx.logs.length, 1);
    assert.equal(tx.logs[0].event, "OracleDefined", "event");
    assert.equal(tx.logs[0].args.userRegistry, userRegistry.address, "user registry");
    assert.equal(tx.logs[0].args.currency.toString(), CHF_BYTES, "currency");
  });

  describe("With oracle defined", async function () {
    beforeEach(async function () {
      await core.defineOracle(userRegistry.address);
    });

    it("should let define a user registry with the samet currency", async function () {
      userRegistry = await UserRegistryMock.new("Test", CHF_BYTES, accounts, 0);
      const tx = await core.defineOracle(userRegistry.address);
      assert.ok(tx.receipt.status, "Status");
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, "OracleDefined", "event");
      assert.equal(tx.logs[0].args.userRegistry, userRegistry.address, "user registry");
      assert.equal(tx.logs[0].args.currency.toString(), CHF_BYTES, "currency");
    });

    it("should let define a user registry with a different currency", async function () {
      userRegistry = await UserRegistryMock.new("Test", SYMBOL_BYTES, accounts, 0);
      const tx = await core.defineOracle(userRegistry.address);
      assert.ok(tx.receipt.status, "Status");
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, "OracleDefined", "event");
      assert.equal(tx.logs[0].args.userRegistry, userRegistry.address, "user registry");
      assert.equal(tx.logs[0].args.currency.toString(), SYMBOL_BYTES, "currency");
    });

    it("should have oracle", async function () {
      const oracle = await core.oracle();

      assert.equal(oracle[0], userRegistry.address, "user registry");
      assert.equal(oracle[1], CHF_BYTES, "currency");
    });
  });

  it("should define audit configuration", async function () {
    const tx = await core.defineAuditConfiguration(2,
      3, true,
      AUDIT_MODE_TRIGGERS_ONLY, AUDIT_STORAGE_MODE_SHARED,
      [1], [2], ratesProvider.address, CHF_BYTES,
      [true, true, true, true]);

    assert.ok(tx.receipt.status, "Status");
    assert.equal(tx.logs.length, 1);
    assert.equal(tx.logs[0].event, "AuditConfigurationDefined", "event");
    assert.equal(tx.logs[0].args.configurationId, 2, "configurationId");
    assert.equal(tx.logs[0].args.scopeId, 3, "scopeId");
    assert.equal(tx.logs[0].args.scopeCore, true, "scopeCore");
    assert.equal(tx.logs[0].args.mode, AUDIT_MODE_TRIGGERS_ONLY, "mode");
    assert.equal(tx.logs[0].args.storageMode, AUDIT_STORAGE_MODE_SHARED, "storageMode");
    assert.deepEqual(tx.logs[0].args.senderKeys.map((x) => x.toString()), ["1"], "senderKeys");
    assert.deepEqual(tx.logs[0].args.receiverKeys.map((x) => x.toString()), ["2"], "receiverKeys");
    assert.equal(tx.logs[0].args.ratesProvider, ratesProvider.address, "ratesProvider");
    assert.equal(tx.logs[0].args.currency, CHF_BYTES, "currency");
  });

  it("should define audit triggers", async function () {
    const tx = await core.defineAuditTriggers(
      2, [accounts[1], accounts[2], accounts[3]],
      [false, false, true],
      [true, false, false],
      [false, true, false]);

    assert.ok(tx.receipt.status, "Status");
    assert.equal(tx.logs.length, 1);
    assert.equal(tx.logs[0].event, "AuditTriggersDefined", "event");
    assert.equal(tx.logs[0].args.configurationId, 2, "configurationId");
    assert.deepEqual(tx.logs[0].args.triggers, [accounts[1], accounts[2], accounts[3]], "triggers");
    assert.deepEqual(tx.logs[0].args.tokens, [false, false, true], "tokens");
    assert.deepEqual(tx.logs[0].args.senders, [true, false, false], "senders");
    assert.deepEqual(tx.logs[0].args.receivers, [false, true, false], "receivers");
  });

  it("should be self managed for a user", async function () {
    const selfManaged = await core.isSelfManaged(accounts[1]);
    assert.ok(!selfManaged, "User should not be selfManaged");
  });

  it("should let user self managed their wallet", async function () {
    const tx = await core.manageSelf(true, { from: accounts[1] });
    
    assert.ok(tx.receipt.status, "Status");
    assert.equal(tx.logs.length, 1);
    assert.equal(tx.logs[0].event, "SelfManaged", "event");
    assert.equal(tx.logs[0].args.holder, accounts[1], "holder");
    assert.equal(tx.logs[0].args.active, true, "active");

    const selfManaged = await core.isSelfManaged(accounts[1]);
    assert.ok(selfManaged, "User should be selfManaged");
  });

  describe("with a delegate defined", async function () {
    beforeEach(async function () {
      await core.defineAuditConfiguration(2,
        3, true,
        AUDIT_MODE_TRIGGERS_ONLY, AUDIT_STORAGE_MODE_SHARED,
        [1], [2], ratesProvider.address, CHF_BYTES,
        [true, true, true, true]);
      await core.defineAuditTriggers(
        2, [accounts[1], accounts[2], accounts[3]],
        [false, false, true],
        [true, false, false],
        [false, true, false]);
      await core.defineTokenDelegate(1, delegate.address, [2, 4]);
    });

    it("should have an audit configuration", async function () {
      const configuration = await core.auditConfiguration(2);
      assert.equal(configuration.mode, AUDIT_MODE_TRIGGERS_ONLY, "audit mode");
      assert.equal(configuration.storageMode, AUDIT_STORAGE_MODE_SHARED, "audit storage mode");
      assert.equal(configuration.scopeId, 3, "scope id");
      assert.equal(configuration.scopeCore, true, "scope core");
      assert.deepEqual(configuration.senderKeys.map((x) => x.toString()), ["1"], "senderKeys");
      assert.deepEqual(configuration.receiverKeys.map((x) => x.toString()), ["2"], "receiverKeys");
      assert.equal(configuration.ratesProvider, ratesProvider.address, "ratesProvider");
      assert.equal(configuration.currency, CHF_BYTES, "currency");
      assert.equal(configuration.fields[0], true, "createdAt");
      assert.equal(configuration.fields[1], true, "lastTransactionAt");
      assert.equal(configuration.fields[2], true, "cumulatedEmission");
      assert.equal(configuration.fields[3], true, "cumulatedReception");
    });

    it("should have audit triggers", async function () {
      const triggers = await core.auditTriggers(2, [accounts[1], accounts[2], accounts[3]]);
      assert.deepEqual(triggers.tokens, [false, false, true], "tokens");
      assert.deepEqual(triggers.senders, [true, false, false], "senders");
      assert.deepEqual(triggers.receivers, [false, true, false], "receivers");
    });

    it("should let remove audit", async function () {
      const tx = await core.removeAudits(accounts[0], 0);
      assert.ok(tx.receipt.status, "Status");
      assert.equal(tx.logs.length, 1, "logs");
      assert.equal(tx.logs[0].event, "AuditsRemoved", "event");
      assert.equal(tx.logs[0].args.scope, accounts[0], "scope");
      assert.equal(tx.logs[0].args.scopeId, 0, "scoeId");
    });

    it("should have a delegate", async function () {
      const delegate0 = await core.delegates(1);
      assert.equal(delegate0, delegate.address, "delegate 0");
    });

    it("should let remove a delegate", async function () {
      const tx = await core.defineTokenDelegate(1, NULL_ADDRESS, []);
      
      assert.ok(tx.receipt.status, "Status");
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, "TokenDelegateRemoved", "event");
      assert.equal(tx.logs[0].args.delegateId, 1, "delegateId");
    });

    it("should let define a token", async function () {
      token = await TokenProxy.new(core.address);
      const tx = await core.defineToken(
        token.address, 1, NAME, SYMBOL, DECIMALS);
      assert.ok(tx.receipt.status, "Status");
      assert.equal(tx.logs.length, 1, "logs");
      assert.equal(tx.logs[0].event, "TokenDefined", "event");
      assert.equal(tx.logs[0].args.token, token.address, "token");
      assert.equal(tx.logs[0].args.delegateId, 1, "delegateId");
      assert.equal(tx.logs[0].args.name, NAME, "name");
      assert.equal(tx.logs[0].args.symbol, SYMBOL, "symbol");
      assert.equal(tx.logs[0].args.decimals, DECIMALS, "decimals");
    });

    describe("With a token defined", function () {
      let token;

      beforeEach(async function () {
        token = await TokenProxy.new(core.address);
        await core.defineToken(
          token.address, 1, NAME, SYMBOL, DECIMALS);
      });

      it("should let migrate token", async function () {
        const tx = await core.migrateToken(token.address, accounts[0]);
        assert.ok(tx.receipt.status, "Status");
        assert.equal(tx.logs.length, 1);
        assert.equal(tx.logs[0].args.token, token.address, "token");
        assert.equal(tx.logs[0].args.newCore, accounts[0], "newCore");
        assert.equal(tx.logs[0].event, "TokenMigrated", "event");

        const newCoreAddress = await token.core();
        assert.equal(newCoreAddress, accounts[0], "newCoreAddress");
      });

      it("should let remove token", async function () {
        const tx = await core.removeToken(token.address);
        assert.ok(tx.receipt.status, "Status");
        assert.equal(tx.logs.length, 1);
        assert.equal(tx.logs[0].event, "TokenRemoved", "event");
        assert.equal(tx.logs[0].args.token, token.address, "token");
      });

      describe("With the token removed", function () {
        beforeEach(async function () {
          await core.removeToken(token.address);
        });

        it("Should have no delegates", async function () {
          const delegate = await core.proxyDelegateIds(token.address);
          assert.equal(delegate, 0, "no delegates");
        });

        it("should have no name", async function () {
          const name = await token.name();
          assert.equal(name, "", "no names");
        });

        it("should have no symbol", async function () {
          const symbol = await token.symbol();
          assert.equal(symbol, "", "no symbol");
        });

        it("should have no decimals", async function () {
          await assertRevert(token.decimals(), "PR02");
        });

        it("should have no supplies", async function () {
          await assertRevert(token.totalSupply(), "PR02");
        });
      });
    });
  });
});
