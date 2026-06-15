# Skenion Examples

Example scenes, fixtures, sample projects, public assets, and compatibility samples for Skenion.

Code is Apache-2.0 by default; asset-specific licenses must be declared beside assets.

## Compatibility Fixtures

The `fixtures/contract/v0.1` directory contains graph documents and node
definition manifests used to verify compatibility between:

- `skenion-contracts`
- `skenion-sdk`
- `skenion-runtime`
- future `skenion-studio`

Valid fixtures must pass both JSON schema validation and runtime contract
loading. Invalid fixtures must fail for the expected reason.

The `compatibility/v0.1` directory contains registry-oriented node definitions
and graph documents. Its invalid graph fixtures are intentionally valid graph
documents, but they must fail project validation or execution planning when a
runtime resolves them against the node registry.

Runtime project payload fixtures live under
`compatibility/v0.1/projects`. They match the local Runtime HTTP API request
shape for `/v0/validate`, `/v0/plan`, and `/v0/run`.

Run local validation with:

```sh
SKENION_CONTRACTS_PACKAGE=/Users/state303/Documents/Skenion-contracts/packages/ts/dist node scripts/validate-with-contracts.mjs
SKENION_CONTRACTS_PACKAGE=/Users/state303/Documents/Skenion-contracts/packages/ts/dist node scripts/validate-runtime-project-payloads.mjs
bash scripts/validate-with-runtime.sh /Users/state303/Documents/Skenion-runtime
```

## Status

Bootstrap repository for the Skenion project. Implementation follows the public architecture and release rules defined in [EchoVisionLab/skenion](https://github.com/echovisionlab/skenion).

## License And Credit

This repository is licensed under the Apache License, Version 2.0.

Redistributions must preserve copyright, license, and NOTICE information as required by Apache-2.0. If Skenion helps your artwork, research, publication, installation, or tool, please credit Skenion and EchoVisionLab.
