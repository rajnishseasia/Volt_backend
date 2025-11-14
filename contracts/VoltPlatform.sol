// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

interface IVoltToken {
    function setPlatform(address platform_) external;
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

contract VoltPlatform is
    Initializable,
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable
{
    using SafeERC20 for IERC20;

    uint256 public constant ONE_DAY   = 1 days;
    uint256 public constant YEAR_DAYS = 365;
    uint256 public constant BP        = 10_000;
    uint256 public constant FIVE_YEARS_DAYS = 5 * 365;
    uint256 public constant BONUS_CAP_USDT = 10_000 * 1e6;
    uint256 public constant ONE_USDT = 1e6;

    uint256 public constant TIER1_MIN = 50 * 1e6;   
    uint256 public constant TIER1_MAX = 100 * 1e6;   
    uint256 public constant TIER2_MIN = 101 * 1e6;   
    uint256 public constant TIER2_MAX = 500 * 1e6;

    IERC20     public usdt;
    IVoltToken public volt;

    uint256 public baseApyBp;
    uint256 public minWithdrawUSDT;
    uint256 public feeLt500Bp;
    uint256 public feeGte500Bp;

    mapping(address => bool) public whitelisted;
    mapping(address => address) public referrerOf;
    mapping(address => bool) public hasDeposited;

    uint256[7] public refBp;

    uint256 public totalVoltMinted;
    uint256 public totalVoltBurned;
    uint256 public totalBonusOutstanding;

    mapping(address => uint256) public bonusBalance;
    mapping(address => uint256) public bonusVestingEnd;
    mapping(address => uint256) public lastAccrualTime;
    mapping(address => bool)    public hasReceivedFirstDepositBonus;

    mapping(address => uint256) public referralNonce;

    error InvalidAddress();
    error NotWhitelisted();
    error AlreadyWhitelisted();
    error AmountIsZero();
    error BelowMinWithdraw();
    error ActiveLocksPresent();
    error InsufficientLiquidity();
    error NotVested();
    error InvalidAmount();
    error InvalidDuration();
    error EmptyArray();
    error InvalidReferrer();
    error ReferralCycle();
    error AlreadyReferred();
    error NoBonusToClaim();
    error BonusStillLocked();
    error InvalidSignature();

    modifier onlyWhitelisted() {
        if (!whitelisted[msg.sender]) revert NotWhitelisted();
        _;
    }

    struct Lock {
        uint256 amount;
        uint256 startTime;
        uint256 durationDays;
        uint256 multiplierBp;
        uint256 aprBp;
        uint256 bonusAtUnlock;
        bool    active;
    }
    mapping(address => Lock[]) public locks;

    event Whitelisted(address indexed user);
    event BulkWhitelisted(uint256 count);
    event Referred(address indexed referrer, address indexed referee, uint256 depositAmount);
    event ReferralBonusPaid(address indexed to, uint256 level, uint256 amount);
    event Deposited(address indexed user, uint256 usdtAmount, uint256 voltMinted, address referrer);
    event Locked(address indexed user, uint256 amount, uint256 durationDays, uint256 bonusAtUnlock);
    event Unlocked(address indexed user, uint256 releasedAmount, uint256 bonusReleased);
    event InterestClaimed(address indexed user, uint256 interestVolt);
    event Withdrawn(address indexed user, uint256 voltBurned, uint256 usdtSent, uint256 feeBp, bool fullExit);
    event BonusGranted(address indexed user, uint256 bonusAmount, uint256 vestingEnd);
    event BonusClaimed(address indexed user, uint256 amount);
    event AdminBonusClaimed(address indexed user, uint256 amount);
    event AdminBonusTransferred(address indexed from, address indexed to, uint256 amount);
    event AdminDepositUSDT(uint256 amount);
    event AdminWithdrawUSDT(uint256 amount);
    event ParamsUpdated();

    bytes32 private constant _REFERRAL_TYPEHASH = keccak256("Referral(address referee,uint256 nonce)");

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address usdt_, address voltToken_, address owner_) public initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        __EIP712_init("VoltPlatform", "1");

        if (usdt_ == address(0) || voltToken_ == address(0)) revert InvalidAddress();
        usdt = IERC20(usdt_);
        volt = IVoltToken(voltToken_);

        baseApyBp       = 600;
        minWithdrawUSDT = 150 * 1e6;
        feeLt500Bp      = 1000;
        feeGte500Bp     = 500;

        refBp = [1000, 500, 200, 100, 50, 25, 10];

