// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/*
   fomo market — on-chain settlement for markets written on a trader's PnL.

   WHY PARIMUTUEL, NOT AN AMM
   An automated market maker quotes both sides continuously, which is nicer to
   trade against, but every quote it gives is a promise the pool has to be able
   to honour. Honouring it needs an underwriter: real collateral sitting in the
   pool before the first ticket, taking the other side of every trade. A venue
   that seeds that liquidity out of thin air is writing cheques against money
   that is not there, and the first winning session is when everybody finds out.

   So the book here is a pot. Both sides pay into it, the losing side's money is
   what the winning side is paid from, and the contract can never owe more than
   it holds — the invariant is arithmetic, not a policy. Prices are still live:
   the multiple on a side is the whole pot over that side's stake, so it moves
   with every ticket the way a quote does. What it cannot do is let you close a
   position early, because there is nobody to sell it back to.

   WHAT THE CONTRACT TRUSTS
   Only one thing: an oracle that publishes the two numbers a market settles on.
   Everything else — who staked what, who won, what each winner is owed — is
   computed here from state the chain already holds. The oracle cannot touch a
   stake, cannot pay itself, and cannot resolve a market before it closes. If it
   disappears entirely, anyone may void the market after the grace window and
   every stake comes back at cost.
*/

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract FomoMarket {
    /* ------------------------------------------------------------------ */
    /* Types                                                              */
    /* ------------------------------------------------------------------ */

    enum Status { Open, Resolved, Void }

    uint8 public constant UP = 0;
    uint8 public constant DOWN = 1;

    struct Market {
        bytes32 handleHash;   // keccak256 of the lowercased fomo handle
        uint64  opensAt;      // when the strike was taken
        uint64  closesAt;     // no ticket is accepted at or after this
        uint32  window;       // seconds the market runs for: 86400 or 604800
        Status  status;
        uint8   winner;       // meaningful once status == Resolved
        int128  strike;       // account PnL at the open, 6 decimals, signed
        int128  settle;       // account PnL at the close, 6 decimals, signed
        uint128 poolUp;
        uint128 poolDown;
        uint128 paidOut;      // what has actually left the contract for this market
    }

    /* ------------------------------------------------------------------ */
    /* Storage                                                            */
    /* ------------------------------------------------------------------ */

    /// The collateral every pot is denominated in. USDG carries six decimals.
    IERC20 public immutable collateral;

    /// Fee on winnings only. A stake always comes back whole.
    uint16 public constant FEE_BPS = 200;          // 2.00%
    /// Half of that fee is held for the account the market was written on.
    uint16 public constant ESCROW_SHARE_BPS = 5000; // 50% of the fee

    /// After this long unresolved, a market can be voided by anybody.
    uint64 public constant VOID_AFTER = 7 days;

    address public owner;
    address public oracle;
    address public feeTo;

    Market[] private _markets;

    /// handle string per market, so the contract reads back without an indexer
    mapping(uint256 => string) public handleOf;

    /// stakes[marketId][account][side]
    mapping(uint256 => mapping(address => uint128[2])) private _stakes;
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// Fees waiting to be withdrawn.
    uint128 public feeAccrued;
    mapping(bytes32 => uint128) public escrowOf;      // per handle
    mapping(bytes32 => address) public handleOwner;   // set by the oracle
    mapping(bytes32 => bool) public blocked;          // handle asked to be left alone

    /* ------------------------------------------------------------------ */
    /* Events                                                             */
    /* ------------------------------------------------------------------ */

    event MarketOpened(uint256 indexed id, bytes32 indexed handleHash, string handle, uint32 window, uint64 opensAt, uint64 closesAt, int128 strike);
    event Staked(uint256 indexed id, address indexed account, uint8 side, uint128 amount);
    event Resolved(uint256 indexed id, uint8 winner, int128 settle);
    event Voided(uint256 indexed id, string reason);
    event Claimed(uint256 indexed id, address indexed account, uint128 amount);
    event EscrowClaimed(bytes32 indexed handleHash, address indexed to, uint128 amount);
    event HandleOwnerSet(bytes32 indexed handleHash, address indexed account);
    event HandleBlocked(bytes32 indexed handleHash, bool blocked);
    event OracleSet(address indexed oracle);
    event FeeToSet(address indexed feeTo);
    event OwnerSet(address indexed owner);

    /* ------------------------------------------------------------------ */
    /* Errors                                                             */
    /* ------------------------------------------------------------------ */

    error NotOwner();
    error NotOracle();
    error NoMarket();
    error MarketClosed();
    error MarketNotClosed();
    error MarketSettled();
    error MarketLive();
    error BadSide();
    error BadWindow();
    error BadAmount();
    error AlreadyClaimed();
    error NothingToClaim();
    error TransferFailed();
    error HandleBlockedError();
    error NotHandleOwner();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyOracle() { if (msg.sender != oracle) revert NotOracle(); _; }

    constructor(IERC20 collateral_, address oracle_, address feeTo_) {
        collateral = collateral_;
        owner = msg.sender;
        oracle = oracle_;
        feeTo = feeTo_;
        emit OwnerSet(msg.sender);
        emit OracleSet(oracle_);
        emit FeeToSet(feeTo_);
    }

    /* ------------------------------------------------------------------ */
    /* Admin                                                              */
    /* ------------------------------------------------------------------ */

    function setOwner(address a) external onlyOwner { owner = a; emit OwnerSet(a); }
    function setOracle(address a) external onlyOwner { oracle = a; emit OracleSet(a); }
    function setFeeTo(address a) external onlyOwner { feeTo = a; emit FeeToSet(a); }

    /* ------------------------------------------------------------------ */
    /* The accounts a market is written on                                */
    /* ------------------------------------------------------------------ */

    /**
     * Bind a handle to an address. The oracle attests this because the proof
     * that a wallet is a given fomo account lives off chain; what the contract
     * guarantees is only what follows from the binding — the escrow, and the
     * right to be left alone.
     */
    function setHandleOwner(bytes32 handleHash, address account) external onlyOracle {
        handleOwner[handleHash] = account;
        emit HandleOwnerSet(handleHash, account);
    }

    /// An account that wants no market written on it. New ones are refused;
    /// open ones are voided by the oracle, which refunds every stake at cost.
    function setBlocked(bytes32 handleHash, bool value) external {
        if (msg.sender != handleOwner[handleHash] && msg.sender != oracle) revert NotHandleOwner();
        blocked[handleHash] = value;
        emit HandleBlocked(handleHash, value);
    }

    function claimEscrow(bytes32 handleHash) external returns (uint128 amount) {
        address to = handleOwner[handleHash];
        if (msg.sender != to) revert NotHandleOwner();
        amount = escrowOf[handleHash];
        if (amount == 0) revert NothingToClaim();
        escrowOf[handleHash] = 0;
        _send(to, amount);
        emit EscrowClaimed(handleHash, to, amount);
    }

    function withdrawFees() external returns (uint128 amount) {
        amount = feeAccrued;
        if (amount == 0) revert NothingToClaim();
        feeAccrued = 0;
        _send(feeTo, amount);
    }

    /* ------------------------------------------------------------------ */
    /* Opening                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Open a market on `handle` over `window` seconds, struck at the account's
     * cumulative PnL right now. The strike is stored rather than read later so
     * that what a ticket was bought against is fixed the moment it was bought.
     */
    function openMarket(
        string calldata handle,
        uint32 window,
        uint64 opensAt,
        uint64 closesAt,
        int128 strike
    ) external onlyOracle returns (uint256 id) {
        if (window != 1 days && window != 7 days) revert BadWindow();
        if (closesAt <= opensAt || closesAt <= block.timestamp) revert MarketClosed();

        bytes32 h = keccak256(bytes(handle));
        if (blocked[h]) revert HandleBlockedError();

        id = _markets.length;
        _markets.push(Market({
            handleHash: h,
            opensAt: opensAt,
            closesAt: closesAt,
            window: window,
            status: Status.Open,
            winner: 0,
            strike: strike,
            settle: 0,
            poolUp: 0,
            poolDown: 0,
            paidOut: 0
        }));
        handleOf[id] = handle;
        emit MarketOpened(id, h, handle, window, opensAt, closesAt, strike);
    }

    /* ------------------------------------------------------------------ */
    /* Staking                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Take a side. The collateral moves here in the same call, so a position
     * exists only once it has been paid for — there is no state in which the
     * book is showing a ticket the contract was never given the money for.
     */
    function stake(uint256 id, uint8 side, uint128 amount) external {
        Market storage m = _market(id);
        if (side > DOWN) revert BadSide();
        if (amount == 0) revert BadAmount();
        if (m.status != Status.Open) revert MarketSettled();
        if (block.timestamp >= m.closesAt) revert MarketClosed();

        if (!collateral.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        _stakes[id][msg.sender][side] += amount;
        if (side == UP) m.poolUp += amount; else m.poolDown += amount;

        emit Staked(id, msg.sender, side, amount);
    }

    /* ------------------------------------------------------------------ */
    /* Settlement                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Publish the closing number. The winner follows from the two numbers
     * rather than from the oracle's opinion: strictly above the strike is up,
     * anything else is down, which is the same rule the venue documents.
     *
     * A market with an empty side has nothing to pay a winner with, so it
     * voids instead of handing one side a free round trip.
     */
    function resolve(uint256 id, int128 settleValue) external onlyOracle {
        Market storage m = _market(id);
        if (m.status != Status.Open) revert MarketSettled();
        if (block.timestamp < m.closesAt) revert MarketNotClosed();

        if (m.poolUp == 0 || m.poolDown == 0) {
            m.status = Status.Void;
            emit Voided(id, "one side never traded");
            return;
        }

        m.settle = settleValue;
        m.winner = settleValue > m.strike ? UP : DOWN;
        m.status = Status.Resolved;
        emit Resolved(id, m.winner, settleValue);
    }

    /// Refuse to settle. Every stake becomes claimable at what it cost.
    function voidMarket(uint256 id, string calldata reason) external onlyOracle {
        Market storage m = _market(id);
        if (m.status != Status.Open) revert MarketSettled();
        m.status = Status.Void;
        emit Voided(id, reason);
    }

    /**
     * The backstop. If the oracle never publishes, the money is not stuck
     * here: once the grace window is past, anybody at all can void the market
     * and everyone takes their stake back.
     */
    function voidStale(uint256 id) external {
        Market storage m = _market(id);
        if (m.status != Status.Open) revert MarketSettled();
        if (block.timestamp < uint256(m.closesAt) + VOID_AFTER) revert MarketLive();
        m.status = Status.Void;
        emit Voided(id, "no settlement was published");
    }

    /* ------------------------------------------------------------------ */
    /* Claiming                                                           */
    /* ------------------------------------------------------------------ */

    function claim(uint256 id) external returns (uint128 amount) {
        Market storage m = _market(id);
        if (m.status == Status.Open) revert MarketLive();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();

        uint128 fee;
        (amount, fee) = _quoteClaim(m, id, msg.sender);
        if (amount == 0) revert NothingToClaim();

        claimed[id][msg.sender] = true;
        m.paidOut += amount;

        if (fee > 0) {
            uint128 escrow = uint128((uint256(fee) * ESCROW_SHARE_BPS) / 10_000);
            escrowOf[m.handleHash] += escrow;
            feeAccrued += fee - escrow;
        }

        _send(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    /* ------------------------------------------------------------------ */
    /* Views                                                              */
    /* ------------------------------------------------------------------ */

    function marketCount() external view returns (uint256) { return _markets.length; }

    function getMarket(uint256 id) external view returns (Market memory) { return _market(id); }

    function stakesOf(uint256 id, address account) external view returns (uint128 up, uint128 down) {
        uint128[2] storage s = _stakes[id][account];
        return (s[UP], s[DOWN]);
    }

    /// What `account` would be paid right now, and the fee inside that number.
    function claimable(uint256 id, address account) external view returns (uint128 amount, uint128 fee) {
        Market storage m = _market(id);
        if (m.status == Status.Open || claimed[id][account]) return (0, 0);
        return _quoteClaim(m, id, account);
    }

    /**
     * The multiple a fresh `amount` on `side` would be paid at if the market
     * closed with the book exactly as it stands, net of the fee. This is the
     * number the interface quotes, and it is computed here so the page and the
     * contract can never disagree about it.
     */
    function quote(uint256 id, uint8 side, uint128 amount) external view returns (uint256 multipleWad) {
        Market storage m = _market(id);
        if (side > DOWN) revert BadSide();
        if (amount == 0) revert BadAmount();

        uint256 win = uint256(side == UP ? m.poolUp : m.poolDown) + amount;
        uint256 lose = uint256(side == UP ? m.poolDown : m.poolUp);
        if (lose == 0) return 1e18;

        uint256 gross = (uint256(amount) * lose) / win;
        uint256 net = gross - (gross * FEE_BPS) / 10_000;
        return ((uint256(amount) + net) * 1e18) / uint256(amount);
    }

    /* ------------------------------------------------------------------ */
    /* Internals                                                          */
    /* ------------------------------------------------------------------ */

    function _market(uint256 id) private view returns (Market storage m) {
        if (id >= _markets.length) revert NoMarket();
        m = _markets[id];
    }

    function _quoteClaim(Market storage m, uint256 id, address account)
        private view returns (uint128 amount, uint128 fee)
    {
        uint128[2] storage s = _stakes[id][account];

        // A void is not a loss. Both sides come back at exactly what they cost,
        // with no fee taken, because nothing was won.
        if (m.status == Status.Void) {
            return (s[UP] + s[DOWN], 0);
        }

        uint128 mine = s[m.winner];
        if (mine == 0) return (0, 0);

        uint256 win = m.winner == UP ? m.poolUp : m.poolDown;
        uint256 lose = m.winner == UP ? m.poolDown : m.poolUp;

        uint256 gross = (uint256(mine) * lose) / win;     // rounds toward the pot
        uint256 f = (gross * FEE_BPS) / 10_000;
        return (uint128(uint256(mine) + gross - f), uint128(f));
    }

    function _send(address to, uint128 amount) private {
        if (!collateral.transfer(to, amount)) revert TransferFailed();
    }
}

/*
   A stand-in for USDG, used only where the real token does not exist — the
   Robinhood Chain testnet. Six decimals, like the real one, and anybody can
   mint themselves a float, which is the whole point of play money.
*/
contract MockUSDG {
    string public constant name = "Mock USDG";
    string public constant symbol = "USDG";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// 10,000 play dollars, as often as you like.
    function faucet() external {
        _mint(msg.sender, 10_000 * 10 ** 6);
    }

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function _mint(address to, uint256 value) private {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return _move(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= value, "allowance");
            allowance[from][msg.sender] = a - value;
        }
        return _move(from, to, value);
    }

    function _move(address from, address to, uint256 value) private returns (bool) {
        require(balanceOf[from] >= value, "balance");
        unchecked {
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }
}
