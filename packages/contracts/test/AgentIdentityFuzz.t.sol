// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentNFT} from "../src/identity/AgentNFT.sol";
import {AgentRegistry} from "../src/identity/AgentRegistry.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551.sol";

/// @dev Exposes AgentRegistry's internal pure name validator so we can fuzz it
///      in isolation — no minting, no state, no NameTaken coupling. Constructor
///      args are unused by _validateName, so zero addresses are fine.
contract ValidatorHarness is AgentRegistry {
    constructor() AgentRegistry(AgentNFT(address(0)), IERC6551Registry(address(0)), address(0)) {}

    function validate(string calldata name) external pure {
        _validateName(name);
    }
}

contract AgentIdentityFuzzTest is Test {
    ValidatorHarness internal harness;

    function setUp() public {
        harness = new ValidatorHarness();
    }

    /// Reference spec, independent of the contract's loop, for differential fuzzing.
    function _specValid(bytes memory b) internal pure returns (bool) {
        uint256 len = b.length;
        if (len == 0 || len > 32) return false;
        for (uint256 i = 0; i < len; i++) {
            bytes1 c = b[i];
            bool isLower = (c >= 0x61 && c <= 0x7a); // a-z
            bool isDigit = (c >= 0x30 && c <= 0x39); // 0-9
            bool isHyphen = (c == 0x2d); // -
            if (!isLower && !isDigit && !isHyphen) return false;
            if (isHyphen) {
                if (i == 0 || i == len - 1) return false;
                if (b[i - 1] == 0x2d) return false;
            }
        }
        return true;
    }

    /// Differential fuzz: the on-chain validator must accept a byte string IFF the
    /// reference spec does. Catches any off-by-one in a range comparison, any
    /// multi-byte UTF-8 leak, and any hyphen-rule gap.
    function testFuzz_validateName_matchesSpec(bytes calldata raw) public view {
        uint256 n = raw.length < 40 ? raw.length : 40; // cap; >32 rejection covered by length fuzz
        bytes memory b = raw[0:n];
        bool expectOk = _specValid(b);

        try harness.validate(string(b)) {
            assertTrue(expectOk, "validator ACCEPTED a name the spec rejects");
        } catch {
            assertFalse(expectOk, "validator REJECTED a name the spec accepts");
        }
    }

    /// Length boundary: 1..32 accepted (all 'a'), 0 and 33..255 rejected.
    function testFuzz_validateName_lengthBoundary(uint8 len) public view {
        bytes memory b = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            b[i] = 0x61; // 'a'
        }
        bool expectOk = (len >= 1 && len <= 32);
        try harness.validate(string(b)) {
            assertTrue(expectOk, "accepted out-of-range length");
        } catch {
            assertFalse(expectOk, "rejected an in-range length");
        }
    }

    /// Bytes immediately adjacent to each accepted range must be rejected with the
    /// exact NameBadChar(0); the range endpoints themselves must be accepted.
    function test_validateName_boundaryBytes() public {
        // '/' (0x2f, below '0'), ':' (0x3a, above '9'), '@' (0x40), '[' (0x5b),
        // '`' (0x60, below 'a'), '{' (0x7b, above 'z') — all outside the charset.
        bytes1[6] memory bad = [bytes1(0x2f), bytes1(0x3a), bytes1(0x40), bytes1(0x5b), bytes1(0x60), bytes1(0x7b)];
        for (uint256 i = 0; i < bad.length; i++) {
            bytes memory s = new bytes(1);
            s[i % 1] = bad[i];
            vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NameBadChar.selector, 0));
            harness.validate(string(s));
        }

        // Range endpoints: '0','9','a','z' are all valid single-char names.
        bytes1[4] memory good = [bytes1(0x30), bytes1(0x39), bytes1(0x61), bytes1(0x7a)];
        for (uint256 i = 0; i < good.length; i++) {
            bytes memory s = new bytes(1);
            s[0] = good[i];
            harness.validate(string(s)); // must not revert
        }
    }

    /// A multi-byte UTF-8 character (é = 0xC3 0xA9) must be rejected — its lead
    /// byte is far above 'z', so no homoglyph can sneak into the namespace.
    function test_validateName_rejectsMultiByteUtf8() public {
        bytes memory eacute = hex"c3a9";
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NameBadChar.selector, 0));
        harness.validate(string(eacute));
    }
}