        whitelisted[owner_] = true;
        referrerOf[owner_] = owner_;
        hasDeposited[owner_] = true;
        lastAccrualTime[owner_] = block.timestamp;

        emit Whitelisted(owner_);
    }

    function addToWhitelist(address[] calldata users) external onlyOwner {
        if (users.length == 0) revert EmptyArray();
        uint256 count = 0;
        for (uint256 i = 0; i < users.length; ++i) {
            address user = users[i];
            if (user == address(0) || whitelisted[user]) continue;
            whitelisted[user] = true;
            lastAccrualTime[user] = block.timestamp;
            emit Whitelisted(user);
            count++;
        }
        if (count > 0) emit BulkWhitelisted(count);
    }

    function depositUSDT(
        uint256 amount,
        address referrer,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused onlyWhitelisted {
        if (amount == 0) revert AmountIsZero();

        bool isFirstDeposit = !hasDeposited[msg.sender];
        address finalReferrer = address(0);

        if (isFirstDeposit && referrer != address(0)) {
            if (referrer == msg.sender) revert InvalidReferrer();

            bytes32 structHash = keccak256(abi.encode(
                _REFERRAL_TYPEHASH,
                msg.sender,
                referralNonce[msg.sender]
            ));
            bytes32 hash = _hashTypedDataV4(structHash);
            address signer = ECDSA.recover(hash, v, r, s);

            if (signer != referrer) revert InvalidSignature();
            if (!whitelisted[referrer] || !hasDeposited[referrer]) revert InvalidReferrer();
            if (referrerOf[msg.sender] != address(0)) revert AlreadyReferred();

            address current = referrer;
            for (uint256 i = 0; i < 7; ++i) {
                if (current == address(0)) break;
                if (current == msg.sender) revert ReferralCycle();
                current = referrerOf[current];
            }

            referralNonce[msg.sender]++;
            referrerOf[msg.sender] = referrer;
            finalReferrer = referrer;
            emit Referred(referrer, msg.sender, amount);
        }

        usdt.safeTransferFrom(msg.sender, address(this), amount);
        volt.mint(msg.sender, amount);
        totalVoltMinted += amount;

        if (lastAccrualTime[msg.sender] == 0) {
            lastAccrualTime[msg.sender] = block.timestamp;
        }

        if (isFirstDeposit && amount >= TIER1_MIN) {
            hasReceivedFirstDepositBonus[msg.sender] = true;
            uint256 multiplier = amount <= TIER1_MAX ? 3 : amount <= TIER2_MAX ? 5 : 10;
            uint256 bonusVolt = amount * multiplier;
            uint256 cappedBonus = bonusVolt > BONUS_CAP_USDT ? BONUS_CAP_USDT : bonusVolt;

            if (cappedBonus > 0) {
                totalBonusOutstanding += cappedBonus;
                bonusBalance[msg.sender] += cappedBonus;
                bonusVestingEnd[msg.sender] = block.timestamp + FIVE_YEARS_DAYS * ONE_DAY;
                emit BonusGranted(msg.sender, cappedBonus, bonusVestingEnd[msg.sender]);
            }
        }

        if (isFirstDeposit) {
            hasDeposited[msg.sender] = true;
            if (finalReferrer != address(0)) {
                _payReferralBonus(msg.sender, amount);
            }
        }

        emit Deposited(msg.sender, amount, amount, finalReferrer);
    }

    function lock(uint256 amount, uint256 durationDays) external nonReentrant whenNotPaused onlyWhitelisted {
        if (amount == 0) revert AmountIsZero();
        if (!(
            durationDays == 45 || durationDays == 90 || 
            durationDays == 180 || durationDays == 365 || 
            durationDays == 1095
        )) revert InvalidDuration();

        uint256 multBp = durationDays == 45   ? 11000 :
                        durationDays == 90    ? 12000 :
                        durationDays == 180   ? 14000 :
                        durationDays == 365   ? 21000 : 50000;

        uint256 aprBp = durationDays == 45   ? 150 :
                       durationDays == 90    ? 350 :
                       durationDays == 180   ? 800 :
                       durationDays == 365   ? 1800 : 10000;

        volt.burn(msg.sender, amount);
        totalVoltBurned += amount;

        uint256 bonusAtUnlock = amount * (multBp - 10000) / 10000;

        locks[msg.sender].push(Lock({
            amount: amount,
            startTime: block.timestamp,
            durationDays: durationDays,
            multiplierBp: multBp,
            aprBp: aprBp,
            bonusAtUnlock: bonusAtUnlock,
            active: true
        }));

        emit Locked(msg.sender, amount, durationDays, bonusAtUnlock);
    }

        function _payReferralBonus(address user, uint256 depositAmount) internal {
        address current = referrerOf[user];
        for (uint256 level = 0; level < 7 && current != address(0); ++level) {
            if (!hasDeposited[current]) break;
            uint256 rewardBp = refBp[level];
            if (rewardBp == 0) break;
            uint256 reward = (depositAmount * rewardBp) / BP;
            if (reward == 0) break;

            totalBonusOutstanding += reward;
            bonusBalance[current] += reward;
            if (bonusVestingEnd[current] == 0 || bonusVestingEnd[current] < block.timestamp + FIVE_YEARS_DAYS * ONE_DAY) {
                bonusVestingEnd[current] = block.timestamp + FIVE_YEARS_DAYS * ONE_DAY;
            }

            emit ReferralBonusPaid(current, level + 1, reward);
            emit BonusGranted(current, reward, bonusVestingEnd[current]);

            current = referrerOf[current];
        }
    }

    function unlock(uint256 lockIndex) external nonReentrant whenNotPaused onlyWhitelisted {
        if (lockIndex >= locks[msg.sender].length) revert InvalidAmount();
        Lock storage L = locks[msg.sender][lockIndex];
        if (!L.active) revert InvalidAmount();
        if (block.timestamp < L.startTime + L.durationDays * ONE_DAY) revert NotVested();

        uint256 release = L.amount + L.bonusAtUnlock;
        volt.mint(msg.sender, release);
        totalVoltMinted += release;
        L.active = false;

        emit Unlocked(msg.sender, release, L.bonusAtUnlock);
    }

    function getLockedAmount(address user) public view returns (uint256 total) {
        Lock[] storage arr = locks[user];
        for (uint256 i = 0; i < arr.length; ++i) {
            if (arr[i].active) total += arr[i].amount;
        }
    }

    function balanceOfVolt(address user) public view returns (uint256) {
        (bool ok, bytes memory data) = address(volt).staticcall(
            abi.encodeWithSignature("balanceOf(address)", user)
        );
        require(ok && data.length >= 32, "balanceOf failed");
        return abi.decode(data, (uint256));
    }

    function calculateAccruedInterest(address user) public view returns (uint256) {
        uint256 nowTs = block.timestamp;
        uint256 interest = 0;

        uint256 availableVolt = balanceOfVolt(user);
        if (availableVolt > 0 && baseApyBp > 0) {
            uint256 lat = lastAccrualTime[user] == 0 ? block.timestamp : lastAccrualTime[user];
            uint256 dt = nowTs > lat ? nowTs - lat : 0;
            interest += (availableVolt * baseApyBp * dt) / (BP * YEAR_DAYS * ONE_DAY);
        }

        uint256 bonus = bonusBalance[user];
        if (bonus > 0 && baseApyBp > 0) {
            uint256 lat = lastAccrualTime[user] == 0 ? block.timestamp : lastAccrualTime[user];
            uint256 dt = nowTs > lat ? nowTs - lat : 0;
            interest += (bonus * baseApyBp * dt) / (BP * YEAR_DAYS * ONE_DAY);
        }

        Lock[] storage arr = locks[user];
        for (uint256 i = 0; i < arr.length; ) {
            Lock storage L = arr[i];
            if (!L.active || L.aprBp == 0) { unchecked { ++i; } continue; }
            uint256 elapsed = nowTs < L.startTime + L.durationDays * ONE_DAY 
                ? nowTs - L.startTime 
                : L.durationDays * ONE_DAY;
            interest += (L.amount * L.aprBp * elapsed) / (BP * YEAR_DAYS * ONE_DAY);
            unchecked { ++i; }
        }
        return interest;
    }

    function claimInterest() external nonReentrant whenNotPaused onlyWhitelisted {
        uint256 interest = calculateAccruedInterest(msg.sender);
        if (interest == 0) revert AmountIsZero();
        lastAccrualTime[msg.sender] = block.timestamp;
        volt.mint(msg.sender, interest);
        totalVoltMinted += interest;
        emit InterestClaimed(msg.sender, interest);
    }

    function claimAllVestedBonus() external nonReentrant whenNotPaused onlyWhitelisted {
        if (bonusVestingEnd[msg.sender] == 0 || block.timestamp < bonusVestingEnd[msg.sender])
            revert BonusStillLocked();
        uint256 amount = bonusBalance[msg.sender];
        if (amount == 0) revert NoBonusToClaim();

        bonusBalance[msg.sender] = 0;
        bonusVestingEnd[msg.sender] = 0;
        totalBonusOutstanding -= amount;
        volt.mint(msg.sender, amount);
        totalVoltMinted += amount;

        emit BonusClaimed(msg.sender, amount);
    }

    function adminClaimBonusForUser(address user) external onlyOwner {
        uint256 amount = bonusBalance[user];
        if (amount == 0) revert NoBonusToClaim();

        bonusBalance[user] = 0;
        bonusVestingEnd[user] = 0;
        totalBonusOutstanding -= amount;
        volt.mint(user, amount);
        totalVoltMinted += amount;

        emit AdminBonusClaimed(user, amount);
    }

    function adminTransferBonus(address from, address to, uint256 amount) external onlyOwner {
        if (from == address(0) || to == address(0)) revert InvalidAddress();
        if (bonusBalance[from] < amount) revert InvalidAmount();

        bonusBalance[from] -= amount;
        bonusBalance[to] += amount;
        if (bonusVestingEnd[to] == 0) bonusVestingEnd[to] = bonusVestingEnd[from];
        if (bonusBalance[from] == 0) bonusVestingEnd[from] = 0;

        emit AdminBonusTransferred(from, to, amount);
    }

    function withdrawUSDT(uint256 voltAmount, bool fullExit) external nonReentrant whenNotPaused onlyWhitelisted {
        if (voltAmount < minWithdrawUSDT) revert BelowMinWithdraw();
        if (voltAmount == 0) revert AmountIsZero();
        if (fullExit && getLockedAmount(msg.sender) > 0) revert ActiveLocksPresent();

        uint256 feeBp = voltAmount < 500 * ONE_USDT ? feeLt500Bp : feeGte500Bp;
        uint256 fee   = (voltAmount * feeBp) / BP;
        uint256 net   = voltAmount - fee;

        if (usdt.balanceOf(address(this)) < net) revert InsufficientLiquidity();

        volt.burn(msg.sender, voltAmount);
        totalVoltBurned += voltAmount;
        usdt.safeTransfer(msg.sender, net);

        if (fullExit && bonusBalance[msg.sender] > 0) {
            totalBonusOutstanding -= bonusBalance[msg.sender];
            bonusBalance[msg.sender] = 0;
            bonusVestingEnd[msg.sender] = 0;
        }

        emit Withdrawn(msg.sender, voltAmount, net, feeBp, fullExit);
    }

    function updateReferralRewards(uint256[7] memory newRefBp) external onlyOwner {
        refBp = newRefBp;
        emit ParamsUpdated();
    }

    function adminDepositUSDT(uint256 amount) external onlyOwner {
        if (amount == 0) revert AmountIsZero();
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit AdminDepositUSDT(amount);
    }

    function adminWithdrawUSDT(uint256 amount) external onlyOwner {
        if (amount == 0) revert AmountIsZero();
        uint256 liability = totalVoltMinted - totalVoltBurned;
        uint256 bal = usdt.balanceOf(address(this));
        if (bal <= liability || amount > bal - liability) revert InsufficientLiquidity();
        usdt.safeTransfer(owner(), amount);
        emit AdminWithdrawUSDT(amount);
    }

    function updateParams(
        uint256 _baseApyBp,
        uint256 _minWithdrawUSDT,
        uint256 _feeLt500Bp,
        uint256 _feeGte500Bp
    ) external onlyOwner {
        require(_baseApyBp <= 10000, "APY too high");
        require(_minWithdrawUSDT > 0, "Invalid min");
        require(_feeLt500Bp <= 5000 && _feeGte500Bp <= 5000, "Fees too high");

        baseApyBp = _baseApyBp;
        minWithdrawUSDT = _minWithdrawUSDT;
        feeLt500Bp = _feeLt500Bp;
        feeGte500Bp = _feeGte500Bp;

        emit ParamsUpdated();
    }

    function canWithdrawBonus(address user) public view returns (bool) {
        return bonusBalance[user] > 0 && 
               bonusVestingEnd[user] > 0 && 
               block.timestamp >= bonusVestingEnd[user];
    }

    function getUserOverview(address user) external view returns (
        bool isWhitelisted,
        address referrer,
        uint256 availableVolt,
        uint256 lockedVolt,
        uint256 bonusBal,
        uint256 bonusEnd,
        uint256 accruedInterest,
        bool deposited
    ) {
        return (
            whitelisted[user],
            referrerOf[user],
            balanceOfVolt(user),
            getLockedAmount(user),
            bonusBalance[user],
            bonusVestingEnd[user],
            calculateAccruedInterest(user),
            hasDeposited[user]
        );
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}