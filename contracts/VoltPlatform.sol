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
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    uint256 public constant ONE_DAY          = 1 days;
    uint256 public constant YEAR_DAYS        = 365;
    uint256 public constant BP               = 10_000;
    uint256 public constant FIVE_YEARS_DAYS  = 5 * 365;
    uint256 public constant BONUS_VESTING_PERIOD = 5 minutes; // 5 minutes for testing
    uint256 public constant BONUS_CAP_USDT   = 10_000 * 1e6;
    uint256 public constant ONE_USDT         = 1e6;

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

    mapping(address => bool)     public whitelisted;
    mapping(address => address)  public referrerOf;
    mapping(address => bool)     public hasDeposited;

    uint256[7] public refBp;

    uint256 public totalVoltMinted;
    uint256 public totalVoltBurned;
    uint256 public totalBonusOutstanding;

    mapping(address => uint256) public bonusBalance;
    mapping(address => uint256) public bonusVestingEnd;
    mapping(address => uint256) public lastAccrualTime;
    mapping(address => bool)    public hasReceivedFirstDepositBonus;

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

    error InvalidAddress();
    error NotWhitelisted();
    error AlreadyWhitelisted();
    error AmountIsZero();
    error BelowMinWithdraw();
    error ActiveLocksPresent();
    error InsufficientLiquidity();
    error NotVested();
    error InvalidAmount();
    error InsufficientAllowance();
    error InvalidDuration();
    error EmptyArray();
    error InvalidReferrer();
    error ReferralCycle();
    error AlreadyReferred();
    error NoBonusToClaim();
    error BonusStillLocked();
    error InvalidArrayLength();


    event WhitelistedWithReferral(address indexed referee, address indexed referrer);
    event BulkWhitelisted(uint256 count);
    event Referred(address indexed referrer, address indexed referee, uint256 depositAmount);
    event ReferralBonusPaid(address indexed to, uint256 level, uint256 amount);
    event Deposited(address indexed user, uint256 usdtAmount, uint256 voltMinted, address referrer);
    event Locked(address indexed user, uint256 amount, uint256 durationDays, uint256 bonusAtUnlock);
    event Unlocked(address indexed user, uint256 releasedAmount, uint256 bonusReleased, uint256 interestReleased);
    event InterestClaimed(address indexed user, uint256 interestVolt);
    event Withdrawn(address indexed user, uint256 voltBurned, uint256 usdtSent, uint256 feeBp, bool fullExit);
    event BonusGranted(address indexed user, uint256 bonusAmount, uint256 vestingEnd);
    event BonusClaimed(address indexed user, uint256 amount);
    event AdminDepositUSDT(uint256 amount);
    event AdminWithdrawUSDT(uint256 amount);
    event ParamsUpdated();

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

        emit WhitelistedWithReferral(owner_, owner_);
    }

    function _requireWhitelisted() internal view {
        if (!whitelisted[msg.sender]) revert NotWhitelisted();
    }


    function addToWhitelistWithReferral(
        address[] calldata referees,
        address[] calldata referrers
    ) external onlyOwner {
        if (referees.length == 0 || referees.length != referrers.length)
            revert InvalidArrayLength();

        uint256 count = 0;

        for (uint256 i = 0; i < referees.length; i++) {
            address referee = referees[i];
            address referrer = referrers[i];

            if (referee == address(0)) revert InvalidReferrer();

            if (whitelisted[referee]) revert AlreadyReferred();

            if (referrer != address(0)) {
                if (referrer == referee) revert InvalidReferrer();

                if (!whitelisted[referrer] || !hasDeposited[referrer])
                    revert InvalidReferrer();

                if (referrerOf[referee] != address(0))
                    revert AlreadyReferred();

                address current = referrer;
                for (uint256 j = 0; j < 7; j++) {
                    if (current == address(0)) break;
                    if (current == referee) revert ReferralCycle();
                    current = referrerOf[current];
                }

                referrerOf[referee] = referrer;
            }

            whitelisted[referee] = true;
            lastAccrualTime[referee] = block.timestamp;

            emit WhitelistedWithReferral(referee, referrer);
            count++;
        }

        if (count > 0) emit BulkWhitelisted(count);
    }

    function depositUSDT(uint256 amount) external nonReentrant whenNotPaused {
        _requireWhitelisted();                   
        if (amount == 0) revert AmountIsZero();

        uint256 allowance = usdt.allowance(msg.sender, address(this));
        if (allowance < amount) revert InsufficientAllowance();

        bool isFirstDeposit = !hasDeposited[msg.sender];
        address finalReferrer = referrerOf[msg.sender];

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
                bonusVestingEnd[msg.sender] = block.timestamp + BONUS_VESTING_PERIOD;
                emit BonusGranted(msg.sender, cappedBonus, bonusVestingEnd[msg.sender]);
            }
        }

        if (isFirstDeposit) {
            hasDeposited[msg.sender] = true;

            if (finalReferrer != address(0) && hasDeposited[finalReferrer]) {
                _payReferralBonus(msg.sender, amount);
                emit Referred(finalReferrer, msg.sender, amount);
            }
        }

        emit Deposited(msg.sender, amount, amount, finalReferrer);
    }
    

    function lock(uint256 amount, uint256 durationDays) external nonReentrant whenNotPaused {
        _requireWhitelisted();                    
        if (amount == 0) revert AmountIsZero();
        if (!(
            durationDays == 45 || durationDays == 90 ||
            durationDays == 180 || durationDays == 365 ||
            durationDays == 1095
        )) revert InvalidDuration();

        uint256 userBalance = balanceOfVolt(msg.sender);
        if (userBalance < amount) revert InvalidAmount();

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

    function unlock(uint256 lockIndex) external nonReentrant whenNotPaused {
        _requireWhitelisted();                    
        if (lockIndex >= locks[msg.sender].length) revert InvalidAmount();
        Lock storage L = locks[msg.sender][lockIndex];
        if (!L.active) revert InvalidAmount();
        if (block.timestamp < L.startTime + L.durationDays * ONE_DAY) revert NotVested();

        uint256 lat = lastAccrualTime[msg.sender] == 0 ? block.timestamp : lastAccrualTime[msg.sender];
        uint256 interestStart = lat > L.startTime ? lat : L.startTime;
        uint256 lockEndTime = L.startTime + L.durationDays * ONE_DAY;
        uint256 elapsed = lockEndTime > interestStart ? lockEndTime - interestStart : 0;
        uint256 lockInterest = 0;
        
        if (L.aprBp > 0 && elapsed > 0) {
            lockInterest = (L.amount * L.aprBp * elapsed) / (BP * YEAR_DAYS * ONE_DAY);
        }

        uint256 release = L.amount + L.bonusAtUnlock + lockInterest;
        
        volt.mint(msg.sender, release);
        totalVoltMinted += release;
        
        if (lockEndTime > lat) {
            lastAccrualTime[msg.sender] = lockEndTime;
        }
        
        L.active = false;

        emit Unlocked(msg.sender, release, L.bonusAtUnlock, lockInterest);
    }

    function claimInterest() external nonReentrant whenNotPaused {
        _requireWhitelisted();                     
        uint256 interest = calculateAccruedInterest(msg.sender);
        if (interest == 0) revert AmountIsZero();
        lastAccrualTime[msg.sender] = block.timestamp;
        volt.mint(msg.sender, interest);
        totalVoltMinted += interest;
        emit InterestClaimed(msg.sender, interest);
    }

    function adminPayBonus(address user) external onlyOwner nonReentrant whenNotPaused {
        if (user == address(0)) revert InvalidAddress();
        uint256 amount = bonusBalance[user];
        if (amount == 0) revert NoBonusToClaim();
        if (bonusVestingEnd[user] == 0 || block.timestamp < bonusVestingEnd[user])
            revert BonusStillLocked();

        bonusBalance[user] = 0;
        bonusVestingEnd[user] = 0;
        totalBonusOutstanding -= amount;
        volt.mint(user, amount);
        totalVoltMinted += amount;

        emit BonusClaimed(user, amount);
    }


    function withdrawUSDT(uint256 voltAmount, bool fullExit) external nonReentrant whenNotPaused {
        _requireWhitelisted();                     
        if (voltAmount < minWithdrawUSDT) revert BelowMinWithdraw();
        if (voltAmount == 0) revert AmountIsZero();
        if (fullExit && getLockedAmount(msg.sender) > 0) revert ActiveLocksPresent();

        uint256 userBalance = balanceOfVolt(msg.sender);
        if (userBalance < voltAmount) revert InvalidAmount();

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

    function _payReferralBonus(address user, uint256 depositAmount) internal {
        address current = referrerOf[user];
        uint256 newVestingEnd = block.timestamp + BONUS_VESTING_PERIOD;
        
        for (uint256 level = 0; level < 7 && current != address(0); ++level) {

            if (current == user) break;
            
            if (!hasDeposited[current]) break;
            
            uint256 rewardBp = refBp[level];
            if (rewardBp == 0) break;
            
            uint256 reward = (depositAmount * rewardBp) / BP;
            if (reward == 0) break;

            totalBonusOutstanding += reward;
            bonusBalance[current] += reward;
            
            if (bonusVestingEnd[current] == 0 || bonusVestingEnd[current] < newVestingEnd) {
                bonusVestingEnd[current] = newVestingEnd;
            }

            emit ReferralBonusPaid(current, level + 1, reward);
            emit BonusGranted(current, reward, bonusVestingEnd[current]);

            current = referrerOf[current];
        }
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

        uint256 lat = lastAccrualTime[user] == 0 ? block.timestamp : lastAccrualTime[user];

        uint256 availableVolt = balanceOfVolt(user);
        if (availableVolt > 0 && baseApyBp > 0) {
            uint256 dt = nowTs > lat ? nowTs - lat : 0;
            interest += (availableVolt * baseApyBp * dt) / (BP * YEAR_DAYS * ONE_DAY);
        }

        uint256 bonus = bonusBalance[user];
        if (bonus > 0 && baseApyBp > 0) {
            uint256 dt = nowTs > lat ? nowTs - lat : 0;
            interest += (bonus * baseApyBp * dt) / (BP * YEAR_DAYS * ONE_DAY);
        }

        Lock[] storage arr = locks[user];
        for (uint256 i = 0; i < arr.length; ) {
            Lock storage L = arr[i];
            if (!L.active || L.aprBp == 0) { unchecked { ++i; } continue; }

            uint256 interestStart = lat > L.startTime ? lat : L.startTime;
            uint256 lockEndTime = L.startTime + L.durationDays * ONE_DAY;
            uint256 elapsed = nowTs < lockEndTime
                ? (nowTs > interestStart ? nowTs - interestStart : 0)
                : (lockEndTime > interestStart ? lockEndTime - interestStart : 0);
            interest += (L.amount * L.aprBp * elapsed) / (BP * YEAR_DAYS * ONE_DAY);
            unchecked { ++i; }
        }
        return interest;
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

        uint256 liability = totalVoltMinted - totalVoltBurned + totalBonusOutstanding;
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


    function _authorizeUpgrade(address) internal override onlyOwner {}
}