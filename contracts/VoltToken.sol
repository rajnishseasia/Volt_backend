// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
 
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
 
error TransfersDisabled();
 
contract VoltToken is Initializable, ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    address public platform;
 
    event PlatformSet(address indexed platform);
 
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
 
    function initialize(address initialOwner) public initializer {
        __ERC20_init("Volt Token", "VOLT");
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }
 
    function decimals() public pure override returns (uint8) {
        return 6;
    }
 
    function setPlatform(address _platform) external onlyOwner {
        require(_platform != address(0), "zero addr");
        platform = _platform;
        emit PlatformSet(_platform);
    }
 
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner() || msg.sender == platform, "Not authorized");
        require(amount > 0, "Amount=0");
        _mint(to, amount);
    }
 
    function burn(address from, uint256 amount) external {
        require(msg.sender == owner() || msg.sender == platform, "Not authorized");
        require(amount > 0, "Amount=0");
        _burn(from, amount);
    }
 
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            revert TransfersDisabled();
        }
        super._update(from, to, value);
    }
 
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}