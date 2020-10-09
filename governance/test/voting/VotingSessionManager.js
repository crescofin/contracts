'user strict';

/**
 * @author Cyril Lapinte - <cyril.lapinte@openfiz.com>
 */

const assertRevert = require('../helpers/assertRevert');
const assertGasEstimate = require('../helpers/assertGasEstimate');
const TokenProxy = artifacts.require('mock/TokenProxyMock.sol');
const TokenDelegate = artifacts.require('mock/TokenDelegateMock.sol');
const TokenCore = artifacts.require('mock/TokenCoreMock.sol');
const VotingSessionManager = artifacts.require('voting/VotingSessionManagerMock.sol');

const ANY_TARGET = web3.utils.fromAscii('AnyTarget').padEnd(42, '0');
const ANY_METHOD = web3.utils.fromAscii('AnyMethod').padEnd(10, '0');
const ALL_PRIVILEGES = web3.utils.fromAscii('AllPrivileges').padEnd(66, '0');
const NULL_ADDRESS = '0x'.padEnd(42, '0');
const NAME = 'Token';
const SYMBOL = 'TKN';
const DECIMALS = '2';

const DAY_IN_SEC = 24 * 3600;
const Periods = {
  campaign: 5 * DAY_IN_SEC,
  voting: 2 * DAY_IN_SEC,
  grace: 7 * DAY_IN_SEC,
};
const OFFSET_PERIOD = 2 * DAY_IN_SEC;
const DEFAULT_PERIOD_LENGTH =
  Object.values(Periods).reduce((sum, elem) => sum + elem, 0);
const MIN_PERIOD_LENGTH = 300;
const MAX_PERIOD_LENGTH = 3652500 * 24 * 3600;
const TODAY = Math.floor(new Date().getTime() / 1000);
const NEXT_START_AT =
  (Math.floor((TODAY + Periods.campaign) /
    DEFAULT_PERIOD_LENGTH) + 1
  ) * DEFAULT_PERIOD_LENGTH + OFFSET_PERIOD;
const Times = {
  today: TODAY,
  campaign: NEXT_START_AT - Periods.campaign,
  voting: NEXT_START_AT,
  grace: NEXT_START_AT + (Periods.voting),
  closed: NEXT_START_AT + (Periods.voting + Periods.grace),
};

const SessionState = {
  PLANNED: '0',
  CAMPAIGN: '1',
  VOTING: '2',
  GRACE: '3',
  CLOSED: '4',
};

