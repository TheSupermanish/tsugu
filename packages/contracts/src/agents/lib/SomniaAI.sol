// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IJsonApiAgent, ILlmAgent, IParseAgent} from "./SomniaAgents.sol";

/// @title  SomniaAI — payload encoders for invoking Somnia's AI agents
/// @notice The reusable toolkit for building "fundamental AI" on Somnia: pure helpers
///         that produce the `payload` bytes for `IAgentRequester.createRequest`. An asom
///         agent invokes Somnia AI by sending, from its contract or its ERC-6551 wallet:
///
///           platform.createRequest{value: deposit}(
///               agentId,            // from SomniaAgentIds (e.g. JSON_API / LLM_INFERENCE)
///               address(this),      // your callback target
///               this.handleResponse.selector,
///               SomniaAI.encodeFetchUint(url, path, decimals)  // <- this library
///           );
///
///         Keeping the encoding in one audited place means every asom agent speaks to the
///         platform identically, and a capability tag (e.g. "somnia.json-fetch") maps to a
///         concrete (agentId, encoder) pair. See repo docs/SOMNIA_AI.md.
/// @dev    JSON + LLM inferString encoders are against ABIs confirmed on Somnia's live
///         infra (OracleAgent / the official agents console). inferNumber + parse-website
///         encoders are per docs — confirm in a live round before mainnet.
library SomniaAI {
    // --- JSON API agent (verified) -------------------------------------------

    function encodeFetchUint(string memory url, string memory jsonPath, uint8 decimals)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(IJsonApiAgent.fetchUint.selector, url, jsonPath, decimals);
    }

    function encodeFetchInt(string memory url, string memory jsonPath, uint8 decimals)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(IJsonApiAgent.fetchInt.selector, url, jsonPath, decimals);
    }

    function encodeFetchString(string memory url, string memory jsonPath) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IJsonApiAgent.fetchString.selector, url, jsonPath);
    }

    function encodeFetchBool(string memory url, string memory jsonPath) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IJsonApiAgent.fetchBool.selector, url, jsonPath);
    }

    // --- LLM inference agent (id + inferString ABI confirmed on Somnia console) ------

    /// @notice Classify / infer a string, optionally constrained to `allowedValues`
    ///         (e.g. ["accept","reject"] for AI-judged task settlement).
    function encodeInferString(string memory prompt, string memory system, bool cot, string[] memory allowedValues)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(ILlmAgent.inferString.selector, prompt, system, cot, allowedValues);
    }

    /// @notice Infer a bounded number (e.g. a 0–100 reputation/quality score).
    function encodeInferNumber(string memory prompt, string memory system, int256 min, int256 max, bool cot)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(ILlmAgent.inferNumber.selector, prompt, system, min, max, cot);
    }

    // --- Parse-website agent (id-verified — verify ABI before mainnet) -------

    /// @notice Extract a string from a web page via the parse-website agent.
    /// @param key         the field name to extract (e.g. "headline")
    /// @param description what the field means (helps the model)
    /// @param options     optional enum of allowed answers ([] = unconstrained)
    /// @param prompt      extraction instruction
    /// @param url         page to read
    /// @param resolveUrl  true = domain-search mode (discover pages first); false = direct scrape
    /// @param numPages    pages to read (capped at 1 when resolveUrl == false)
    /// @param confidenceThreshold 0–100 confidence gate below which extraction fails
    /// @dev numPages/confidenceThreshold are `uint8` to match the live agent's selector
    ///      `ExtractString(string,string,string[],string,string,bool,uint8,uint8)` — confirmed
    ///      against docs.somnia.network/agents/base-agents/llm-parse-website. A uint256 here
    ///      would change the selector and the request would TimeOut against the real agent.
    function encodeExtractString(
        string memory key,
        string memory description,
        string[] memory options,
        string memory prompt,
        string memory url,
        bool resolveUrl,
        uint8 numPages,
        uint8 confidenceThreshold
    ) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            IParseAgent.ExtractString.selector,
            key,
            description,
            options,
            prompt,
            url,
            resolveUrl,
            numPages,
            confidenceThreshold
        );
    }
}
