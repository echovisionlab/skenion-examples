# Contract Fixtures v0.1

These fixtures are canonical compatibility examples for Skenion Graph Document
v0.1 and Skenion Node Definition Manifest v0.1.

Valid fixtures must pass both:

- `@skenion/contracts` validation
- `skenion-runtime` contract loading

Invalid fixtures must fail. They document cases where the editor may later offer
to insert converter nodes, but the saved graph must still contain those
converter nodes explicitly.

## Invalid Graph Fixtures

- `duplicate-node-id.graph.json`: two graph nodes use the same `id`.
- `input-to-input-edge.graph.json`: an edge starts from an input port.
- `missing-port.graph.json`: an edge targets a port that does not exist.
- `bool-to-bang-without-converter.graph.json`: `value<boolean>` is connected
  directly to `event<bang>`.
- `video-resource-to-stream-without-decoder.graph.json`: `resource<asset.video>`
  is connected directly to `stream<video.frame>`.
- `video-stream-to-texture-without-upload.graph.json`: `stream<video.frame>` is
  connected directly to `resource<gpu.texture2d>`.

## Invalid Node Fixtures

- `duplicate-port-id.node.json`: one node definition declares the same port id
  twice.
- `output-activation.node.json`: an output port declares `activation`.
- `unsupported-permission.node.json`: a script node asks for a permission that
  v0.1 does not support.
