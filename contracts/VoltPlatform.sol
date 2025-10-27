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

    uint256 public constant ONE_DAY   = 1 days;
    uint256 public constant YEAR_DAYS = 365;
    uint256 public constant BP        = 10_000;

    IERC20     public usdt;
    IVoltToken public volt;

    uint256 public baseApyBp;
    uint256 public minWithdrawUSDT;
    uint256 public feeLt500Bp;
    uint256 public feeGte500Bp;

    uint256[7] public refBp;
    mapping(address => address) public referrerOf;
    mapping(address => bool)    public isRegistered;
    mapping(address => bool)    public isActive;

    uint256 public totalVoltMinted;
    uint256 public totalVoltBurned;
    uint256 public totalBonusOutstanding;

    mapping(address => uint256) public bonusBalance;
    mapping(address => uint256) public bonusVestingEnd;
    mapping(address => uint256) public lastAccrualTime;

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

    event Registered(address indexed user, address indexed referrer);
    event Deposited(address indexed user, uint256 usdtAmount, uint256 voltMinted);
    event Locked(address indexed user, uint256 amount, uint256 durationDays, uint256 bonusAtUnlock);
    event Unlocked(address indexed user, uint256 releasedAmount, uint256 bonusReleased);
    event InterestClaimed(address indexed user, uint256 interestVolt);
    event Withdrawn(address indexed user, uint256 voltBurned, uint256 usdtSent, uint256 feeBp, bool fullExit);
    event BonusGranted(address indexed user, uint256 bonusAmount, uint256 vestingEnd);
    event AdminDepositUSDT(uint256 amount);
    event AdminWithdrawUSDT(uint256 amount);
    event ParamsUpdated();

    function initialize(address usdt_, address voltToken_, address owner_) public initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        require(usdt_ != address(0) && voltToken_ != address(0), "zero addr");
        usdt = IERC20(usdt_);
        volt = IVoltToken(voltToken_);

        baseApyBp       = 600;
        minWithdrawUSDT = 150 * 1e6;
        feeLt500Bp      = 1000;
        feeGte500Bp     = 500;
        refBp = [uint256(1000), 500, 200, 100, 50, 25, 10];

        isRegistered[owner_] = true;
        isActive[owner_]     = true;
        referrerOf[owner_]   = owner_;
        if (lastAccrualTime[owner_] == 0) lastAccrualTime[owner_] = block.timestamp;
    }

    function register(address referrer) external whenNotPaused {
        require(!isRegistered[msg.sender], "Already registered");
        require(isRegistered[referrer], "Referrer not registered");
        referrerOf[msg.sender] = referrer;
        isRegistered[msg.sender] = true;
        isActive[msg.sender] = true;
        if (lastAccrualTime[msg.sender] == 0) lastAccrualTime[msg.sender] = block.timestamp;
        emit Registered(msg.sender, referrer);
    }

    function ownerRegister(address user, address referrer) external onlyOwner {
        isRegistered[user] = true;
        isActive[user]     = true;
        referrerOf[user]   = isRegistered[referrer] ? referrer : owner();
        if (lastAccrualTime[user] == 0) lastAccrualTime[user] = block.timestamp;
        emit Registered(user, referrerOf[user]);
    }

    function depositUSDT(uint256 amount) external nonReentrant whenNotPaused {
        require(isRegistered[msg.sender] && isActive[msg.sender], "Register first");
        require(amount > 0, "Amount=0");

        usdt.safeTransferFrom(msg.sender, address(this), amount);
        volt.mint(msg.sender, amount);
        totalVoltMinted += amount;

        if (lastAccrualTime[msg.sender] == 0) {
            lastAccrualTime[msg.sender] = block.timestamp;
        }

        emit Deposited(msg.sender, amount, amount);
    }

    function lock(uint256 amount, uint256 durationDays) external nonReentrant whenNotPaused {
        require(isRegistered[msg.sender] && isActive[msg.sender], "Register first");
        require(amount > 0, "Amount=0");
        require(
            durationDays == 45 || durationDays == 90 || durationDays == 180 || durationDays == 365 || durationDays == 1095,
            "Invalid duration"
        );

        uint256 multBp;
        uint256 aprBp;
        if (durationDays == 45)      { multBp = 11000; aprBp = 150;   }
        else if (durationDays == 90) { multBp = 12000; aprBp = 350;   }
        else if (durationDays == 180){ multBp = 14000; aprBp = 800;   }
        else if (durationDays == 365){ multBp = 21000; aprBp = 1800;  }
        else               { multBp = 50000; aprBp = 10000; }

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
        require(lockIndex < locks[msg.sender].length, "Index");
        Lock storage L = locks[msg.sender][lockIndex];
        require(L.active, "Unlocked");
        require(block.timestamp >= L.startTime + L.durationDays * ONE_DAY, "Still locked");

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

    function _accrualWindow(uint256 start, uint256 end, uint256 fromTs, uint256 toTs) internal pure returns (uint256) {
    if (toTs <= fromTs) return 0;
    uint256 a = fromTs > start ? fromTs : start;
    uint256 b = toTs < end ? toTs : end;
    if (b > a) return b - a;
    return 0;
}

    function balanceOfVolt(address user) public view returns (uint256) {
        (bool ok, bytes memory data) = address(volt).staticcall(
            abi.encodeWithSignature("balanceOf(address)", user)
        );
        require(ok && data.length >= 32, "balanceOf failed");
        return abi.decode(data, (uint256));
    }

    function calculateAccruedInterest(address user) public view returns (uint256) {
    uint256 lat = lastAccrualTime[user];
    if (lat == 0) return 0;
    uint256 nowTs = block.timestamp;
    if (nowTs <= lat) return 0;

    uint256 interest = 0;

    uint256 availableVolt = balanceOfVolt(user);
    if (availableVolt > 0 && baseApyBp > 0) {
        uint256 dt = nowTs - lat;
        interest += (availableVolt * baseApyBp * dt) / (BP * YEAR_DAYS * ONE_DAY);
    }

    uint256 bonus = bonusBalance[user];
    if (bonus > 0 && baseApyBp > 0) {
        uint256 dtb = nowTs - lat;
        interest += (bonus * baseApyBp * dtb) / (BP * YEAR_DAYS * ONE_DAY);
    }

    Lock[] storage arr = locks[user];
    for (uint256 i = 0; i < arr.length; ++i) {
        Lock storage L = arr[i];
        if (!L.active || L.aprBp == 0) continue;
        uint256 start = L.startTime;
        uint256 end = L.startTime + L.durationDays * ONE_DAY;
        uint256 elapsed = _accrualWindow(start, end, lat, nowTs);
        if (elapsed > 0) {
            interest += (L.amount * L.aprBp * elapsed) / (BP * YEAR_DAYS * ONE_DAY);
        }
    }

    return interest;
}

    function claimInterest() external nonReentrant whenNotPaused {
        require(isRegistered[msg.sender] && isActive[msg.sender], "Register first");
        uint256 interest = calculateAccruedInterest(msg.sender);
        require(interest > 0, "No interest");

        lastAccrualTime[msg.sender] = block.timestamp;
        volt.mint(msg.sender, interest);
        totalVoltMinted += interest;

        emit InterestClaimed(msg.sender, interest);
    }

   function grantBonus(address user, uint256 amount, uint256 vestingPeriodDays) external onlyOwner {
        require(isRegistered[user], "User not registered");
        totalBonusOutstanding += amount;
        bonusBalance[user] += amount;
        uint256 vestEnd = block.timestamp + vestingPeriodDays * ONE_DAY;
        bonusVestingEnd[user] = vestEnd;
        emit BonusGranted(user, amount, bonusVestingEnd[user]);
    }

   function canWithdrawBonus(address user) public view returns (bool) {
    return bonusBalance[user] > 0 && bonusVestingEnd[user] > 0 && block.timestamp >= bonusVestingEnd[user];
}

    function claimVestedBonusToVolt(uint256 amount) external nonReentrant whenNotPaused {
        require(canWithdrawBonus(msg.sender), "Not vested");
        require(amount > 0 && amount <= bonusBalance[msg.sender], "Invalid amount");

        bonusBalance[msg.sender] -= amount;
        totalBonusOutstanding -= amount;
        volt.mint(msg.sender, amount);
        totalVoltMinted += amount;
    }

    function withdrawUSDT(uint256 voltAmount, bool fullExit) external nonReentrant whenNotPaused {
        require(isRegistered[msg.sender] && isActive[msg.sender], "Register first");
        require(voltAmount > 0, "Amount=0");

        if (fullExit) {
            require(getLockedAmount(msg.sender) == 0, "Active locks present");
        }

        require(voltAmount >= minWithdrawUSDT, "Below min");

        uint256 feeBp = voltAmount < 500 * 1e6 ? feeLt500Bp : feeGte500Bp;
        uint256 fee   = (voltAmount * feeBp) / BP;
        uint256 net   = voltAmount - fee;

        require(usdt.balanceOf(address(this)) >= net, "Insufficient USDT");

        volt.burn(msg.sender, voltAmount);
        totalVoltBurned += voltAmount;

        usdt.safeTransfer(msg.sender, net);

        if (fullExit) {
            if (bonusBalance[msg.sender] > 0) {
                totalBonusOutstanding -= bonusBalance[msg.sender];
                bonusBalance[msg.sender] = 0;
                bonusVestingEnd[msg.sender] = 0;
            }
            isActive[msg.sender] = false;
        }

        emit Withdrawn(msg.sender, voltAmount, net, feeBp, fullExit);
    }

    function payoutReferral(address user, uint256 qualifyingAmount) external onlyOwner {
        require(isRegistered[user], "User not registered");
        address curr = user;
        for (uint256 level = 0; level < 7; ++level) {
            curr = referrerOf[curr];
            if (!isRegistered[curr]) break;
            uint256 reward = (qualifyingAmount * refBp[level]) / BP;
            totalBonusOutstanding += reward;
            bonusBalance[curr] += reward;
        }
    }

    function adminDepositUSDT(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount=0");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit AdminDepositUSDT(amount);
    }

    function adminWithdrawUSDT(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount=0");
        uint256 liability = totalVoltMinted - totalVoltBurned;
        uint256 bal = usdt.balanceOf(address(this));
        require(bal > liability, "No surplus");
        require(amount <= bal - liability, "Exceeds surplus");
        usdt.safeTransfer(msg.sender, amount);
        emit AdminWithdrawUSDT(amount);
    }

    function updateParams(
        uint256 _baseApyBp,
        uint256 _minWithdrawUSDT,
        uint256 _feeLt500Bp,
        uint256 _feeGte500Bp,
        uint256[7] memory _refBp
    ) external onlyOwner {
        require(_baseApyBp <= 10000, "Invalid APY"); 
        require(_minWithdrawUSDT > 0, "Invalid min withdraw");
        require(_feeLt500Bp <= 5000 && _feeGte500Bp <= 5000, "Invalid fees"); 
        for (uint256 i = 0; i < 7; i++) {
            require(_refBp[i] <= 5000, "Invalid referral bonus");
        }

        baseApyBp = _baseApyBp;
        minWithdrawUSDT = _minWithdrawUSDT;
        feeLt500Bp = _feeLt500Bp;
        feeGte500Bp = _feeGte500Bp;
        refBp = _refBp;

        emit ParamsUpdated();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}