contract('VotingSessionManager', function (accounts) {
  let core, delegate, token, votingSession, signatures;

  const recipients = [accounts[0], accounts[1], accounts[2], accounts[3], accounts[5]];
  const supplies = ['100', '3000000', '2000000', '2000000', '1'];

  const proposalName = 'Would you like to vote ?';
  const proposalHash = web3.utils.sha3('alphabet', { encoding: 'hex' });
  const proposalUrl = 'http://url.url';

  before(async function () {
    delegate = await TokenDelegate.new();
    core = await TokenCore.new('Test', [accounts[0], accounts[4]]);
    await core.defineTokenDelegate(1, delegate.address, [0, 1]);
    await core.manageSelf(true, { from: accounts[5] });
  });

  beforeEach(async function () {
    token = await TokenProxy.new(core.address);
    await core.defineToken(
      token.address, 1, NAME, SYMBOL, DECIMALS);
    await core.mint(token.address, recipients, supplies);
    votingSession = await VotingSessionManager.new(token.address);
   
    await core.defineProxy(votingSession.address, 1);
    await core.defineTokenLock(token.address, [token.address, votingSession.address]);
    await core.assignProxyOperators(votingSession.address, ALL_PRIVILEGES, [votingSession.address]);
    await core.assignProxyOperators(token.address, ALL_PRIVILEGES, [votingSession.address]);

    signatures = votingSession.abi.filter((method) =>
      method.name === 'updateResolutionRequirements' ||
      method.name === 'updateSessionRule').map((method) => method.signature);
  });

  it('should have a token', async function () {
    const foundToken = await votingSession.token();
    assert.equal(foundToken, token.address, 'token');
  });

  it('should have session rule', async function () {
    const sessionRule = await votingSession.sessionRule();
    assert.equal(sessionRule.campaignPeriod.toString(), '432000', 'campaignPeriod');
    assert.equal(sessionRule.votingPeriod.toString(), '172800', 'votingPeriod');
    assert.equal(sessionRule.gracePeriod.toString(), '604800', 'gracePeriod');
    assert.equal(sessionRule.periodOffset.toString(), '172800', 'periodOffset');
    assert.equal(sessionRule.maxProposals.toString(), '10', 'maxProposals');
    assert.equal(sessionRule.maxProposalsOperator.toString(), '25', 'maxProposalsOperator');
    assert.equal(sessionRule.newProposalThreshold.toString(), '1', 'newProposalThreshold');
    assert.equal(sessionRule.executeResolutionThreshold.toString(), '1', 'executeResolutionThreshold');
  });

  it('should have default resolution requirements', async function () {
    const requirement = await votingSession.resolutionRequirement(ANY_TARGET, ANY_METHOD);
    assert.equal(requirement.majority.toString(), '50', 'majority');
    assert.equal(requirement.quorum.toString(), '60', 'quorum');
  });

  it('should have no resolution requirements for address 0x, methods 0x', async function () {
    const requirement = await votingSession.resolutionRequirement(NULL_ADDRESS, '0x00000000');
    assert.equal(requirement.majority.toString(), '0', 'majority');
    assert.equal(requirement.quorum.toString(), '0', 'quorum');
  });

  it('should have no voting sessions', async function () {
    const sessionsCount = await votingSession.sessionsCount();
    assert.equal(sessionsCount.toString(), '0', 'count');
  });

  it('should have no voting delegates defined for accounts[0]', async function () {
    const votingDelegate = await votingSession.delegate(accounts[0]);
    assert.equal(votingDelegate, NULL_ADDRESS);
  });

  it('should have no last vote for accounts[0]', async function () {
    const lastVote = await votingSession.lastVote(accounts[0]);
    assert.equal(lastVote.toString(), '0', 'last vote');
  });

  it('should have no proposal 0', async function () {
    await assertRevert(votingSession.proposal(0, 0), 'VS04');
  });

  it('should have a next voting session at different times', async function () {
    const statuses = await Promise.all(Object.keys(Times).map((key, i) =>
      votingSession.nextSessionAt(Times[key]).then((status_) => status_.toString())));
    assert.deepEqual(statuses, [
      '' + NEXT_START_AT,
      '' + (NEXT_START_AT + DEFAULT_PERIOD_LENGTH),
      '' + (NEXT_START_AT + DEFAULT_PERIOD_LENGTH),
      '' + (NEXT_START_AT + DEFAULT_PERIOD_LENGTH),
      '' + (NEXT_START_AT + 2 * DEFAULT_PERIOD_LENGTH),
    ], 'next sessions');
  });

  it('should not have no session state for session 0', async function () {
    await assertRevert(votingSession.sessionStateAt(0, 0), 'VS05');
  });

  it('should let accounts[1] choose accounts[0] for voting delegate', async function () {
    const tx = await votingSession.defineDelegate(accounts[0], { from: accounts[1] });
    assert.ok(tx.receipt.status, 'Status');
    assert.equal(tx.logs.length, 1);
    assert.equal(tx.logs[0].event, 'DelegateDefined', 'event');
    assert.equal(tx.logs[0].args.voter, accounts[1], 'voter');
    assert.equal(tx.logs[0].args.delegate, accounts[0], 'delegate');
  });

  it('should prevent anyone to add a new proposal', async function () {
    await assertRevert(votingSession.defineProposal(
      proposalName,
      proposalUrl,
      proposalHash,
      ANY_TARGET,
      '0x', { from: accounts[9] }), 'VSM20');
  });

  it('should let investor add a new proposal', async function () {
    const tx = await votingSession.defineProposal(
      proposalName,
      proposalUrl,
      proposalHash,
      ANY_TARGET,
      '0x', { from: accounts[1] });
    assert.ok(tx.receipt.status, 'Status');
    assert.equal(tx.logs.length, 2);
    assert.equal(tx.logs[0].event, 'SessionScheduled', 'event');
    assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'session id');
    assert.equal(tx.logs[0].args.voteAt.toString(), NEXT_START_AT, 'voteAt');
    assert.equal(tx.logs[1].event, 'ProposalDefined', 'event');
    assert.equal(tx.logs[1].args.sessionId.toString(), '1', 'session id');
    assert.equal(tx.logs[1].args.proposalId.toString(), '1', 'proposalId');
  });

  it('should let token operator add a new proposal', async function () {
    const tx = await votingSession.defineProposal(
      proposalName,
      proposalUrl,
      proposalHash,
      ANY_TARGET,
      '0x', { from: accounts[4] });
    assert.ok(tx.receipt.status, 'Status');
    assert.equal(tx.logs.length, 2);
    assert.equal(tx.logs[0].event, 'SessionScheduled', 'event');
    assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'session id');
    assert.equal(tx.logs[0].args.voteAt.toString(), NEXT_START_AT, 'voteAt');
    assert.equal(tx.logs[1].event, 'ProposalDefined', 'event');
    assert.equal(tx.logs[1].args.sessionId.toString(), '1', 'session id');
    assert.equal(tx.logs[1].args.proposalId.toString(), '1', 'proposalId');
  });

  it('should prevent anyone to update session rules', async function () {
    await assertRevert(votingSession.updateSessionRule(
      MIN_PERIOD_LENGTH, MIN_PERIOD_LENGTH, MIN_PERIOD_LENGTH, '0', '1', '2', '3000000', '3000001', { from: accounts[9] }), 'OA02');
  });

  it('should prevent token operator to update session rules above campaign period length limit', async function () {
    await assertRevert(votingSession.updateSessionRule(
      MAX_PERIOD_LENGTH + 1, MIN_PERIOD_LENGTH, MIN_PERIOD_LENGTH, '0', '1', '2', '3000000', '3000001'), 'VSM06');
  });

  it('should prevent token operator to update session rules above voting period length limit', async function () {
    await assertRevert(votingSession.updateSessionRule(
      MIN_PERIOD_LENGTH, MAX_PERIOD_LENGTH + 1, MIN_PERIOD_LENGTH, '0', '1', '2', '3000000', '3000001'), 'VSM07');
  });

  it('should prevent token operator to update session rules above grace period length limit', async function () {
    await assertRevert(votingSession.updateSessionRule(
      MIN_PERIOD_LENGTH, MIN_PERIOD_LENGTH, MAX_PERIOD_LENGTH + 1, '0', '1', '2', '3000000', '3000001'), 'VSM08');
  });

  it('should let token operator to update session rules', async function () {
    const tx = await votingSession.updateSessionRule(
      MAX_PERIOD_LENGTH, MAX_PERIOD_LENGTH, MAX_PERIOD_LENGTH, MAX_PERIOD_LENGTH, '1', '2', '3000000', '3000001');
    assert.ok(tx.receipt.status, 'Status');
    assert.equal(tx.logs.length, 1);
    assert.equal(tx.logs[0].event, 'SessionRuleUpdated', 'event');
    assert.equal(tx.logs[0].args.campaignPeriod.toString(), MAX_PERIOD_LENGTH, 'campaign period');
    assert.equal(tx.logs[0].args.votingPeriod.toString(), MAX_PERIOD_LENGTH, 'voting period');
    assert.equal(tx.logs[0].args.gracePeriod.toString(), MAX_PERIOD_LENGTH, 'grace period');
    assert.equal(tx.logs[0].args.periodOffset.toString(), MAX_PERIOD_LENGTH, 'period offset');
    assert.equal(tx.logs[0].args.maxProposals.toString(), '1', 'max proposals');
    assert.equal(tx.logs[0].args.maxProposalsOperator.toString(), '2', 'max proposals quaestor');
    assert.equal(tx.logs[0].args.newProposalThreshold.toString(), '3000000', 'new proposal threshold');
    assert.equal(tx.logs[0].args.executeResolutionThreshold.toString(), '3000001', 'execute resolution threshold');
  });

  it('should prevent anyone to update resolution requirements', async function () {
    await assertRevert(votingSession.updateResolutionRequirements(
      [ANY_TARGET, votingSession.address],
      signatures, ['10', '15'], ['10', '15'],
      { from: accounts[9] }), 'OA02');
  });

  it('should prevent operator to update resolution requirements global resolution requirement', async function () {
    await assertRevert(votingSession.updateResolutionRequirements(
      [ANY_TARGET, ANY_TARGET, votingSession.address],
      ['0x00000000', ANY_METHOD, '0x12345678'],
      ['10', '0', '15'], ['10', '0', '15']), 'VSM18');
  });

  it('should let token operator to update resolution requirements', async function () {
    const tx = await votingSession.updateResolutionRequirements(
      [ANY_TARGET, votingSession.address], signatures, ['10', '15'], ['10', '15']);
    assert.ok(tx.receipt.status, 'Status');
    assert.equal(tx.logs.length, 2);
    assert.equal(tx.logs[0].event, 'ResolutionRequirementUpdated', 'event');
    assert.equal(tx.logs[0].args.target.toString().toLowerCase(), ANY_TARGET, 'undefined target');
    assert.equal(tx.logs[0].args.methodSignature.toString(), signatures[0], 'method signature');
    assert.equal(tx.logs[0].args.majority.toString(), '10', 'majority');
    assert.equal(tx.logs[0].args.quorum.toString(), '10', 'quorum');
    assert.equal(tx.logs[1].event, 'ResolutionRequirementUpdated', 'event');
    assert.equal(tx.logs[1].args.target.toString(), votingSession.address, 'core address');
    assert.equal(tx.logs[1].args.methodSignature.toString(), signatures[1], 'method signature');
    assert.equal(tx.logs[1].args.majority.toString(), '15', 'majority');
    assert.equal(tx.logs[1].args.quorum.toString(), '15', 'quorum');
  });

  describe('with a new proposal', function () {
    beforeEach(async function () {
      await votingSession.defineProposal(
        proposalName,
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x');
    });

    it('should have a session count', async function () {
      const sessionsCount = await votingSession.sessionsCount();
      assert.equal(sessionsCount.toString(), '1', 'count');
    });

    it('should have a session', async function () {
      const session = await votingSession.session(1);
      assert.equal(session.campaignAt.toString(), Times.campaign, 'campaignAt');
      assert.equal(session.voteAt.toString(), Times.voting, 'voteAt');
      assert.equal(session.graceAt.toString(), Times.grace, 'graceAt');
      assert.equal(session.closedAt.toString(), Times.closed, 'closedAt');
      assert.equal(session.proposalsCount, 1, 'proposalsCount');
      assert.equal(session.participation, 0, 'participation');
    });

    it('should have a proposal', async function () {
      const proposal = await votingSession.proposal(1, 1);
      assert.equal(proposal.name, proposalName, 'name');
      assert.equal(proposal.url, proposalUrl, 'url');
      assert.equal(proposal.proposalHash, proposalHash, 'hash');
      assert.equal(proposal.resolutionAction, null, 'action');
      assert.equal(proposal.resolutionTarget.toLowerCase(), ANY_TARGET, 'target');
    });

    it('should have a proposal data', async function () {
      const proposal = await votingSession.proposalData(1, 1);
      assert.equal(proposal.proposedBy, accounts[0], 'proposedBy');
      assert.equal(proposal.weight.toString(), '100', 'weight');
      assert.equal(proposal.approvals.toString(), '0', 'approvals');
      assert.ok(!proposal.resolutionExecuted, 'executed');
      assert.ok(!proposal.cancelled, 'cancelled');
    });

    it('should have session all status for the different dates', async function () {
      const statuses = await Promise.all(Object.keys(Times).map((key, i) =>
        votingSession.sessionStateAt(1, Times[key]).then((status_) => status_.toString())));
      assert.deepEqual(statuses, [
        SessionState.PLANNED,
        SessionState.CAMPAIGN,
        SessionState.VOTING,
        SessionState.GRACE,
        SessionState.CLOSED,
      ], 'statuses');
    });

    it('should let its author to update the proposal', async function () {
      const tx = await votingSession.updateProposal(1,
        proposalName + '2',
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x');
      assert.ok(tx.receipt.status, 'Status');
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, 'ProposalUpdated', 'event');
      assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'proposal id');
      assert.equal(tx.logs[0].args.proposalId.toString(), '1', 'proposal id');
    });

    it('should prevent non author to update the proposal', async function () {
      await assertRevert(votingSession.updateProposal(1,
        proposalName + '2',
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x', { from: accounts[1] }), 'VSM23');
    });

    it('should prevent author to update a non existing proposal', async function () {
      await assertRevert(votingSession.updateProposal(2,
        proposalName + '2',
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x'), 'VSM02');
    });

    it('should let its author cancel the proposal', async function () {
      const tx = await votingSession.cancelProposal(1);
      assert.ok(tx.receipt.status, 'Status');
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, 'ProposalCancelled', 'event');
      assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'proposal id');
      assert.equal(tx.logs[0].args.proposalId.toString(), '1', 'proposal id');
    });

    it('should prevent non author to cancel the proposal', async function () {
      await assertRevert(votingSession.cancelProposal(1, { from: accounts[1] }), 'VSM23');
    });

    it('should prevent author to cancel a non existing proposal', async function () {
      await assertRevert(votingSession.cancelProposal(2), 'VSM02');
    });

    describe('during campaign', function () {
      beforeEach(async function () {
        await votingSession.nextSessionStepTest();
      });

      it('should not be possible to add more proposal', async function () {
        await assertRevert(votingSession.defineProposal(
          proposalName,
          proposalUrl,
          proposalHash,
          ANY_TARGET,
          '0x'), 'VSM26');
      });
    });

    describe('during voting', function () {
      beforeEach(async function () {
        await votingSession.nextSessionStepTest();
        await votingSession.nextSessionStepTest();
      });

      it('should have the token locked', async function () {
        const tokenData = await core.lock(votingSession.address);
        assert.equal(tokenData.startAt.toString(), Times.voting, 'lock start');
        assert.equal(tokenData.endAt.toString(), Times.grace, 'lock end');
        assert.deepEqual(tokenData.exceptions, [], 'exceptions');
      });

      it('should be possible to submit a vote', async function () {
        const tx = await votingSession.submitVote(1);
        assert.ok(tx.receipt.status, 'Status');
        assert.equal(tx.logs.length, 1);
        assert.equal(tx.logs[0].event, 'Vote', 'event');
        assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'session id');
        assert.equal(tx.logs[0].args.voter, accounts[0], 'voter');
        assert.equal(tx.logs[0].args.weight, '100', 'weight');
      });

      it('should be possible as the quaestor to submit a vote on behalf', async function () {
        const tx = await votingSession.submitVoteOnBehalf([accounts[0], accounts[1]], 1);
        assert.ok(tx.receipt.status, 'Status');
        assert.equal(tx.logs.length, 2);
        assert.equal(tx.logs[0].event, 'Vote', 'event');
        assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'session id');
        assert.equal(tx.logs[0].args.voter, accounts[0], 'voter');
        assert.equal(tx.logs[0].args.weight, '100', 'weight');
        assert.equal(tx.logs[1].event, 'Vote', 'event');
        assert.equal(tx.logs[1].args.sessionId.toString(), '1', 'session id');
        assert.equal(tx.logs[1].args.voter, accounts[1], 'voter');
        assert.equal(tx.logs[1].args.weight, '3000000', 'weight');
      });

      it('should prevent operator to submit a vote on behalf for self managed voter', async function () {
        await assertRevert(votingSession.submitVoteOnBehalf([accounts[0], accounts[5]], 1), 'VSM30');
      });

      describe('With delegation from account 3 to 2', function () {
        beforeEach(async function () {
          await votingSession.defineDelegate(accounts[2], { from: accounts[3] });
          await votingSession.defineDelegate(accounts[2], { from: accounts[5] });
        });

        it('should have no voting delegates defined for account 3', async function () {
          const votingDelegate = await votingSession.delegate(accounts[3]);
          assert.equal(votingDelegate, accounts[2], 'delegate');
        });

        it('should be possible as account 2 to vote for self and account 3', async function () {
          const tx = await votingSession.submitVoteOnBehalf(
            [accounts[2], accounts[3], accounts[5]], 1, { from: accounts[2] });
          assert.ok(tx.receipt.status, 'Status');
          assert.equal(tx.logs.length, 3);
          assert.equal(tx.logs[0].event, 'Vote', 'event');
          assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'session id');
          assert.equal(tx.logs[0].args.voter, accounts[2], 'voter');
          assert.equal(tx.logs[0].args.weight, '2000000', 'weight');
          assert.equal(tx.logs[1].event, 'Vote', 'event');
          assert.equal(tx.logs[1].args.sessionId.toString(), '1', 'session id');
          assert.equal(tx.logs[1].args.voter, accounts[3], 'voter');
          assert.equal(tx.logs[1].args.weight, '2000000', 'weight');
          assert.equal(tx.logs[2].event, 'Vote', 'event');
          assert.equal(tx.logs[2].args.sessionId.toString(), '1', 'session id');
          assert.equal(tx.logs[2].args.voter, accounts[5], 'voter');
          assert.equal(tx.logs[2].args.weight, '1', 'weight');
        });
      });

      it('should prevent operator to submit a vote on behalf with incorrect proposalIds', async function () {
        await assertRevert(votingSession.submitVoteOnBehalf([accounts[0], accounts[1]], 2), 'VSM32');
      });

      it('should prevent operator to submit vote without voters', async function () {
        await assertRevert(votingSession.submitVoteOnBehalf([], 1), 'VSM29');
      });

      it('should prevent author to update a proposal', async function () {
        await assertRevert(votingSession.updateProposal(1,
          proposalName + '2',
          proposalUrl,
          proposalHash,
          ANY_TARGET,
          '0x'), 'VSM22');
      });

      it('should prevent author to cancel a proposal', async function () {
        await assertRevert(votingSession.cancelProposal(1), 'VSM22');
      });

      describe('after submitted a vote', function () {
        beforeEach(async function () {
          await votingSession.submitVote(1);
        });

        it('should not be possible to vote twice', async function () {
          await assertRevert(votingSession.submitVote(1), 'VSM31');
        });
      });

      describe('after submitted a vote on behalf', function () {
        beforeEach(async function () {
          await votingSession.submitVoteOnBehalf([accounts[0]], 1);
        });

        it('should not be possible to vote twice', async function () {
          await assertRevert(votingSession.submitVote(1), 'VSM31');
        });
      });
    });
  });

  describe('with an approved proposal to change the session rules', function () {
    beforeEach(async function () {
      const request = votingSession.contract.methods.updateSessionRule(
        MIN_PERIOD_LENGTH+1, MIN_PERIOD_LENGTH+2, MIN_PERIOD_LENGTH+3, '0', '1', '2', '3000000', '3000001').encodeABI();
      await votingSession.defineProposal(
        'Changing the rules',
        proposalUrl,
        proposalHash,
        votingSession.address,
        request);
      await votingSession.nextSessionStepTest();
      await votingSession.nextSessionStepTest();
      await votingSession.submitVote(1, { from: accounts[1] });
      await votingSession.submitVote(1, { from: accounts[2] });
      await votingSession.nextSessionStepTest();
    });

    it('should prevent anyone to execute the resolution', async function () {
      await assertRevert(votingSession.executeResolutions([1], { from: accounts[9] }), 'VSM24');
    });

    it('should be possible to execute the resolution', async function () {
      const tx = await votingSession.executeResolutions([1]);
      assert.ok(tx.receipt.status, 'Status');
      assert.equal(tx.logs.length, 2);
      assert.equal(tx.logs[0].event, 'SessionRuleUpdated', 'event');
      assert.equal(tx.logs[0].args.campaignPeriod.toString(), MIN_PERIOD_LENGTH+1, 'campaign period');
      assert.equal(tx.logs[0].args.votingPeriod.toString(), MIN_PERIOD_LENGTH+2, 'voting period');
      assert.equal(tx.logs[0].args.gracePeriod.toString(), MIN_PERIOD_LENGTH+3, 'grace period');
      assert.equal(tx.logs[0].args.periodOffset.toString(), '0', 'period offset');
      assert.equal(tx.logs[0].args.maxProposals.toString(), '1', 'max proposals');
      assert.equal(tx.logs[0].args.maxProposalsOperator.toString(), '2', 'max proposals quaestor');
      assert.equal(tx.logs[0].args.newProposalThreshold.toString(), '3000000', 'new proposal threshold');
      assert.equal(tx.logs[0].args.executeResolutionThreshold.toString(), '3000001', 'execute resolution threshold');
      assert.equal(tx.logs[1].event, 'ResolutionExecuted', 'event');
      assert.equal(tx.logs[1].args.sessionId.toString(), '1', 'session id');
      assert.equal(tx.logs[1].args.proposalId.toString(), '1', 'proposal id');

      const sessionRule = await votingSession.sessionRule();
      assert.equal(sessionRule.campaignPeriod.toString(), MIN_PERIOD_LENGTH+1, 'campaignPeriod');
      assert.equal(sessionRule.votingPeriod.toString(), MIN_PERIOD_LENGTH+2, 'votingPeriod');
      assert.equal(sessionRule.gracePeriod.toString(), MIN_PERIOD_LENGTH+3, 'gracePeriod');
      assert.equal(sessionRule.periodOffset.toString(), '0', 'period offset');
      assert.equal(sessionRule.maxProposals.toString(), '1', 'maxProposals');
      assert.equal(sessionRule.maxProposalsOperator.toString(), '2', 'maxProposalsOperator');
      assert.equal(sessionRule.newProposalThreshold.toString(), '3000000', 'newProposalThreshold');
      assert.equal(sessionRule.executeResolutionThreshold.toString(), '3000001', 'executeResolutionThreshold');
    });
  });

  describe('with an approved proposal to change the resolution requirements', function () {
    let request;

    beforeEach(async function () {
      request = votingSession.contract.methods.updateResolutionRequirements(
        [ANY_TARGET, votingSession.address],
        signatures, ['10', '15'], ['10', '15']).encodeABI();
      await votingSession.defineProposal(
        'Changing the requirements',
        proposalUrl,
        proposalHash,
        votingSession.address,
        request);
      await votingSession.nextSessionStepTest();
      await votingSession.nextSessionStepTest();
      await votingSession.submitVote(1, { from: accounts[1] });
      await votingSession.submitVote(1, { from: accounts[2] });
      await votingSession.nextSessionStepTest();
    });

    it('should be possible to execute the resolution', async function () {
      const tx = await votingSession.executeResolutions([1]);
      assert.ok(tx.receipt.status, 'Status');
      assert.equal(tx.logs.length, 3);
      assert.equal(tx.logs[0].event, 'ResolutionRequirementUpdated', 'event');
      assert.equal(tx.logs[0].args.methodSignature.toString(), signatures[0], 'method signature');
      assert.equal(tx.logs[0].args.majority.toString(), '10', 'majority');
      assert.equal(tx.logs[0].args.quorum.toString(), '10', 'quorum');
      assert.equal(tx.logs[1].event, 'ResolutionRequirementUpdated', 'event');
      assert.equal(tx.logs[1].args.methodSignature.toString(), signatures[1], 'method signature');
      assert.equal(tx.logs[1].args.majority.toString(), '15', 'majority');
      assert.equal(tx.logs[1].args.quorum.toString(), '15', 'quorum');
      assert.equal(tx.logs[2].event, 'ResolutionExecuted', 'event');
      assert.equal(tx.logs[2].args.sessionId.toString(), '1', 'session id');
      assert.equal(tx.logs[2].args.proposalId.toString(), '1', 'proposal id');

      const requirement1 = await votingSession.resolutionRequirement(ANY_TARGET, signatures[0]);
      assert.equal(requirement1.majority.toString(), '10', 'majority');
      assert.equal(requirement1.quorum.toString(), '10', 'quorum');

      const requirement2 = await votingSession.resolutionRequirement(votingSession.address, signatures[1]);
      assert.equal(requirement2.majority.toString(), '15', 'majority');
      assert.equal(requirement2.quorum.toString(), '15', 'quorum');
    });
  });

  describe('after first session', function () {
    beforeEach(async function () {
      await votingSession.defineProposal(
        proposalName,
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x');
      await votingSession.nextSessionStepTest();
      await votingSession.nextSessionStepTest();
      await votingSession.nextSessionStepTest();
    });

    describe('during the grace period', function () {
      it('should be possible to start a second voting session', async function () {
        const tx = await votingSession.defineProposal(
          proposalName,
          proposalUrl,
          proposalHash,
          ANY_TARGET,
          '0x');

        assert.ok(tx.receipt.status, 'Status');
        assert.equal(tx.logs.length, 2);
        assert.equal(tx.logs[0].event, 'SessionScheduled', 'event');
        assert.equal(tx.logs[0].args.sessionId.toString(), '2', 'session id');
        assert.equal(tx.logs[0].args.voteAt.toString(),
          NEXT_START_AT + DEFAULT_PERIOD_LENGTH, 'voteAt');
        assert.equal(tx.logs[1].event, 'ProposalDefined', 'event');
        assert.equal(tx.logs[1].args.sessionId.toString(), '2', 'session id');
        assert.equal(tx.logs[1].args.proposalId.toString(), '1', 'proposalId');
      });
    });

    describe('once the session is closed', function () {
      beforeEach(async function () {
        await votingSession.nextSessionStepTest();
      });

      it('should be possible to start a second voting session', async function () {
        const tx = await votingSession.defineProposal(
          proposalName,
          proposalUrl,
          proposalHash,
          ANY_TARGET,
          '0x');

        assert.ok(tx.receipt.status, 'Status');
        assert.equal(tx.logs.length, 2);
        assert.equal(tx.logs[0].event, 'SessionScheduled', 'event');
        assert.equal(tx.logs[0].args.sessionId.toString(), '2', 'session id');
        assert.equal(tx.logs[0].args.voteAt.toString(),
          NEXT_START_AT, 'voteAt');
        assert.equal(tx.logs[1].event, 'ProposalDefined', 'event');
        assert.equal(tx.logs[1].args.sessionId.toString(), '2', 'session id');
        assert.equal(tx.logs[1].args.proposalId.toString(), '1', 'proposalId');
      });
    });
  });

  describe('with 3 proposals: blank, mint and burn', function () {
    let request1, request2;

    const MINT_MORE_TOKENS = 'Mint more tokens!';

    beforeEach(async function () {
      await votingSession.defineProposal(
        proposalName,
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x');

      request1 = core.contract.methods.mint(token.address, [accounts[4]], ['13999900']).encodeABI();
      await votingSession.defineProposal(
        MINT_MORE_TOKENS,
        proposalUrl,
        proposalHash,
        core.address,
        request1);

      request2 = core.contract.methods.seize(token.address, accounts[1], '1000000').encodeABI();
      await votingSession.defineProposal(
        'seize dat guy',
        proposalUrl,
        proposalHash,
        core.address,
        request2);
    });

    describe('during voting', function () {
      beforeEach(async function () {
        await votingSession.nextSessionStepTest();
        await votingSession.nextSessionStepTest();
      });

      it('should be possible to vote', async function () {
        await votingSession.submitVote(4);
      });

      it('should be possible to vote on behalf', async function () {
        await votingSession.submitVoteOnBehalf([accounts[1], accounts[2]], 3);
      });

      it('should have the token locked', async function () {
        const lockData = await core.lock(votingSession.address);
        assert.equal(lockData.startAt.toString(), Times.voting, 'lock start');
        assert.equal(lockData.endAt.toString(), Times.grace, 'lock end');
        assert.deepEqual(lockData.exceptions, [], 'exceptions');
      });
    });

    describe('without enough votes for the quorum', function () {
      beforeEach(async function () {
        await votingSession.nextSessionStepTest();
        await votingSession.nextSessionStepTest();
        await votingSession.submitVote(7);
        await votingSession.submitVote(3, { from: accounts[3] });
        await votingSession.nextSessionStepTest();
      });

      it('should have a session', async function () {
        const session = await votingSession.session(1);
        assert.equal(session.proposalsCount.toString(), '3', 'proposalsCount');
        assert.equal(session.participation.toString(), '2000100', 'participation');
      });

      it('should have approvals for blank proposal', async function () {
        const proposal = await votingSession.proposalData(1, 1);
        assert.equal(proposal.approvals.toString(), '2000100', 'approvals');
      });

      it('should have approvals for mint proposal', async function () {
        const proposal = await votingSession.proposalData(1, 2);
        assert.equal(proposal.approvals.toString(), '2000100', 'approvals');
      });

      it('should have approvals for seize proposal', async function () {
        const proposal = await votingSession.proposalData(1, 3);
        assert.equal(proposal.approvals.toString(), '100', 'approvals');
      });

      it('should have blank proposal rejected', async function () {
        const approved = await votingSession.isApproved(1, 1);
        assert.ok(!approved, 'rejected');
      });

      it('should have mint proposal rejected', async function () {
        const approved = await votingSession.isApproved(1, 2);
        assert.ok(!approved, 'rejected');
      });

      it('should have seize proposal rejected', async function () {
        const approved = await votingSession.isApproved(1, 3);
        assert.ok(!approved, 'rejected');
      });
    });

    describe('after sucessfull votes, during grace period', function () {
      beforeEach(async function () {
        await votingSession.nextSessionStepTest();
        await votingSession.nextSessionStepTest();
        await votingSession.submitVoteOnBehalf(
          [accounts[0], accounts[1], accounts[2], accounts[3]], 3);
        await votingSession.nextSessionStepTest();
      });

      it('should have a session', async function () {
        const session = await votingSession.session(1);
        assert.equal(session.proposalsCount.toString(), '3', 'proposalsCount');
        assert.equal(session.participation.toString(), '7000100', 'participation');
      });

      it('should have approvals for blank proposal', async function () {
        const proposal = await votingSession.proposalData(1, 1);
        assert.equal(proposal.approvals.toString(), '7000100', 'approvals');
      });

      it('should have approvals for mint proposal', async function () {
        const proposal = await votingSession.proposalData(1, 2);
        assert.equal(proposal.approvals.toString(), '7000100', 'approvals');
      });

      it('should have approvals for seize proposal', async function () {
        const proposal = await votingSession.proposalData(1, 3);
        assert.equal(proposal.approvals.toString(), '0', 'approvals');
      });

      it('should have blank proposal approved', async function () {
        const approved = await votingSession.isApproved(1, 1);
        assert.ok(approved, 'approved');
      });

      it('should have mint proposal approved', async function () {
        const approved = await votingSession.isApproved(1, 2);
        assert.ok(approved, 'approved');
      });

      it('should have seize proposal rejected', async function () {
        const approved = await votingSession.isApproved(1, 3);
        assert.ok(!approved, 'rejected');
      });

      it('should be possible to execute blank proposal', async function () {
        const tx = await votingSession.executeResolutions([1]);
        assert.ok(tx.receipt.status, 'Status');
        assert.equal(tx.logs.length, 1);
        assert.equal(tx.logs[0].event, 'ResolutionExecuted', 'event');
        assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'session id');
        assert.equal(tx.logs[0].args.proposalId.toString(), '1', 'proposal id');
      });

      it('should be possible to execute mint proposal', async function () {
        const tx = await votingSession.executeResolutions([2]);
        assert.ok(tx.receipt.status, 'Status');
        assert.equal(tx.logs.length, 1);
        assert.equal(tx.logs[0].event, 'ResolutionExecuted', 'event');
        assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'session id');
        assert.equal(tx.logs[0].args.proposalId.toString(), '2', 'proposal id');

        const totalSupply = await token.totalSupply();
        assert.equal(totalSupply.toString(), '21000001', 'totalSupply');
        const balance4 = await token.balanceOf(accounts[4]);
        assert.equal(balance4.toString(), '13999900', 'balance4');
      });

      it('should execute many resolution', async function () {
        const tx = await votingSession.executeResolutions([1, 2]);
        assert.ok(tx.receipt.status, 'Status');
        assert.equal(tx.logs.length, 2);
        assert.equal(tx.logs[0].event, 'ResolutionExecuted', 'event');
        assert.equal(tx.logs[1].args.sessionId.toString(), '1', 'session id');
        assert.equal(tx.logs[0].args.proposalId.toString(), '1', 'proposal id');
        assert.equal(tx.logs[1].event, 'ResolutionExecuted', 'event');
        assert.equal(tx.logs[1].args.sessionId.toString(), '1', 'session id');
        assert.equal(tx.logs[1].args.proposalId.toString(), '2', 'proposal id');
      });

      it('should not be possible to execute seize proposal', async function () {
        await assertRevert(votingSession.executeResolutions([3]), 'VSM34');
      });

      it('should be possible to add a proposal', async function () {
        const tx = await votingSession.defineProposal(
          proposalName,
          proposalUrl,
          proposalHash,
          ANY_TARGET,
          '0x');
        assert.ok(tx.receipt.status, 'Status');
        assert.equal(tx.logs.length, 2);
        assert.equal(tx.logs[0].event, 'SessionScheduled', 'event');
        assert.equal(tx.logs[0].args.sessionId.toString(), '2', 'session id');
        assert.equal(tx.logs[1].event, 'ProposalDefined', 'event');
        assert.equal(tx.logs[1].args.sessionId.toString(), '2', 'session id');
        assert.equal(tx.logs[1].args.proposalId.toString(), '1', 'proposalId');
      });

      describe('with the next session planned', function () {
        beforeEach(async function () {
          await votingSession.defineProposal(
            proposalName,
            proposalUrl,
            proposalHash,
            ANY_TARGET,
            '0x');
        });

        it('should be possible to execute approved resolutions', async function () {
          const tx = await votingSession.executeResolutions([1, 2]);
          assert.ok(tx.receipt.status, 'Status');
          assert.equal(tx.logs.length, 2);
          assert.equal(tx.logs[0].event, 'ResolutionExecuted', 'event');
          assert.equal(tx.logs[0].args.sessionId.toString(), '1', 'session id');
          assert.equal(tx.logs[0].args.proposalId.toString(), '1', 'proposal id');
          assert.equal(tx.logs[1].event, 'ResolutionExecuted', 'event');
          assert.equal(tx.logs[1].args.sessionId.toString(), '1', 'session id');
          assert.equal(tx.logs[1].args.proposalId.toString(), '2', 'proposal id');
        });

        describe('with the next session started', function () {
          beforeEach(async function () {
            await votingSession.nextStepTest(1);
          });

          it('should not be possible to execute approved resolution', async function () {
            await assertRevert(votingSession.executeResolutions([1]), 'VSM25');
          });
        });
      });

      describe('after minting', function () {
        beforeEach(async function () {
          await votingSession.executeResolutions([2]);
        });

        it('should have proposal executed', async function () {
          const proposal = await votingSession.proposalData(1, 2);
          assert.equal(proposal.proposedBy, accounts[0], 'proposedBy');
          assert.equal(proposal.weight.toString(), '100', 'weight');
          assert.equal(proposal.approvals.toString(), '7000100', 'approvals');
          assert.ok(proposal.resolutionExecuted, 'executed');
          assert.ok(!proposal.cancelled, 'cancelled');
        });

        it('should not be possible to mint twice', async function () {
          await assertRevert(votingSession.executeResolutions([2]), 'VSM33');
        });
      });
    });

    describe('after sucessfull votes, and after grace period', function () {
      beforeEach(async function () {
        await votingSession.nextSessionStepTest();
        await votingSession.nextSessionStepTest();
        await votingSession.submitVoteOnBehalf(
          [accounts[0], accounts[1], accounts[2], accounts[3]], 1);
        await votingSession.nextSessionStepTest();
        await votingSession.nextSessionStepTest();
      });

      it('should not be possible to execute mint proposal anymore', async function () {
        await assertRevert(votingSession.executeResolutions([1]), 'VSM22');
      });
    });
  });

  const DEFINE_FIRST_PROPOSAL_COST = 302377;
  const DEFINE_SECOND_PROPOSAL_COST = 183306;
  const FIRST_VOTE_COST = 319482;
  const SECOND_VOTE_COST = 155437;
  const VOTE_FOR_TWO_PROPOSALS_COST = 138210;
  const VOTE_ON_BEHALF_COST = 182841;
  const EXECUTE_ONE_COST = 84639;
  const EXECUTE_ALL_COST = 532744;

  describe('Performance [ @skip-on-coverage ]', function () {
    it('shoould estimate a first proposal', async function () {
      const gas = await votingSession.defineProposal.estimateGas(
        proposalName,
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x');
      await assertGasEstimate(gas, DEFINE_FIRST_PROPOSAL_COST, 'estimate');
    });

    it('shoould estimate a second proposal', async function () {
      await votingSession.defineProposal(
        proposalName,
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x');
      const gas = await votingSession.defineProposal.estimateGas(
        proposalName,
        proposalUrl,
        proposalHash,
        ANY_TARGET,
        '0x');
      await assertGasEstimate(gas, DEFINE_SECOND_PROPOSAL_COST, 'estimate');
    });

    describe('during voting', function () {
      let votes;

      beforeEach(async function () {
        votes = 0;
        for (let i = 0; i < 10; i++) {
          await votingSession.defineProposal(
            proposalName,
            proposalUrl,
            proposalHash,
            ANY_TARGET,
            '0x');
          votes += 2**i;
        }

        await votingSession.nextSessionStepTest();
        await votingSession.nextSessionStepTest();
      });

      it('should estimate first vote', async function () {
        const gas = await votingSession.submitVote.estimateGas(votes);
        await assertGasEstimate(gas, FIRST_VOTE_COST, 'estimate');
      });

      it('should estimate a second vote', async function () {
        await votingSession.submitVote(votes);
        const gas = await votingSession.submitVote.estimateGas(votes, { from: accounts[1] });
        await assertGasEstimate(gas, SECOND_VOTE_COST, 'estimate');
      });

      it('should estimate a vote on behalf', async function () {
        const gas = await votingSession.submitVoteOnBehalf.estimateGas(
          [accounts[1], accounts[2]], 3);
        await assertGasEstimate(gas, VOTE_ON_BEHALF_COST, 'estimate');
      });
    });

    describe('during grace period', function () {
      let votes, proposals;

      beforeEach(async function () {
        votes = 0;
        proposals = [];
        for (let i = 1; i <= 10; i++) {
          await votingSession.defineProposal(
            proposalName,
            proposalUrl,
            proposalHash,
            ANY_TARGET,
            '0x');
          votes += 2**(i-1);
          proposals.push(i);
        }

        await votingSession.nextSessionStepTest();
        await votingSession.nextSessionStepTest();
        await votingSession.submitVote(votes, { from: accounts[1] });
        await votingSession.submitVote(votes, { from: accounts[2] });

        await votingSession.nextSessionStepTest();
      });

      it('should estimate resolution of one proposal', async function () {
        const gas = await votingSession.executeResolutions.estimateGas([1]);
        await assertGasEstimate(gas, EXECUTE_ONE_COST, 'estimate');
      });

      it('should estimate resolution of all proposal', async function () {
        const gas = await votingSession.executeResolutions.estimateGas(proposals);
        await assertGasEstimate(gas, EXECUTE_ALL_COST, 'estimate');
      });
    });
  });
});